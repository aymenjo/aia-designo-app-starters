import type { SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { emailDuGestionnaire } from "@/lib/email/destinataire";
import type { Envoyeur } from "@/lib/email/envoi";
import type { Plan } from "./plans";
import { emailFacture } from "./email-facture";
import { emailImpaye } from "./email-impaye";
import {
  contenuFacture,
  decisionEvenement,
  etatAbonnement,
  limiteImpaye,
  paiementEchoueLe,
  type EtatAbonnement,
  type StatutAbonnement,
} from "./regles";

// Le webhook Stripe (phases 18 et 19), avec la clé secrète : seul lui écrit `plan`. Il recopie l'abonnement d'après
// l'objet de l'événement, sans appeler l'API de Stripe, envoie la facture payée, et signale le premier échec de paiement
// de chaque facture. Stripe relance pendant 3 jours tout ce qui ne répond pas 2xx : une réponse 500 est une demande de
// relance, une réponse 200 un « reçu, rien de plus à faire ».

export type ReponseWebhook = {
  statut: number;
  message: string;
  /** L'abonnement recopié : la route synchronise l'agenda (phase 22) d'une entreprise passée en Pro. */
  applique?: { entrepriseId: string; plan: Plan };
};

/** L'abonnement retenu par l'entreprise, lu avant l'écriture et comparé pendant celle-ci. */
const COLONNES =
  "id, user_id, raison_sociale, stripe_client_id, stripe_abonnement_id, abonnement_statut, stripe_evenement_le, paiement_echoue_le";
type Entreprise = {
  id: string;
  user_id: string;
  raison_sociale: string | null;
  stripe_client_id: string | null;
  stripe_abonnement_id: string | null;
  abonnement_statut: StatutAbonnement | null;
  stripe_evenement_le: string | null;
  paiement_echoue_le: string | null;
};

/** Ce qu'il faut pour envoyer un email depuis le webhook. */
type Envoi = { envoyeur: Envoyeur | null; urlSite: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * L'entreprise du client Stripe ; sinon celle de `metadata.entreprise_id` (posé par Checkout), tant qu'elle n'a pas
 * d'autre client. `null` : un client que Désigno ne connaît pas (un autre usage du compte Stripe), ignoré.
 */
async function trouverEntreprise(
  supabase: SupabaseClient,
  { clientId, entrepriseId }: { clientId: string | null; entrepriseId: string | null },
): Promise<Entreprise | null> {
  if (clientId) {
    const { data, error } = await supabase
      .from("entreprise")
      .select(COLONNES)
      .eq("stripe_client_id", clientId)
      .maybeSingle<Entreprise>();
    if (error) throw new Error(`entreprise du client : ${error.code} ${error.message}`);
    if (data) return data;
  }
  if (!entrepriseId || !UUID.test(entrepriseId)) return null;
  const { data, error } = await supabase
    .from("entreprise")
    .select(COLONNES)
    .eq("id", entrepriseId)
    .maybeSingle<Entreprise>();
  if (error) throw new Error(`entreprise des métadonnées : ${error.code} ${error.message}`);
  return data && (data.stripe_client_id === null || data.stripe_client_id === clientId) ? data : null;
}

/** Les colonnes que l'écriture compare à l'état lu. */
const SUIVI = ["stripe_client_id", "stripe_abonnement_id", "abonnement_statut", "stripe_evenement_le"] as const;

/**
 * Recopie l'abonnement reçu, s'il le faut (`decisionEvenement`), avec la date de l'impayé. L'écriture compare l'état lu :
 * un événement concurrent qui l'a changé entre-temps fait relire et redécider, trois fois au plus. Un impayé appliqué est
 * ensuite signalé au gestionnaire (`signalerImpaye`).
 */
async function appliquerAbonnement(
  supabase: SupabaseClient,
  recu: EtatAbonnement,
  creeLe: number,
  envoi: Envoi,
): Promise<ReponseWebhook> {
  for (let essai = 0; essai < 3; essai++) {
    const entreprise = await trouverEntreprise(supabase, recu);
    if (!entreprise) return { statut: 200, message: "client inconnu : ignoré" };

    const decision = decisionEvenement(
      {
        abonnementId: entreprise.stripe_abonnement_id,
        statut: entreprise.abonnement_statut,
        evenementLe: entreprise.stripe_evenement_le ? Date.parse(entreprise.stripe_evenement_le) : null,
      },
      { abonnementId: recu.abonnementId, statut: recu.statut, evenementLe: creeLe },
    );
    if (!decision.appliquer) {
      if (decision.motif === "autre_abonnement" && recu.plan === "pro") {
        // Deux pages de paiement ouvertes ont donné deux abonnements : le second se rembourse à la main.
        console.error("stripe", "abonnement en double", {
          entreprise: entreprise.id,
          suivi: entreprise.stripe_abonnement_id,
          recu: recu.abonnementId,
        });
      }
      return { statut: 200, message: `ignoré : ${decision.motif}` };
    }

    const echoueLe = paiementEchoueLe(
      { statut: entreprise.abonnement_statut, paiementEchoueLe: entreprise.paiement_echoue_le },
      recu.statut,
      creeLe,
    );
    let requete = supabase
      .from("entreprise")
      .update({
        plan: recu.plan,
        stripe_client_id: recu.clientId,
        stripe_abonnement_id: recu.abonnementId,
        abonnement_statut: recu.statut,
        fin_periode: recu.finPeriode,
        annulation_programmee: recu.annulationProgrammee,
        stripe_evenement_le: new Date(creeLe).toISOString(),
        paiement_echoue_le: echoueLe,
      })
      .eq("id", entreprise.id);
    for (const colonne of SUIVI) {
      const lue = entreprise[colonne];
      requete = lue === null ? requete.is(colonne, null) : requete.eq(colonne, lue);
    }
    const { data, error } = await requete.select("id");
    if (error) throw new Error(`abonnement : ${error.code} ${error.message}`);
    if (!data.length) continue;
    const applique = `appliqué : ${recu.statut} (${recu.plan})`;
    const plan = { entrepriseId: entreprise.id, plan: recu.plan };
    if (!echoueLe) return { statut: 200, message: applique, applique: plan };
    const signalement = await signalerImpaye({ supabase, ...envoi, entreprise, factureId: recu.derniereFacture, echoueLe, applique });
    return { ...signalement, applique: plan };
  }
  throw new Error("abonnement : l'entreprise change sans cesse, Stripe relancera");
}

/**
 * Signale l'impayé au gestionnaire, une seule fois par facture : la facture est réservée avant l'envoi. L'email donne la
 * date limite ; le bandeau de l'application prend ensuite le relais. Si l'envoi échoue, la réservation est libérée et la
 * réponse 500 fait relancer Stripe : l'abonnement, déjà recopié, ne change pas au rejeu.
 */
async function signalerImpaye({
  supabase,
  envoyeur,
  urlSite,
  entreprise,
  factureId,
  echoueLe,
  applique,
}: Envoi & {
  supabase: SupabaseClient;
  entreprise: Entreprise;
  factureId: string | null;
  echoueLe: string;
  applique: string;
}): Promise<ReponseWebhook> {
  if (!factureId) {
    console.error("stripe", "impayé sans facture", { entreprise: entreprise.id });
    return { statut: 200, message: `${applique}, sans facture à signaler` };
  }
  if (!envoyeur) return { statut: 503, message: "Aucun envoi d'email configuré" };

  const { data, error } = await supabase
    .from("impaye_signale")
    .upsert({ facture_id: factureId, entreprise_id: entreprise.id }, { onConflict: "facture_id", ignoreDuplicates: true })
    .select("facture_id");
  if (error) throw new Error(`réservation de l'impayé : ${error.code} ${error.message}`);
  if (!data.length) return { statut: 200, message: `${applique}, impayé déjà signalé` };

  try {
    const a = await emailDuGestionnaire(supabase, entreprise.user_id);
    const contenu = emailImpaye({ limite: limiteImpaye(echoueLe), urlSite });
    await envoyeur({ a, ...contenu, cleIdempotence: `impaye/${factureId}` });
  } catch (erreur) {
    console.error("stripe", "impayé", factureId, erreur instanceof Error ? erreur.message : erreur);
    const liberation = await supabase.from("impaye_signale").delete().eq("facture_id", factureId);
    if (liberation.error) console.error("stripe", "libération", liberation.error.code, liberation.error.message);
    return { statut: 500, message: "impayé non signalé : Stripe relancera" };
  }
  return { statut: 200, message: `${applique}, impayé signalé` };
}

/**
 * Envoie la facture payée au gestionnaire, une seule fois : la facture est réservée avant l'envoi. Si l'envoi échoue, la
 * réservation est libérée et la réponse 500 fait relancer Stripe.
 */
async function envoyerFacture({
  supabase,
  envoyeur,
  urlSite,
  facture: brute,
}: {
  supabase: SupabaseClient;
  envoyeur: Envoyeur | null;
  urlSite: string;
  facture: Stripe.Invoice;
}): Promise<ReponseWebhook> {
  const facture = contenuFacture(brute);
  const entreprise = await trouverEntreprise(supabase, facture);
  if (!entreprise) return { statut: 200, message: "client inconnu : ignoré" };
  if (!envoyeur) return { statut: 503, message: "Aucun envoi d'email configuré" };

  const { data, error } = await supabase
    .from("facture_envoyee")
    .upsert(
      { facture_id: facture.id, entreprise_id: entreprise.id },
      { onConflict: "facture_id", ignoreDuplicates: true },
    )
    .select("facture_id");
  if (error) throw new Error(`réservation de la facture : ${error.code} ${error.message}`);
  if (!data.length) return { statut: 200, message: "facture déjà envoyée" };

  try {
    const a = await emailDuGestionnaire(supabase, entreprise.user_id);
    const raisonSociale = entreprise.raison_sociale ?? brute.customer_name ?? "";
    const contenu = emailFacture({ facture, raisonSociale, urlSite });
    await envoyeur({ a, ...contenu, cleIdempotence: `facture/${facture.id}` });
  } catch (erreur) {
    console.error("stripe", "facture", facture.id, erreur instanceof Error ? erreur.message : erreur);
    const liberation = await supabase.from("facture_envoyee").delete().eq("facture_id", facture.id);
    if (liberation.error) console.error("stripe", "libération", liberation.error.code, liberation.error.message);
    return { statut: 500, message: "facture non envoyée : Stripe relancera" };
  }
  return { statut: 200, message: "facture envoyée" };
}

/**
 * Vérifie la signature de l'événement, puis le traite. `corps` est le corps brut, tel que Stripe l'a signé ; `supabase`
 * porte la clé secrète.
 */
export async function traiterWebhookStripe({
  corps,
  signature,
  secret,
  supabase,
  envoyeur,
  urlSite,
}: {
  corps: string;
  signature: string | null;
  secret: string;
  supabase: SupabaseClient;
  envoyeur: Envoyeur | null;
  urlSite: string;
}): Promise<ReponseWebhook> {
  let evenement: Stripe.Event;
  try {
    // La vérification n'a besoin que du secret de l'endpoint, pas d'une clé d'API.
    evenement = Stripe.webhooks.constructEvent(corps, signature ?? "", secret);
  } catch {
    return { statut: 400, message: "Signature invalide" };
  }

  try {
    switch (evenement.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        return await appliquerAbonnement(supabase, etatAbonnement(evenement.data.object), evenement.created * 1000, {
          envoyeur,
          urlSite,
        });
      case "invoice.paid":
        return await envoyerFacture({ supabase, envoyeur, urlSite, facture: evenement.data.object });
      default:
        return { statut: 200, message: `ignoré : ${evenement.type}` };
    }
  } catch (erreur) {
    console.error("stripe", evenement.id, evenement.type, erreur instanceof Error ? erreur.message : erreur);
    return { statut: 500, message: "Erreur interne : Stripe relancera" };
  }
}
