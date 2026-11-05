import type { SupabaseClient } from "@supabase/supabase-js";
import { aujourdhuiParis } from "@/lib/dates";
import { emailDuGestionnaire } from "@/lib/email/destinataire";
import { empreinteEmail } from "@/lib/email/empreinte";
import type { Envoyeur } from "@/lib/email/envoi";
import { COLONNES_FICHE, type FicheEntreprise } from "@/lib/entreprise/fiche";
import { COLONNES_CONDUCTEUR, type Conducteur } from "@/lib/flotte/conducteurs";
import { toutLire } from "@/lib/supabase/lecture";
import { emailRapport } from "./email-rapport";
import { BUCKET_RAPPORTS, cheminRapport, nomFichierRapport } from "./liste";
import { genererPdfRapport } from "./pdf";
import {
  COLONNES_AVIS_RAPPORT,
  bornesMois,
  moisDuRapport,
  syntheseRapport,
  type AvisRapport,
  type VehiculeRapport,
} from "./synthese";

// La tâche du rapport mensuel (phase 25), avec la clé secrète : elle lit les données de toutes les entreprises Pro.
// Chaque matin, elle produit le rapport du mois écoulé qui manque, et relance l'envoi d'un rapport dont l'email a
// échoué : un passage manqué le 1er se rattrape le lendemain. Un rapport parti est figé ; tant qu'il ne l'est pas, il est
// régénéré à chaque tentative, si bien que le PDF archivé est celui qui part. L'envoi est réservé en datant `envoye_le` :
// deux passages en même temps n'envoient qu'un email.

export type BilanRapports = {
  /** Les PDF générés et archivés. */
  generes: number;
  /** Les emails partis. */
  envoyes: number;
  /** Les entreprises dont le rapport n'est pas parti : la tâche du lendemain le retente. */
  echecs: number;
};

type Entreprise = FicheEntreprise & { id: string; user_id: string; emails_direction: string[] };

/**
 * À qui part le rapport : la direction en « À », le gestionnaire en « Cc » ; sans adresse « direction », le gestionnaire
 * seul en « À ». Une adresse n'apparaît qu'une fois.
 */
export function destinatairesRapport(emailsDirection: readonly string[], gestionnaire: string) {
  if (!emailsDirection.length) return { a: [gestionnaire], cc: [] };
  const enCopie = emailsDirection.includes(gestionnaire.toLowerCase()) ? [] : [gestionnaire];
  return { a: [...emailsDirection], cc: enCopie };
}

/** Les entreprises Pro qui existaient avant la fin du mois du rapport. */
async function entreprisesConcernees(admin: SupabaseClient, fin: string) {
  return toutLire<Entreprise>(
    (debut, dernier) =>
      admin
        .from("entreprise")
        .select(`id, user_id, emails_direction, ${COLONNES_FICHE}`)
        .eq("plan", "pro")
        .lt("created_at", fin)
        .order("id")
        .range(debut, dernier)
        .overrideTypes<Entreprise[], { merge: false }>(),
    "entreprises",
  );
}

/** Ce qu'un rapport compte : les avis, véhicules et conducteurs de l'entreprise, archivés compris. */
async function donneesEntreprise(admin: SupabaseClient, entrepriseId: string) {
  const [avis, vehicules, conducteurs] = await Promise.all([
    toutLire<AvisRapport>(
      (debut, fin) =>
        admin
          .from("avis")
          .select(COLONNES_AVIS_RAPPORT)
          .eq("entreprise_id", entrepriseId)
          .order("id")
          .range(debut, fin)
          .overrideTypes<AvisRapport[], { merge: false }>(),
      "avis",
    ),
    toutLire<VehiculeRapport>(
      (debut, fin) =>
        admin
          .from("vehicule")
          .select("id, plaque, modele")
          .eq("entreprise_id", entrepriseId)
          .order("id")
          .range(debut, fin)
          .overrideTypes<VehiculeRapport[], { merge: false }>(),
      "véhicules",
    ),
    toutLire<Conducteur>(
      (debut, fin) =>
        admin
          .from("conducteur")
          .select(COLONNES_CONDUCTEUR)
          .eq("entreprise_id", entrepriseId)
          .order("id")
          .range(debut, fin)
          .overrideTypes<Conducteur[], { merge: false }>(),
      "conducteurs",
    ),
  ]);
  return { avis, vehicules, conducteurs };
}

/** Génère le PDF du mois et l'archive : le fichier au chemin du mois, puis la ligne, ou sa date de génération. */
async function produire(admin: SupabaseClient, entreprise: Entreprise, mois: string, existe: boolean) {
  const synthese = syntheseRapport({ mois, entreprise, ...(await donneesEntreprise(admin, entreprise.id)) });
  const genereLe = new Date().toISOString();
  const pdf = await genererPdfRapport({ raisonSociale: entreprise.raison_sociale, synthese, genereLe });
  const fichier = cheminRapport(entreprise.id, mois);

  const depot = await admin.storage
    .from(BUCKET_RAPPORTS)
    .upload(fichier, pdf, { contentType: "application/pdf", upsert: true });
  if (depot.error) throw new Error(`fichier : ${depot.error.message}`);

  const ligne = existe
    ? await admin
        .from("rapport_mensuel")
        .update({ genere_le: genereLe })
        .eq("entreprise_id", entreprise.id)
        .eq("mois", mois)
        .is("envoye_le", null)
    : await admin
        .from("rapport_mensuel")
        .upsert(
          { entreprise_id: entreprise.id, mois, fichier, genere_le: genereLe },
          { onConflict: "entreprise_id,mois", ignoreDuplicates: true },
        );
  if (ligne.error) throw new Error(`rapport : ${ligne.error.code} ${ligne.error.message}`);
  return { synthese, pdf };
}

/** Réserve l'envoi : `false` si un autre passage l'a déjà fait. */
async function reserver(admin: SupabaseClient, entrepriseId: string, mois: string, envoyeA: string[]) {
  const { data, error } = await admin
    .from("rapport_mensuel")
    .update({ envoye_le: new Date().toISOString(), envoye_a: envoyeA })
    .eq("entreprise_id", entrepriseId)
    .eq("mois", mois)
    .is("envoye_le", null)
    .select("mois");
  if (error) throw new Error(`réservation : ${error.code} ${error.message}`);
  return data.length > 0;
}

/** Libère l'envoi réservé, pour que la tâche du lendemain le retente. */
async function liberer(admin: SupabaseClient, entrepriseId: string, mois: string) {
  const { error } = await admin
    .from("rapport_mensuel")
    .update({ envoye_le: null, envoye_a: null })
    .eq("entreprise_id", entrepriseId)
    .eq("mois", mois);
  if (error) console.error("rapport", entrepriseId, "libération", error.code, error.message);
}

/**
 * Produit et envoie le rapport du mois écoulé de chaque entreprise Pro qui ne l'a pas encore reçu. Relancée, la tâche
 * n'envoie rien de plus ; l'échec d'une entreprise n'arrête pas les autres. `admin` porte la clé secrète.
 */
export async function produireRapports({
  admin,
  envoyeur,
  aujourdhui = aujourdhuiParis(),
}: {
  admin: SupabaseClient;
  envoyeur: Envoyeur;
  aujourdhui?: string;
}): Promise<BilanRapports> {
  const mois = moisDuRapport(aujourdhui);
  const bilan: BilanRapports = { generes: 0, envoyes: 0, echecs: 0 };

  const [entreprises, rapports] = await Promise.all([
    entreprisesConcernees(admin, bornesMois(mois).fin),
    toutLire<{ entreprise_id: string; envoye_le: string | null }>(
      (debut, fin) =>
        admin
          .from("rapport_mensuel")
          .select("entreprise_id, envoye_le")
          .eq("mois", mois)
          .order("entreprise_id")
          .range(debut, fin),
      "rapports du mois",
    ),
  ]);
  const existants = new Map(rapports.map((rapport) => [rapport.entreprise_id, rapport]));

  for (const entreprise of entreprises) {
    const existant = existants.get(entreprise.id);
    if (existant?.envoye_le) continue;
    let reserve = false;
    try {
      const { synthese, pdf } = await produire(admin, entreprise, mois, Boolean(existant));
      bilan.generes += 1;

      const gestionnaire = await emailDuGestionnaire(admin, entreprise.user_id);
      const { a, cc } = destinatairesRapport(entreprise.emails_direction, gestionnaire);
      reserve = await reserver(admin, entreprise.id, mois, [...a, ...cc]);
      if (!reserve) continue;

      const contenu = emailRapport({
        raisonSociale: entreprise.raison_sociale,
        synthese,
        sansDirection: !entreprise.emails_direction.length,
      });
      // Envoyé mais sans réponse, puis relancé : Resend reconnaît le même email et ne le renvoie pas.
      const empreinte = await empreinteEmail(a.join(","), contenu.sujet, contenu.html);
      await envoyeur({
        a,
        cc,
        ...contenu,
        ...(entreprise.raison_sociale && { expediteur: `${entreprise.raison_sociale} via Désigno` }),
        repondreA: gestionnaire,
        piecesJointes: [{ nom: nomFichierRapport(mois), contenu: pdf, type: "application/pdf" }],
        cleIdempotence: `rapport/${entreprise.id}/${mois}/${empreinte}`,
      });
      bilan.envoyes += 1;
    } catch (erreur) {
      console.error("rapport", entreprise.id, erreur instanceof Error ? erreur.message : erreur);
      bilan.echecs += 1;
      if (reserve) await liberer(admin, entreprise.id, mois);
    }
  }
  return bilan;
}
