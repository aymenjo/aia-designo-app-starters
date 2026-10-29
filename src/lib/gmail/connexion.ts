import type { SupabaseClient } from "@supabase/supabase-js";
import type { Plan } from "@/lib/abonnement/plans";
import { emailDuGestionnaire } from "@/lib/email/destinataire";
import type { Envoyeur } from "@/lib/email/envoi";
import { AccesGmailRefuse, type ClientComposio, type LibelleGmail, type StatutCompte } from "./composio";
import { emailInterruption } from "./email-interruption";
import { MESSAGES_GMAIL } from "./regles";

// La connexion de la boîte Gmail (phase 23) : la connecter, choisir son libellé, la déconnecter, et signaler son
// interruption. Le gestionnaire agit sous sa session, qui donne son entreprise et son plan ; la connexion s'écrit ensuite
// avec la clé secrète (`admin`), une fois le compte vérifié chez Composio : la RLS ne donne aucune écriture.

export type ConnexionGmail = {
  id: string;
  entreprise_id: string;
  compte_id: string;
  email_compte: string | null;
  libelle_id: string | null;
  libelle_nom: string | null;
  declencheur_id: string | null;
  active_depuis: string | null;
  interrompue_le: string | null;
  interruption_signalee_le: string | null;
};

export const COLONNES_CONNEXION =
  "id, entreprise_id, compte_id, email_compte, libelle_id, libelle_nom, declencheur_id, active_depuis, interrompue_le, interruption_signalee_le";

/** La connexion Gmail de l'entreprise : sous la session du gestionnaire, la sienne. */
export function lireConnexionGmail(supabase: SupabaseClient, entrepriseId?: string) {
  const requete = supabase.from("connexion_google").select(COLONNES_CONNEXION).eq("service", "gmail");
  return (entrepriseId ? requete.eq("entreprise_id", entrepriseId) : requete).maybeSingle<ConnexionGmail>();
}

export type Refus = { ok: false; erreur: string };
const refus = (erreur: string): Refus => ({ ok: false, erreur });

/** L'entreprise du gestionnaire et son plan, sous sa session. L'agenda (phase 22) s'en sert aussi. */
export async function monEntreprise(supabase: SupabaseClient) {
  const { data, error } = await supabase.from("entreprise").select("id, plan").single<{ id: string; plan: Plan }>();
  if (error) throw new Error(`entreprise : ${error.code} ${error.message}`);
  return data;
}

/** « Connecter Gmail » et « Reconnecter Gmail » : le lien de connexion de Composio, en Pro seulement. */
export async function demarrerConnexion({
  supabase,
  composio,
  urlSite,
}: {
  supabase: SupabaseClient;
  composio: ClientComposio | null;
  urlSite: string;
}): Promise<{ ok: true; url: string } | Refus> {
  if (!composio) return refus(MESSAGES_GMAIL.indisponible);
  const entreprise = await monEntreprise(supabase);
  if (entreprise.plan !== "pro") return refus(MESSAGES_GMAIL.fonctionPro);
  const url = await composio.lienConnexion(entreprise.id, `${urlSite.replace(/\/+$/, "")}/parametres/integrations/retour`);
  return { ok: true, url };
}

/** Au retour de Google, le compte peut encore s'activer : on le relit quelques secondes. L'agenda s'en sert aussi. */
export async function statutFinal(
  composio: Pick<ClientComposio, "statutCompte">,
  entrepriseId: string,
  compteId: string,
  attente: number,
) {
  let statut: StatutCompte | null = null;
  for (let essai = 0; essai < 5; essai++) {
    statut = await composio.statutCompte(entrepriseId, compteId);
    if (statut !== "INITIALIZING" && statut !== "INITIATED") return statut;
    await new Promise((fin) => setTimeout(fin, attente));
  }
  return statut;
}

export type ResultatRetour =
  | {
      ok: true;
      /** La connexion était interrompue : les emails de la coupure ne sont pas rattrapés, l'écran le dit. */
      reconnecte: boolean;
    }
  | Refus;

/**
 * Le retour de Google : le compte connecté est enregistré, s'il a bien été créé pour cette entreprise (l'id vient de
 * l'adresse de retour, que le navigateur peut changer) et qu'il est actif. Sur une reconnexion, le libellé est gardé s'il
 * existe dans la boîte, et la relève reprend sur un nouveau déclencheur ; l'ancien compte et son déclencheur sont ensuite
 * supprimés chez Composio. Les emails reçus pendant la coupure ne sont pas rattrapés.
 */
export async function enregistrerRetour({
  supabase,
  admin,
  composio,
  compteId,
  attente = 1_000,
}: {
  supabase: SupabaseClient;
  admin: SupabaseClient;
  composio: ClientComposio | null;
  compteId: string;
  attente?: number;
}): Promise<ResultatRetour> {
  if (!composio) return refus(MESSAGES_GMAIL.indisponible);
  if (!/^ca_[A-Za-z0-9_-]+$/.test(compteId)) return refus(MESSAGES_GMAIL.compteInconnu);
  const entreprise = await monEntreprise(supabase);
  const statut = await statutFinal(composio, entreprise.id, compteId, attente);
  if (statut === null) return refus(MESSAGES_GMAIL.compteInconnu);
  if (statut !== "ACTIVE") return refus(MESSAGES_GMAIL.connexionRefusee);

  const ancienne = await lireConnexionGmail(admin, entreprise.id);
  if (ancienne.error) throw new Error(`connexion Gmail : ${ancienne.error.code} ${ancienne.error.message}`);
  if (ancienne.data?.compte_id === compteId) return { ok: true, reconnecte: false };
  // Passé en Free entre le lien et le retour : le compte tout juste créé est révoqué.
  if (entreprise.plan !== "pro") {
    await composio.supprimerCompte(compteId);
    return refus(MESSAGES_GMAIL.fonctionPro);
  }

  const adresse = await composio.adresse(compteId);
  const libelleGarde = ancienne.data?.libelle_id
    ? ((await composio.libelles(compteId)).find(({ id }) => id === ancienne.data!.libelle_id) ?? null)
    : null;
  const declencheur = libelleGarde ? await composio.creerDeclencheur(entreprise.id, compteId, libelleGarde.id) : null;

  const { error } = await admin.from("connexion_google").upsert(
    {
      entreprise_id: entreprise.id,
      service: "gmail",
      compte_id: compteId,
      email_compte: adresse,
      libelle_id: libelleGarde?.id ?? null,
      libelle_nom: libelleGarde?.nom ?? null,
      declencheur_id: declencheur,
      active_depuis: declencheur ? new Date().toISOString() : null,
      interrompue_le: null,
      interruption_signalee_le: null,
    },
    { onConflict: "entreprise_id,service" },
  );
  if (error) {
    if (declencheur) await composio.supprimerDeclencheur(declencheur).catch(() => undefined);
    throw new Error(`connexion Gmail : ${error.code} ${error.message}`);
  }

  if (ancienne.data) await oublierChezComposio(composio, ancienne.data);
  return { ok: true, reconnecte: ancienne.data?.interrompue_le != null };
}

/** L'ancien compte et son déclencheur : leurs événements sont déjà ignorés, leur suppression n'est qu'un nettoyage. */
async function oublierChezComposio(composio: ClientComposio, { compte_id, declencheur_id }: ConnexionGmail) {
  try {
    if (declencheur_id) await composio.supprimerDeclencheur(declencheur_id);
    await composio.supprimerCompte(compte_id);
  } catch (erreur) {
    console.error("gmail", "ancien compte", compte_id, erreur instanceof Error ? erreur.message : erreur);
  }
}

/** Les libellés de la boîte, pour le choix ; `null` si Google refuse l'accès (la connexion est interrompue). */
export async function libellesDeLaBoite(composio: ClientComposio, compteId: string): Promise<LibelleGmail[] | null> {
  try {
    return await composio.libelles(compteId);
  } catch (erreur) {
    if (erreur instanceof AccesGmailRefuse) return null;
    throw erreur;
  }
}

/**
 * « Choisir ce libellé » et « Changer de libellé » : un nouveau déclencheur relève ce libellé, puis l'ancien est supprimé.
 * Seuls les emails qui y arrivent ensuite sont relevés. Le libellé doit exister dans la boîte et avoir été créé par le
 * gestionnaire.
 */
export async function choisirLibelle({
  supabase,
  admin,
  composio,
  libelleId,
}: {
  supabase: SupabaseClient;
  admin: SupabaseClient;
  composio: ClientComposio | null;
  libelleId: string;
}): Promise<{ ok: true } | Refus> {
  if (!composio) return refus(MESSAGES_GMAIL.indisponible);
  if (!libelleId) return refus(MESSAGES_GMAIL.libelleVide);
  const entreprise = await monEntreprise(supabase);
  if (entreprise.plan !== "pro") return refus(MESSAGES_GMAIL.fonctionPro);
  const connexion = await lireConnexionGmail(admin, entreprise.id);
  if (connexion.error) throw new Error(`connexion Gmail : ${connexion.error.code} ${connexion.error.message}`);
  if (!connexion.data) return refus(MESSAGES_GMAIL.pasConnecte);
  const actuelle = connexion.data;
  if (actuelle.libelle_id === libelleId && actuelle.declencheur_id) return { ok: true };

  const libelles = await libellesDeLaBoite(composio, actuelle.compte_id);
  if (!libelles) return refus(MESSAGES_GMAIL.bandeau(actuelle.libelle_nom));
  const libelle = libelles.find(({ id }) => id === libelleId);
  if (!libelle) return refus(MESSAGES_GMAIL.libelleIntrouvable);

  const declencheur = await composio.creerDeclencheur(entreprise.id, actuelle.compte_id, libelle.id);
  // Une reconnexion, ou un autre choix, a pu passer entre-temps : l'écriture ne vaut que pour la connexion lue.
  const requete = admin
    .from("connexion_google")
    .update({
      libelle_id: libelle.id,
      libelle_nom: libelle.nom,
      declencheur_id: declencheur,
      active_depuis: new Date().toISOString(),
    })
    .eq("id", actuelle.id)
    .eq("compte_id", actuelle.compte_id);
  const { data, error } = await (actuelle.declencheur_id
    ? requete.eq("declencheur_id", actuelle.declencheur_id)
    : requete.is("declencheur_id", null)
  ).select("id");
  if (error || !data.length) {
    await composio.supprimerDeclencheur(declencheur).catch(() => undefined);
    if (error) throw new Error(`libellé Gmail : ${error.code} ${error.message}`);
    return refus(MESSAGES_GMAIL.indisponible);
  }
  if (actuelle.declencheur_id) {
    await composio.supprimerDeclencheur(actuelle.declencheur_id).catch((erreur: unknown) => {
      console.error("gmail", "ancien déclencheur", erreur instanceof Error ? erreur.message : erreur);
    });
  }
  return { ok: true };
}

/**
 * Déconnecte Gmail : le déclencheur, puis le compte connecté, sont supprimés chez Composio, ce qui révoque l'accès, puis la
 * connexion est effacée. Les emails relevés et leurs avis restent. Lève une erreur si Composio ne répond pas : la
 * connexion reste alors en place. « Déconnecter Gmail » s'en sert, et la suppression de compte (phase 20) aussi.
 */
export async function deconnecterGmail({
  admin,
  composio,
  entrepriseId,
}: {
  admin: SupabaseClient;
  composio: ClientComposio | null;
  entrepriseId: string;
}): Promise<void> {
  const connexion = await lireConnexionGmail(admin, entrepriseId);
  if (connexion.error) throw new Error(`connexion Gmail : ${connexion.error.code} ${connexion.error.message}`);
  if (!connexion.data) return;
  if (!composio) throw new Error("Composio n'est pas configuré : la connexion Gmail ne peut pas être révoquée");
  if (connexion.data.declencheur_id) await composio.supprimerDeclencheur(connexion.data.declencheur_id);
  await composio.supprimerCompte(connexion.data.compte_id);
  const { error } = await admin.from("connexion_google").delete().eq("id", connexion.data.id);
  if (error) throw new Error(`connexion Gmail : ${error.code} ${error.message}`);
}

export type ReponseWebhook = { statut: number; message: string };

/**
 * Signale l'interruption de la relève : la connexion est datée (le bandeau), puis le gestionnaire reçoit un seul email par
 * interruption, réservé avant l'envoi. Si l'envoi échoue, la réservation est libérée et la réponse 500 fait relancer
 * Composio. En Free, la relève est en pause : rien n'est envoyé, et le bandeau attend le retour en Pro. Le compte expiré
 * d'un agenda (phase 22) est seulement daté : la carte Intégrations le montre, sans bandeau ni email.
 */
export async function signalerInterruption({
  admin,
  envoyeur,
  urlSite,
  compteId,
}: {
  admin: SupabaseClient;
  envoyeur: Envoyeur | null;
  urlSite: string;
  compteId: string;
}): Promise<ReponseWebhook> {
  const { data: connexion, error } = await admin
    .from("connexion_google")
    .select(`${COLONNES_CONNEXION}, service, entreprise:entreprise(user_id, plan)`)
    .eq("compte_id", compteId)
    .maybeSingle<ConnexionGmail & { service: "gmail" | "agenda"; entreprise: { user_id: string; plan: Plan } }>();
  if (error) throw new Error(`connexion Gmail : ${error.code} ${error.message}`);
  if (!connexion) return { statut: 200, message: "compte inconnu : ignoré" };

  if (!connexion.interrompue_le) {
    const datation = await admin
      .from("connexion_google")
      .update({ interrompue_le: new Date().toISOString() })
      .eq("id", connexion.id)
      .eq("compte_id", compteId)
      .is("interrompue_le", null);
    if (datation.error) throw new Error(`interruption : ${datation.error.code} ${datation.error.message}`);
  }
  if (connexion.service === "agenda") return { statut: 200, message: "rappels interrompus" };
  if (connexion.entreprise.plan !== "pro") return { statut: 200, message: "interruption notée, relève en pause" };
  if (!envoyeur) return { statut: 503, message: "Aucun envoi d'email configuré" };

  const reservation = await admin
    .from("connexion_google")
    .update({ interruption_signalee_le: new Date().toISOString() })
    .eq("id", connexion.id)
    .eq("compte_id", compteId)
    .not("interrompue_le", "is", null)
    .is("interruption_signalee_le", null)
    .select("id");
  if (reservation.error) throw new Error(`interruption : ${reservation.error.code} ${reservation.error.message}`);
  if (!reservation.data.length) return { statut: 200, message: "interruption déjà signalée" };

  try {
    const a = await emailDuGestionnaire(admin, connexion.entreprise.user_id);
    const contenu = emailInterruption({ libelle: connexion.libelle_nom, urlSite });
    await envoyeur({ a, ...contenu, cleIdempotence: `interruption-gmail/${compteId}` });
  } catch (erreur) {
    console.error("gmail", "interruption", compteId, erreur instanceof Error ? erreur.message : erreur);
    const liberation = await admin
      .from("connexion_google")
      .update({ interruption_signalee_le: null })
      .eq("id", connexion.id)
      .eq("compte_id", compteId);
    if (liberation.error) console.error("gmail", "libération", liberation.error.code, liberation.error.message);
    return { statut: 500, message: "interruption non signalée : Composio relancera" };
  }
  return { statut: 200, message: "interruption signalée" };
}
