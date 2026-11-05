import type { SupabaseClient } from "@supabase/supabase-js";
import { COLONNES_FICHE, type FicheEntreprise } from "@/lib/entreprise/fiche";
import { ficheComplete } from "@/lib/entreprise/regles";
import type { Plan } from "./plans";
import {
  MESSAGES_ABONNEMENT,
  abonnementEnCours,
  parametresCheckout,
  parametresClient,
  type StatutAbonnement,
} from "./regles";
import type { ClientStripe } from "./stripe";

// « Passer en Pro » et « Gérer mon abonnement » (phase 18) : l'écran Abonnement ouvre une page sécurisée de Stripe. Rien
// ne change ici : seul le webhook passe le compte en Pro. `supabase` porte la session du gestionnaire (RLS) ; `admin`,
// la clé secrète, n'écrit que le client Stripe, que le gestionnaire ne peut pas écrire lui-même.

export type ResultatRedirection = { ok: true; url: string } | { ok: false; erreur: string };

type Entreprise = FicheEntreprise & {
  id: string;
  plan: Plan;
  stripe_client_id: string | null;
  abonnement_statut: StatutAbonnement | null;
};

async function lireEntreprise(supabase: SupabaseClient) {
  const [entreprise, session] = await Promise.all([
    supabase
      .from("entreprise")
      .select(`id, plan, stripe_client_id, abonnement_statut, ${COLONNES_FICHE}`)
      .single<Entreprise>(),
    supabase.auth.getClaims(),
  ]);
  if (entreprise.error) throw entreprise.error;
  const email = session.data?.claims.email;
  if (typeof email !== "string") throw new Error("session sans email");
  return { entreprise: entreprise.data, email };
}

/**
 * Le client Stripe de l'entreprise : créé au premier clic, puis enregistré seulement s'il n'y en a pas déjà un. Après un
 * double clic, le second relit celui du premier (le client en trop, sans abonnement, ne coûte rien).
 */
async function clientDe({
  admin,
  stripe,
  entreprise,
  email,
}: {
  admin: SupabaseClient;
  stripe: ClientStripe;
  entreprise: Entreprise;
  email: string;
}): Promise<string> {
  const parametres = parametresClient({ fiche: entreprise, email, entrepriseId: entreprise.id });
  if (entreprise.stripe_client_id) {
    // La fiche a pu changer depuis : la facture doit porter la raison sociale et la TVA d'aujourd'hui.
    await stripe.mettreAJourClient(entreprise.stripe_client_id, parametres);
    return entreprise.stripe_client_id;
  }

  const cree = await stripe.creerClient(parametres);
  const { data, error } = await admin
    .from("entreprise")
    .update({ stripe_client_id: cree })
    .eq("id", entreprise.id)
    .is("stripe_client_id", null)
    .select("stripe_client_id");
  if (error) throw error;
  if (data.length) return cree;

  const deja = await admin.from("entreprise").select("stripe_client_id").eq("id", entreprise.id).single();
  if (deja.error) throw deja.error;
  return deja.data.stripe_client_id as string;
}

/** La page de paiement du Pro, si la fiche est complète et qu'aucun abonnement n'est en cours. */
export async function preparerPaiement({
  supabase,
  admin,
  stripe,
  urlSite,
}: {
  supabase: SupabaseClient;
  admin: SupabaseClient;
  stripe: ClientStripe | null;
  urlSite: string;
}): Promise<ResultatRedirection> {
  const { entreprise, email } = await lireEntreprise(supabase);
  if (!ficheComplete(entreprise)) return { ok: false, erreur: MESSAGES_ABONNEMENT.ficheIncomplete };
  if (entreprise.plan === "pro" || abonnementEnCours(entreprise.abonnement_statut)) {
    return { ok: false, erreur: MESSAGES_ABONNEMENT.dejaPro };
  }
  if (!stripe) return { ok: false, erreur: MESSAGES_ABONNEMENT.indisponible };

  const clientId = await clientDe({ admin, stripe, entreprise, email });
  const { prixId, tauxTvaId } = await stripe.tarif();
  const url = await stripe.sessionCheckout(
    parametresCheckout({ clientId, entrepriseId: entreprise.id, prixId, tauxTvaId, urlSite }),
  );
  return { ok: true, url };
}

/** Le portail client de Stripe : carte, factures et annulation. Il revient sur l'écran Abonnement. */
export async function preparerPortail({
  supabase,
  stripe,
  urlSite,
}: {
  supabase: SupabaseClient;
  stripe: ClientStripe | null;
  urlSite: string;
}): Promise<ResultatRedirection> {
  const { data, error } = await supabase.from("entreprise").select("stripe_client_id").single<{
    stripe_client_id: string | null;
  }>();
  if (error) throw error;
  if (!stripe || !data.stripe_client_id) return { ok: false, erreur: MESSAGES_ABONNEMENT.indisponible };
  const url = await stripe.sessionPortail({
    customer: data.stripe_client_id,
    return_url: `${urlSite.replace(/\/+$/, "")}/parametres/abonnement`,
    locale: "fr",
  });
  return { ok: true, url };
}

/**
 * Après un enregistrement de la fiche entreprise, le client Stripe qui existe déjà reprend la fiche : les factures
 * suivantes portent la nouvelle raison sociale. Une fiche incomplète attend le prochain enregistrement, ou le paiement.
 */
export async function synchroniserApresFiche({
  stripe,
  clientId,
  entrepriseId,
  email,
  fiche,
}: {
  stripe: ClientStripe;
  clientId: string;
  entrepriseId: string;
  email: string;
  fiche: FicheEntreprise;
}): Promise<void> {
  if (!ficheComplete(fiche)) return;
  await stripe.mettreAJourClient(clientId, parametresClient({ fiche, email, entrepriseId }));
}
