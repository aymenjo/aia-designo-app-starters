import type { SupabaseClient } from "@supabase/supabase-js";
import { monEntreprise, statutFinal, type Refus } from "@/lib/gmail/connexion";
import { AccesAgendaRefuse, type ClientAgenda } from "./composio";
import { MESSAGES_AGENDA } from "./regles";

// La connexion de l'agenda Google (phase 22) : la connecter, ce qui crée l'agenda « Désigno », puis la déconnecter, ce
// qui le supprime. Sur le modèle de Gmail (src/lib/gmail/connexion.ts) : le gestionnaire agit sous sa session, qui donne
// son entreprise et son plan ; la connexion s'écrit ensuite avec la clé secrète (`admin`), une fois le compte vérifié
// chez Composio.

export type ConnexionAgenda = {
  id: string;
  entreprise_id: string;
  compte_id: string;
  email_compte: string | null;
  agenda_id: string;
  active_depuis: string;
  interrompue_le: string | null;
};

export const COLONNES_CONNEXION_AGENDA = "id, entreprise_id, compte_id, email_compte, agenda_id, active_depuis, interrompue_le";

/** La connexion de l'agenda : sous la session du gestionnaire, la sienne. */
export function lireConnexionAgenda(supabase: SupabaseClient, entrepriseId?: string) {
  const requete = supabase.from("connexion_google").select(COLONNES_CONNEXION_AGENDA).eq("service", "agenda");
  return (entrepriseId ? requete.eq("entreprise_id", entrepriseId) : requete).maybeSingle<ConnexionAgenda>();
}

const refus = (erreur: string): Refus => ({ ok: false, erreur });

/** « Connecter Google Calendar » et « Reconnecter Google Calendar » : le lien de connexion de Composio, en Pro seulement. */
export async function demarrerConnexion({
  supabase,
  agenda,
  urlSite,
}: {
  supabase: SupabaseClient;
  agenda: ClientAgenda | null;
  urlSite: string;
}): Promise<{ ok: true; url: string } | Refus> {
  if (!agenda) return refus(MESSAGES_AGENDA.indisponible);
  const entreprise = await monEntreprise(supabase);
  if (entreprise.plan !== "pro") return refus(MESSAGES_AGENDA.fonctionPro);
  const url = await agenda.lienConnexion(
    entreprise.id,
    `${urlSite.replace(/\/+$/, "")}/parametres/integrations/retour/agenda`,
  );
  return { ok: true, url };
}

export type ResultatRetour =
  | {
      ok: true;
      /** L'entreprise dont l'agenda est à synchroniser. */
      entrepriseId: string;
      /** La connexion était interrompue : les rappels reprennent. */
      reconnecte: boolean;
    }
  | Refus;

/**
 * Le retour de Google : le compte connecté est enregistré, s'il a bien été créé pour cette entreprise (l'id vient de
 * l'adresse de retour, que le navigateur peut changer) et qu'il est actif. Une reconnexion garde l'agenda « Désigno »
 * s'il existe encore et que ce compte y a accès ; sinon, un nouvel agenda est créé. L'ancien compte est ensuite oublié
 * chez Composio. Les événements sont posés ensuite, par la synchronisation.
 */
export async function enregistrerRetour({
  supabase,
  admin,
  agenda,
  compteId,
  attente = 1_000,
}: {
  supabase: SupabaseClient;
  admin: SupabaseClient;
  agenda: ClientAgenda | null;
  compteId: string;
  attente?: number;
}): Promise<ResultatRetour> {
  if (!agenda) return refus(MESSAGES_AGENDA.indisponible);
  if (!/^ca_[A-Za-z0-9_-]+$/.test(compteId)) return refus(MESSAGES_AGENDA.compteInconnu);
  const entreprise = await monEntreprise(supabase);
  const statut = await statutFinal(agenda, entreprise.id, compteId, attente);
  if (statut === null) return refus(MESSAGES_AGENDA.compteInconnu);
  if (statut !== "ACTIVE") return refus(MESSAGES_AGENDA.connexionRefusee);

  const ancienne = await lireConnexionAgenda(admin, entreprise.id);
  if (ancienne.error) throw new Error(`connexion de l'agenda : ${ancienne.error.code} ${ancienne.error.message}`);
  if (ancienne.data?.compte_id === compteId) return { ok: true, entrepriseId: entreprise.id, reconnecte: false };
  // Passé en Free entre le lien et le retour : le compte tout juste créé est révoqué.
  if (entreprise.plan !== "pro") {
    await agenda.supprimerCompte(compteId);
    return refus(MESSAGES_AGENDA.fonctionPro);
  }

  // L'adresse n'est qu'affichée : sans elle, la connexion vaut quand même.
  const adresse = await agenda.adresse(compteId).catch((erreur: unknown) => {
    console.error("agenda", "adresse", compteId, erreur instanceof Error ? erreur.message : erreur);
    return null;
  });
  const garde = ancienne.data && (await agenda.agendaExiste(compteId, ancienne.data.agenda_id)) ? ancienne.data.agenda_id : null;
  const agendaId = garde ?? (await agenda.creerAgenda(compteId));

  const { error } = await admin.from("connexion_google").upsert(
    {
      entreprise_id: entreprise.id,
      service: "agenda",
      compte_id: compteId,
      email_compte: adresse,
      agenda_id: agendaId,
      active_depuis: new Date().toISOString(),
      interrompue_le: null,
    },
    { onConflict: "entreprise_id,service" },
  );
  if (error) {
    if (!garde) await agenda.supprimerAgenda(compteId, agendaId).catch(() => undefined);
    throw new Error(`connexion de l'agenda : ${error.code} ${error.message}`);
  }

  if (ancienne.data) await oublierAncienCompte(agenda, ancienne.data, { agendaGarde: garde !== null });
  return { ok: true, entrepriseId: entreprise.id, reconnecte: ancienne.data?.interrompue_le != null };
}

/**
 * L'ancien compte, après une reconnexion : son agenda est supprimé s'il n'est pas repris (un autre compte Google), au
 * mieux, puis le compte est révoqué. Ce n'est qu'un nettoyage : la connexion pointe déjà vers le nouveau compte.
 */
async function oublierAncienCompte(
  agenda: ClientAgenda,
  { compte_id, agenda_id }: ConnexionAgenda,
  { agendaGarde }: { agendaGarde: boolean },
) {
  try {
    if (!agendaGarde) await agenda.supprimerAgenda(compte_id, agenda_id).catch(ignorerRefus);
    await agenda.supprimerCompte(compte_id);
  } catch (erreur) {
    console.error("agenda", "ancien compte", compte_id, erreur instanceof Error ? erreur.message : erreur);
  }
}

/** Un accès déjà retiré n'empêche pas la suite : l'agenda restera chez Google, mais Désigno n'y a plus accès. */
function ignorerRefus(erreur: unknown) {
  if (!(erreur instanceof AccesAgendaRefuse)) throw erreur;
  console.error("agenda", erreur.message);
}

/**
 * Déconnecte l'agenda : l'agenda « Désigno » est supprimé chez Google, au mieux (un accès déjà retiré n'empêche pas la
 * suite), puis le compte connecté chez Composio, ce qui révoque l'accès. La connexion et ses événements posés sont
 * ensuite effacés. Lève une erreur si Google ou Composio ne répondent pas : la connexion reste alors en place, et une
 * relance reprend. « Déconnecter Google Calendar » s'en sert, et la suppression de compte (phase 20) aussi.
 */
export async function deconnecterAgenda({
  admin,
  agenda,
  entrepriseId,
}: {
  admin: SupabaseClient;
  agenda: ClientAgenda | null;
  entrepriseId: string;
}): Promise<void> {
  const connexion = await lireConnexionAgenda(admin, entrepriseId);
  if (connexion.error) throw new Error(`connexion de l'agenda : ${connexion.error.code} ${connexion.error.message}`);
  if (connexion.data) {
    if (!agenda) throw new Error("Composio n'est pas configuré : l'agenda ne peut pas être supprimé");
    await agenda.supprimerAgenda(connexion.data.compte_id, connexion.data.agenda_id).catch(ignorerRefus);
    await agenda.supprimerCompte(connexion.data.compte_id);
    const { error } = await admin.from("connexion_google").delete().eq("id", connexion.data.id);
    if (error) throw new Error(`connexion de l'agenda : ${error.code} ${error.message}`);
  }
  const { error } = await admin.from("evenement_agenda").delete().eq("entreprise_id", entrepriseId);
  if (error) throw new Error(`événements de l'agenda : ${error.code} ${error.message}`);
}
