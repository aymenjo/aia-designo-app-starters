import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClientAgenda } from "@/lib/agenda/composio";
import { deconnecterAgenda, lireConnexionAgenda } from "@/lib/agenda/connexion";
import { abonnementTermine, type StatutAbonnement } from "@/lib/abonnement/regles";
import type { ClientStripe } from "@/lib/abonnement/stripe";
import { BUCKET_AVIS } from "@/lib/avis/avis";
import type { ClientComposio } from "@/lib/gmail/composio";
import { deconnecterGmail, lireConnexionGmail } from "@/lib/gmail/connexion";
import { BUCKET_RAPPORTS } from "@/lib/rapport/liste";
import { MESSAGES_COMPTE, confirmationCorrecte, texteConfirmation } from "./regles";

// La suppression de compte (phase 20). Le gestionnaire confirme sous sa session ; Désigno révoque alors Gmail chez
// Composio, supprime l'agenda « Désigno » chez Google puis révoque son compte, annule l'abonnement Stripe, vide les
// dossiers des fichiers (avis, rapports mensuels), puis supprime l'utilisateur avec la clé secrète (`admin`). La base fait le reste : l'entreprise
// et toutes ses tables partent en cascade. Le client Stripe et ses factures restent chez Stripe : Désigno doit conserver
// ses factures 10 ans.
//
// Règle d'extension (PLAN) : toute nouvelle donnée ou connexion externe s'ajoute ici. Les conversations avec l'agent
// (phase 26) s'effaceront aussi chez Anthropic.

export type Refus = { ok: false; erreur: string };

type Entreprise = {
  id: string;
  raison_sociale: string | null;
  stripe_client_id: string | null;
  abonnement_statut: StatutAbonnement | null;
};

const COMMENTAIRE_ANNULATION = "Suppression du compte Désigno.";

/**
 * Supprime le compte du gestionnaire, si sa saisie recopie la raison sociale (ou son email). Chaque étape est
 * idempotente : une relance après un échec reprend là où l'on s'était arrêté. Rien n'est effacé si Composio ou Stripe
 * manquent alors qu'il y a une connexion (Gmail, agenda) à révoquer ou un abonnement à annuler. Lève une erreur sur une
 * panne.
 */
export async function supprimerCompte({
  supabase,
  admin,
  stripe,
  composio,
  agenda,
  saisie,
}: {
  supabase: SupabaseClient;
  admin: SupabaseClient;
  stripe: ClientStripe | null;
  composio: ClientComposio | null;
  agenda: ClientAgenda | null;
  saisie: string;
}): Promise<{ ok: true } | Refus> {
  const [session, entreprise, gmail, connexionAgenda] = await Promise.all([
    supabase.auth.getClaims(),
    supabase
      .from("entreprise")
      .select("id, raison_sociale, stripe_client_id, abonnement_statut")
      .single<Entreprise>(),
    lireConnexionGmail(supabase),
    lireConnexionAgenda(supabase),
  ]);
  const userId = session.data?.claims.sub;
  const email = session.data?.claims.email;
  if (typeof userId !== "string" || typeof email !== "string") throw new Error("session sans utilisateur");
  if (entreprise.error) throw new Error(`entreprise : ${entreprise.error.code} ${entreprise.error.message}`);
  if (gmail.error) throw new Error(`connexion Gmail : ${gmail.error.code} ${gmail.error.message}`);
  if (connexionAgenda.error) {
    throw new Error(`connexion de l'agenda : ${connexionAgenda.error.code} ${connexionAgenda.error.message}`);
  }
  const { id: entrepriseId, raison_sociale, stripe_client_id, abonnement_statut } = entreprise.data;

  const attendu = texteConfirmation({ raisonSociale: raison_sociale, email });
  if (!confirmationCorrecte(saisie, attendu)) return { ok: false, erreur: MESSAGES_COMPTE.saisie(attendu.texte) };

  // Avant tout geste irréversible : une connexion qu'on ne pourrait pas révoquer, ou un abonnement qui continuerait.
  const abonnementEnCours = abonnement_statut !== null && !abonnementTermine(abonnement_statut);
  if ((gmail.data && !composio) || (connexionAgenda.data && !agenda) || (abonnementEnCours && !stripe)) {
    return { ok: false, erreur: MESSAGES_COMPTE.indisponible };
  }

  // Gmail d'abord : plus aucune relève ne dépose de fichier pendant la suite. Puis l'agenda, supprimé chez Google.
  await deconnecterGmail({ admin, composio, entrepriseId });
  await deconnecterAgenda({ admin, agenda, entrepriseId });
  if (stripe && stripe_client_id) await annulerAbonnements(stripe, stripe_client_id);
  // Les fichiers avant l'utilisateur : partis après lui, des fichiers restés ne se rattraperaient plus.
  await viderDossier(admin, BUCKET_AVIS, entrepriseId);
  await viderDossier(admin, BUCKET_RAPPORTS, entrepriseId);

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) throw new Error(`utilisateur : ${error.message}`);
  return { ok: true };
}

/**
 * Annule sur-le-champ, sans prorata, chaque abonnement du client qui n'est pas terminé : celui que suit la base, et un
 * éventuel double. Puis la dernière facture restée ouverte est annulée (void), comme à l'impayé : elle n'est plus due.
 * L'abonnement d'abord, comme en phase 19 ; un abonnement déjà annulé garde sa facture à annuler, si bien qu'une relance
 * après un échec la rattrape.
 */
async function annulerAbonnements(stripe: ClientStripe, clientId: string) {
  for (const { id, statut, factureId, factureStatut } of await stripe.abonnementsDuClient(clientId)) {
    if (!abonnementTermine(statut)) await stripe.annulerAbonnement(id, COMMENTAIRE_ANNULATION);
    if (factureId && factureStatut === "open") await stripe.annulerFacture(factureId, `suppression/void/${factureId}`);
  }
}

/**
 * Vide le dossier `{entreprise_id}/` d'un bucket (avis, rapports mensuels) : les fichiers ne partent pas en cascade avec
 * l'entreprise, et la base interdit de les effacer en SQL. Une page de 100 fichiers à la fois, jusqu'au dossier vide.
 * Une page qui ne se supprime pas lève une erreur, plutôt que de boucler.
 */
export async function viderDossier(admin: SupabaseClient, nomBucket: string, entrepriseId: string): Promise<void> {
  const bucket = admin.storage.from(nomBucket);
  for (;;) {
    const { data, error } = await bucket.list(entrepriseId);
    if (error) throw new Error(`fichiers : ${error.message}`);
    if (!data.length) return;
    const suppression = await bucket.remove(data.map(({ name }) => `${entrepriseId}/${name}`));
    if (suppression.error) throw new Error(`fichiers : ${suppression.error.message}`);
    if (!suppression.data.length) throw new Error(`fichiers : aucun fichier supprimé dans ${entrepriseId}/`);
  }
}
