import type { SupabaseClient } from "@supabase/supabase-js";
import { aujourdhuiParis } from "@/lib/dates";
import { limiteImpaye } from "./regles";
import type { ClientStripe } from "./stripe";

// La tâche des impayés (phase 19), appelée chaque nuit par Vercel (`/api/cron/impayes`). Désigno compte les 7 jours :
// le webhook date l'entrée en `past_due`, et le lendemain de la date limite, l'abonnement est annulé chez Stripe. Le
// webhook `customer.subscription.deleted` repasse alors le compte en Free : `plan` reste écrit par le seul webhook.
// `supabase` porte la clé secrète ; `aujourdhui` (à Paris) est injecté, comme pour les alertes.

export type BilanImpayes = { annules: number; echecs: number };

type Impaye = { id: string; stripe_abonnement_id: string; paiement_echoue_le: string };

/**
 * Pour chaque entreprise en `past_due` au-delà de sa date limite : l'abonnement est relu chez Stripe, puis annulé s'il
 * est toujours impayé, et sa facture restée ouverte est annulée (void) : les 7 jours sont offerts. L'abonnement d'abord :
 * la facture annulée en premier le ferait repasser par `active`. Un abonnement que Stripe ne donne plus en `past_due`
 * (payé entre-temps, ou déjà annulé) est laissé : le webhook resynchronisera. Relancée le même jour, la tâche ne trouve
 * plus rien à annuler. Un échec est journalisé et compté, sans arrêter les autres entreprises.
 */
export async function ramenerImpayesEnFree({
  supabase,
  stripe,
  aujourdhui = aujourdhuiParis(),
}: {
  supabase: SupabaseClient;
  stripe: ClientStripe;
  aujourdhui?: string;
}): Promise<BilanImpayes> {
  const { data, error } = await supabase
    .from("entreprise")
    .select("id, stripe_abonnement_id, paiement_echoue_le")
    .eq("abonnement_statut", "past_due")
    .not("stripe_abonnement_id", "is", null)
    .not("paiement_echoue_le", "is", null)
    .overrideTypes<Impaye[], { merge: false }>();
  if (error) throw new Error(`impayés : ${error.code} ${error.message}`);

  const bilan: BilanImpayes = { annules: 0, echecs: 0 };
  for (const entreprise of data.filter(({ paiement_echoue_le }) => aujourdhui > limiteImpaye(paiement_echoue_le))) {
    const abonnementId = entreprise.stripe_abonnement_id;
    let facture: string | null = null;
    try {
      const relu = await stripe.abonnement(abonnementId);
      if (relu.statut !== "past_due") continue;
      await stripe.annulerAbonnement(abonnementId, "Paiement en échec depuis plus de 7 jours : retour en Free.");
      bilan.annules++;
      if (relu.factureStatut !== "open" || !relu.factureId) continue;
      facture = relu.factureId;
      await stripe.annulerFacture(facture, `impaye/void/${facture}`);
    } catch (erreur) {
      // La facture reste due chez Stripe, mais ne sera plus prélevée : elle s'annule à la main (docs/DEPLOIEMENT.md).
      console.error("impayés", { entreprise: entreprise.id, abonnement: abonnementId, facture }, erreur instanceof Error ? erreur.message : erreur);
      bilan.echecs++;
    }
  }
  return bilan;
}
