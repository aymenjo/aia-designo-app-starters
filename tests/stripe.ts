import Stripe from "stripe";
import { VERSION_API_STRIPE } from "@/lib/abonnement/catalogue";
import { PRIX_PRO_HT_CENTIMES, PRIX_PRO_TTC_CENTIMES } from "@/lib/abonnement/plans";
import type { StatutAbonnement } from "@/lib/abonnement/regles";

// Les objets Stripe que reçoit le webhook, à la version d'API de Désigno, réduits aux champs utiles et signés comme
// Stripe les signe. Partagés par les tests unitaires, d'intégration et E2E : la CI ne parle jamais à Stripe.

/** Le secret de `npm run env:local` (scripts/env-supabase-local.sh), celui du serveur en local et en CI. */
export const SECRET_WEBHOOK = process.env.STRIPE_WEBHOOK_SECRET ?? "whsec_local";

let compteur = 0;
/** « sub_t1a2b3… » : un id unique, pour que les tests ne se croisent pas en base. */
export function idStripe(prefixe: "cus" | "sub" | "in" | "evt" | "si") {
  compteur += 1;
  return `${prefixe}_t${Date.now().toString(36)}${compteur.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Un instant Stripe : des secondes depuis l'époque. */
export const secondes = (iso: string) => Math.floor(Date.parse(iso) / 1000);

export function abonnement({
  id = idStripe("sub"),
  client,
  statut = "active",
  entrepriseId,
  debutPeriode = secondes("2026-10-25T09:00:00Z"),
  finPeriode = secondes("2026-11-25T09:00:00Z"),
  annulationFinPeriode = false,
  annulationLe = null,
  derniereFacture = null,
}: {
  id?: string;
  client: string;
  statut?: StatutAbonnement | (string & {});
  entrepriseId?: string;
  debutPeriode?: number;
  finPeriode?: number;
  annulationFinPeriode?: boolean;
  annulationLe?: number | null;
  /** `latest_invoice` : l'id de la dernière facture, celle qu'un `past_due` n'a pas payée. */
  derniereFacture?: string | null;
}) {
  return {
    id,
    object: "subscription",
    customer: client,
    status: statut,
    latest_invoice: derniereFacture,
    cancel_at_period_end: annulationFinPeriode,
    cancel_at: annulationLe,
    canceled_at: annulationLe,
    created: debutPeriode,
    livemode: false,
    metadata: entrepriseId ? { entreprise_id: entrepriseId } : {},
    items: {
      object: "list",
      has_more: false,
      data: [
        {
          id: idStripe("si"),
          object: "subscription_item",
          current_period_start: debutPeriode,
          current_period_end: finPeriode,
          quantity: 1,
          price: { id: "price_designo_pro", object: "price", unit_amount: PRIX_PRO_HT_CENTIMES, currency: "eur" },
        },
      ],
    },
  } as unknown as Stripe.Subscription;
}

export function facture({
  id = idStripe("in"),
  client,
  entrepriseId,
  numero = "DESIGNO-0001",
  nomClient = "Plomberie Martin",
  totalCentimes = PRIX_PRO_TTC_CENTIMES,
  payeeLe = secondes("2026-10-25T09:00:30Z"),
  debutPeriode = secondes("2026-10-25T09:00:00Z"),
  finPeriode = secondes("2026-11-25T09:00:00Z"),
}: {
  id?: string;
  client: string;
  entrepriseId?: string;
  numero?: string;
  nomClient?: string;
  totalCentimes?: number;
  payeeLe?: number;
  debutPeriode?: number;
  finPeriode?: number;
}) {
  return {
    id,
    object: "invoice",
    number: numero,
    customer: client,
    customer_name: nomClient,
    currency: "eur",
    status: "paid",
    subtotal: PRIX_PRO_HT_CENTIMES,
    total: totalCentimes,
    amount_paid: totalCentimes,
    created: debutPeriode,
    // La facture d'un abonnement payé d'avance porte la période écoulée : vide pour la première.
    period_start: debutPeriode,
    period_end: debutPeriode,
    status_transitions: { finalized_at: debutPeriode, paid_at: payeeLe, marked_uncollectible_at: null, voided_at: null },
    invoice_pdf: `https://pay.stripe.com/invoice/${id}/pdf`,
    hosted_invoice_url: `https://invoice.stripe.com/i/${id}`,
    livemode: false,
    parent: {
      type: "subscription_details",
      quote_details: null,
      subscription_details: { metadata: entrepriseId ? { entreprise_id: entrepriseId } : {}, subscription: idStripe("sub") },
    },
    lines: {
      object: "list",
      has_more: false,
      data: [{ object: "line_item", amount: PRIX_PRO_HT_CENTIMES, period: { start: debutPeriode, end: finPeriode } }],
    },
  } as unknown as Stripe.Invoice;
}

export function evenement<T>(
  type: string,
  objet: T,
  { cree = secondes("2026-10-25T09:00:00Z"), id = idStripe("evt") } = {},
) {
  return {
    id,
    object: "event",
    api_version: VERSION_API_STRIPE,
    created: cree,
    type,
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    data: { object: objet },
  };
}

/** Le corps brut et l'en-tête `Stripe-Signature`, tels que Stripe les envoie. */
export function signer(evenementStripe: unknown, secret = SECRET_WEBHOOK) {
  const corps = JSON.stringify(evenementStripe);
  return { corps, signature: Stripe.webhooks.generateTestHeaderString({ payload: corps, secret }) };
}
