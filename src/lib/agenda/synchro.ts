import type { SupabaseClient } from "@supabase/supabase-js";
import type { Plan } from "@/lib/abonnement/plans";
import { STATUTS_AVIS, estOuvert } from "@/lib/avis/regles";
import { toutLire } from "@/lib/supabase/lecture";
import { AccesAgendaRefuse, type ClientAgenda } from "./composio";
import { COLONNES_CONNEXION_AGENDA, type ConnexionAgenda } from "./connexion";
import {
  descriptionEvenement,
  idEvenement,
  jourRappel,
  planifierSynchro,
  titreEvenement,
  type EvenementPose,
  type EvenementVoulu,
} from "./regles";

// La synchronisation de l'agenda « Désigno » (phase 22), avec la clé secrète : elle tourne après chaque action sur un
// avis, après la lecture IA, à la connexion, au passage en Pro, et chaque nuit (/api/cron/agenda). Elle compare les avis
// ouverts aux événements posés (`evenement_agenda`), et n'appelle Google que pour les écarts. Tout est rejouable : l'id
// de l'événement est tiré de celui de l'avis, et une ligne n'est écrite qu'après la réponse de Google. Deux
// synchronisations qui se croisent ne créent donc jamais de doublon ; la dernière, ou celle de la nuit, a le dernier mot.

/** Les appels à Google en même temps, pour une entreprise : assez pour une flotte de 30 véhicules, sans quota dépassé. */
const CONCURRENCE = 5;

export type BilanSynchro = {
  /** `sans_connexion` : aucun agenda connecté, ou une connexion déjà interrompue, que seule la reconnexion relance. */
  etat: "sans_connexion" | "faite" | "interrompue";
  poses: number;
  retires: number;
  /** Les appels qui ont échoué pour une autre raison qu'un refus de Google : la synchronisation suivante les reprend. */
  echecs: number;
};

const SANS_CONNEXION: BilanSynchro = { etat: "sans_connexion", poses: 0, retires: 0, echecs: 0 };

type AvisOuvert = { id: string; numero: string | null; plaque: string | null; echeance: string };

/** Les événements que l'agenda doit montrer : un par avis ouvert qui a une échéance. */
async function evenementsVoulus(admin: SupabaseClient, entrepriseId: string, urlSite: string): Promise<EvenementVoulu[]> {
  const avis = await toutLire<AvisOuvert>(
    (debut, fin) =>
      admin
        .from("avis")
        .select("id, numero, plaque, echeance")
        .eq("entreprise_id", entrepriseId)
        .in("statut", STATUTS_AVIS.filter(estOuvert))
        .not("echeance", "is", null)
        .order("id")
        .range(debut, fin)
        .overrideTypes<AvisOuvert[], { merge: false }>(),
    "avis ouverts",
  );
  const site = urlSite.replace(/\/+$/, "");
  return avis.map((un) => ({
    avisId: un.id,
    jour: jourRappel(un.echeance),
    titre: titreEvenement(un),
    description: descriptionEvenement({ echeance: un.echeance, lien: `${site}/avis/${un.id}` }),
  }));
}

/** Exécute les tâches, `limite` à la fois ; `continuer` arrête d'en lancer de nouvelles (un refus de Google). */
async function enParallele(taches: (() => Promise<void>)[], limite: number, continuer: () => boolean) {
  let suivante = 0;
  const ouvrier = async () => {
    while (suivante < taches.length && continuer()) await taches[suivante++]();
  };
  await Promise.all(Array.from({ length: Math.min(limite, taches.length) }, ouvrier));
}

/**
 * Met l'agenda « Désigno » de l'entreprise d'accord avec ses avis ouverts. En Pro, chaque avis ouvert a son événement ;
 * en Free, rien n'est créé ni déplacé, mais un événement devenu faux est retiré. Un refus de Google (accès retiré,
 * agenda supprimé) date l'interruption et arrête tout : la carte Intégrations propose alors de reconnecter. Lève une
 * erreur si la base ne répond pas ; une panne de Google sur un événement est comptée, et reprise la fois suivante.
 */
export async function synchroniserAgenda({
  admin,
  agenda,
  entrepriseId,
  urlSite,
}: {
  admin: SupabaseClient;
  agenda: ClientAgenda | null;
  entrepriseId: string;
  urlSite: string;
}): Promise<BilanSynchro> {
  const { data: connexion, error } = await admin
    .from("connexion_google")
    .select(`${COLONNES_CONNEXION_AGENDA}, entreprise:entreprise(plan)`)
    .eq("service", "agenda")
    .eq("entreprise_id", entrepriseId)
    .maybeSingle<ConnexionAgenda & { entreprise: { plan: Plan } }>();
  if (error) throw new Error(`connexion de l'agenda : ${error.code} ${error.message}`);
  if (!connexion || connexion.interrompue_le) return SANS_CONNEXION;
  if (!agenda) throw new Error("Composio n'est pas configuré : l'agenda ne peut pas être synchronisé");

  const [voulus, poses] = await Promise.all([
    evenementsVoulus(admin, entrepriseId, urlSite),
    toutLire<EvenementPose>(
      (debut, fin) =>
        admin
          .from("evenement_agenda")
          .select("agenda_id, avis_id, jour, titre")
          .eq("entreprise_id", entrepriseId)
          .order("avis_id")
          .range(debut, fin),
      "événements posés",
    ),
  ]);
  const { aPoser, aRetirer, aOublier } = planifierSynchro({
    voulus,
    poses,
    agendaId: connexion.agenda_id,
    plan: connexion.entreprise.plan,
  });

  if (aOublier.length) {
    const oubli = await admin
      .from("evenement_agenda")
      .delete()
      .eq("entreprise_id", entrepriseId)
      .neq("agenda_id", connexion.agenda_id);
    if (oubli.error) throw new Error(`événements d'un ancien agenda : ${oubli.error.code} ${oubli.error.message}`);
  }

  const bilan: BilanSynchro = { etat: "faite", poses: 0, retires: 0, echecs: 0 };
  const { compte_id: compteId, agenda_id: agendaId } = connexion;
  // Chaque appel à Google, puis l'écriture de sa ligne : une ligne n'existe que pour un événement que Google a reçu.
  const appel =
    (
      sorte: "poses" | "retires",
      google: () => Promise<void>,
      ligne: () => PromiseLike<{ error: { message: string } | null }>,
    ) =>
    async () => {
      try {
        await google();
        const { error: erreurLigne } = await ligne();
        if (erreurLigne) throw new Error(`ligne de l'événement : ${erreurLigne.message}`);
        bilan[sorte] += 1;
      } catch (erreur) {
        if (erreur instanceof AccesAgendaRefuse) bilan.etat = "interrompue";
        else bilan.echecs += 1;
        console.error("agenda", entrepriseId, erreur instanceof Error ? erreur.message : erreur);
      }
    };

  const taches = [
    ...aRetirer.map((avisId) =>
      appel(
        "retires",
        () => agenda.retirerEvenement(compteId, agendaId, idEvenement(avisId)),
        () => admin.from("evenement_agenda").delete().eq("agenda_id", agendaId).eq("avis_id", avisId),
      ),
    ),
    ...aPoser.map((voulu) =>
      appel(
        "poses",
        () =>
          agenda.poserEvenement(compteId, agendaId, {
            id: idEvenement(voulu.avisId),
            jour: voulu.jour,
            titre: voulu.titre,
            description: voulu.description,
          }),
        () =>
          admin.from("evenement_agenda").upsert(
            {
              entreprise_id: entrepriseId,
              agenda_id: agendaId,
              avis_id: voulu.avisId,
              jour: voulu.jour,
              titre: voulu.titre,
              pose_le: new Date().toISOString(),
            },
            { onConflict: "agenda_id,avis_id" },
          ),
      ),
    ),
  ];
  await enParallele(taches, CONCURRENCE, () => bilan.etat !== "interrompue");

  if (bilan.etat === "interrompue") {
    // L'écriture ne vaut que pour la connexion lue : une reconnexion a pu passer entre-temps.
    const datation = await admin
      .from("connexion_google")
      .update({ interrompue_le: new Date().toISOString() })
      .eq("id", connexion.id)
      .eq("compte_id", compteId)
      .is("interrompue_le", null);
    if (datation.error) throw new Error(`interruption : ${datation.error.code} ${datation.error.message}`);
  }
  return bilan;
}

export type BilanAgendas = {
  /** Les entreprises synchronisées : leur agenda est connecté, et ses rappels ne sont pas interrompus. */
  entreprises: number;
  poses: number;
  retires: number;
  /** Les agendas dont Google a refusé l'accès cette fois-ci. */
  interrompus: number;
  /** Les entreprises dont la synchronisation a échoué, en tout ou en partie : la nuit suivante la reprend. */
  echecs: number;
};

/**
 * La tâche de la nuit : synchronise l'agenda de chaque entreprise connectée, l'une après l'autre. Elle rattrape ce que
 * la synchronisation après une action n'a pas pu faire : une panne de Google, une écriture faite hors des écrans, un
 * dépôt en double abandonné. L'échec d'une entreprise n'arrête pas les autres.
 */
export async function synchroniserTousLesAgendas({
  admin,
  agenda,
  urlSite,
}: {
  admin: SupabaseClient;
  agenda: ClientAgenda | null;
  urlSite: string;
}): Promise<BilanAgendas> {
  const connexions = await toutLire<{ entreprise_id: string }>(
    (debut, fin) =>
      admin
        .from("connexion_google")
        .select("entreprise_id")
        .eq("service", "agenda")
        .is("interrompue_le", null)
        .order("entreprise_id")
        .range(debut, fin),
    "connexions de l'agenda",
  );
  const bilan: BilanAgendas = { entreprises: 0, poses: 0, retires: 0, interrompus: 0, echecs: 0 };
  for (const { entreprise_id: entrepriseId } of connexions) {
    try {
      const resultat = await synchroniserAgenda({ admin, agenda, entrepriseId, urlSite });
      if (resultat.etat === "sans_connexion") continue;
      bilan.entreprises += 1;
      bilan.poses += resultat.poses;
      bilan.retires += resultat.retires;
      if (resultat.etat === "interrompue") bilan.interrompus += 1;
      if (resultat.echecs) bilan.echecs += 1;
    } catch (erreur) {
      console.error("agenda", entrepriseId, erreur instanceof Error ? erreur.message : erreur);
      bilan.echecs += 1;
    }
  }
  return bilan;
}
