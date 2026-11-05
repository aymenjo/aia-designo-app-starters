import type Stripe from "stripe";
import { ajouterJours, partiesParis } from "@/lib/dates";
import type { FicheEntreprise } from "@/lib/entreprise/fiche";
import type { Plan } from "./plans";

// Les règles du passage en Pro (phase 18) et de l'impayé (phase 19), sans appel réseau : le statut d'un abonnement Stripe
// donne le plan, et le webhook décide ici d'appliquer ou non un événement. Stripe n'est importé que pour ses types.

/** Les statuts d'un abonnement Stripe ; la base les reprend (migration du passage en Pro). */
export const STATUTS_ABONNEMENT = [
  "incomplete",
  "incomplete_expired",
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "paused",
] as const;
export type StatutAbonnement = (typeof STATUTS_ABONNEMENT)[number];

/** Un statut que Stripe ajouterait : le webhook répond 500, et Stripe relance. On ne rétrograde jamais en silence. */
export class StatutInconnu extends Error {
  constructor(statut: string) {
    super(`statut d'abonnement inconnu : ${statut}`);
  }
}

function statutConnu(statut: string): StatutAbonnement {
  if (!(STATUTS_ABONNEMENT as readonly string[]).includes(statut)) throw new StatutInconnu(statut);
  return statut as StatutAbonnement;
}

/**
 * Pro tant que l'abonnement est payé ou en cours de relance (`past_due`) : au-delà de 7 jours d'impayé, Désigno annule
 * l'abonnement (`/api/cron/impayes`), qui passe alors en `canceled`. Tout autre statut connu donne Free.
 */
export function planDuStatut(statut: string): Plan {
  return ["active", "trialing", "past_due"].includes(statutConnu(statut)) ? "pro" : "free";
}

/**
 * Le rang d'un statut dans le cycle de vie : il départage deux événements du même abonnement émis à la même seconde
 * (`created` est en secondes). `past_due` passe avant `active` : un impayé relancé par Stripe (l'email avait échoué)
 * n'écrase pas la régularisation arrivée à la même seconde, ce qui laisserait le bandeau affiché pour de bon.
 */
export const RANG: Record<StatutAbonnement, number> = {
  incomplete: 0,
  past_due: 1,
  active: 2,
  trialing: 2,
  paused: 2,
  canceled: 3,
  unpaid: 3,
  incomplete_expired: 3,
};

/**
 * Un abonnement que Stripe ne fera plus jamais payer : annulé, ou expiré sans paiement. Tout autre statut, `incomplete`
 * compris (un 3DS peut encore aboutir), s'annule à la suppression du compte (phase 20).
 */
export function abonnementTermine(statut: string): boolean {
  return statut === "canceled" || statut === "incomplete_expired";
}

/**
 * L'abonnement suivi peut céder la place à un autre : il est fini, ou jamais payé. `incomplete` en fait partie : un 3DS
 * abandonné ne doit pas bloquer un nouveau paiement.
 */
export function remplacable(statut: StatutAbonnement | null): boolean {
  return statut === null || statut === "incomplete" || statut === "incomplete_expired" || statut === "canceled";
}

/** Un abonnement qui n'est pas remplaçable : ouvrir un second paiement ferait payer deux fois. */
export function abonnementEnCours(statut: StatutAbonnement | null): boolean {
  return !remplacable(statut);
}

/** Ce que l'entreprise a retenu du dernier événement appliqué, ou ce qu'apporte l'événement reçu. */
export type EtatSuivi = {
  abonnementId: string | null;
  statut: StatutAbonnement | null;
  /** `created` de l'événement, en millisecondes. */
  evenementLe: number | null;
};

export type Decision = { appliquer: true } | { appliquer: false; motif: "plus_ancien" | "autre_abonnement" };

/**
 * Appliquer ou non un événement d'abonnement. Seul l'abonnement suivi compte : un autre n'est appliqué que si le suivi
 * est vide ou remplaçable. Un événement plus ancien que le dernier appliqué est ignoré ; à la même seconde, le rang du
 * cycle de vie départage. À égalité de rang, l'événement est appliqué : un rejeu ne change rien.
 */
export function decisionEvenement(stocke: EtatSuivi, recu: EtatSuivi & { statut: StatutAbonnement }): Decision {
  const memeAbonnement = stocke.abonnementId === null || stocke.abonnementId === recu.abonnementId;
  if (!memeAbonnement && !remplacable(stocke.statut)) return { appliquer: false, motif: "autre_abonnement" };
  if (stocke.evenementLe !== null && recu.evenementLe !== null) {
    if (recu.evenementLe < stocke.evenementLe) return { appliquer: false, motif: "plus_ancien" };
    if (
      recu.evenementLe === stocke.evenementLe &&
      memeAbonnement &&
      stocke.statut !== null &&
      RANG[recu.statut] < RANG[stocke.statut]
    ) {
      return { appliquer: false, motif: "plus_ancien" };
    }
  }
  return { appliquer: true };
}

const idDe = (objet: string | { id: string }) => (typeof objet === "string" ? objet : objet.id);
const instant = (secondes: number) => new Date(secondes * 1000).toISOString();

export type EtatAbonnement = {
  abonnementId: string;
  clientId: string;
  statut: StatutAbonnement;
  plan: Plan;
  /** Le prochain prélèvement, ou la fin de l'abonnement si l'annulation est programmée. */
  finPeriode: string;
  annulationProgrammee: boolean;
  /** `metadata.entreprise_id`, posé par Checkout : retrouve l'entreprise si son client n'est pas encore enregistré. */
  entrepriseId: string | null;
  /** La dernière facture (`in_…`) : en `past_due`, celle qui n'est pas payée, que l'email d'impayé réserve. */
  derniereFacture: string | null;
};

/**
 * L'état d'un abonnement, tel que l'objet de l'événement le décrit. La période est sur les lignes de l'abonnement depuis
 * la version d'API 2025-03-31 : sans elle, l'endpoint du webhook est sur une ancienne version (docs/DEPLOIEMENT.md).
 */
export function etatAbonnement(abonnement: Stripe.Subscription): EtatAbonnement {
  const statut = statutConnu(abonnement.status);
  const fins = abonnement.items.data.map((ligne) => ligne.current_period_end);
  if (!fins.length || fins.some((fin) => typeof fin !== "number")) {
    throw new Error(`abonnement ${abonnement.id} sans période : vérifiez la version d'API de l'endpoint du webhook`);
  }
  const finPeriode = Math.max(...fins);
  const annulationProgrammee = abonnement.cancel_at_period_end || abonnement.cancel_at !== null;
  return {
    abonnementId: abonnement.id,
    clientId: idDe(abonnement.customer),
    statut,
    plan: planDuStatut(statut),
    finPeriode: instant(abonnement.cancel_at === null ? finPeriode : Math.min(abonnement.cancel_at, finPeriode)),
    annulationProgrammee,
    entrepriseId: abonnement.metadata.entreprise_id ?? null,
    derniereFacture: abonnement.latest_invoice ? idDe(abonnement.latest_invoice) : null,
  };
}

/** Les jours laissés pour régulariser un paiement en échec, avant le retour en Free. */
export const DELAI_IMPAYE_JOURS = 7;

/**
 * L'entrée de l'abonnement en `past_due` (`entreprise.paiement_echoue_le`), après l'événement reçu : gardée tant que
 * l'impayé dure, l'instant de l'événement (`creeLe`, en millisecondes) à l'entrée, vide hors impayé.
 */
export function paiementEchoueLe(
  stocke: { statut: StatutAbonnement | null; paiementEchoueLe: string | null },
  recu: StatutAbonnement,
  creeLe: number,
): string | null {
  if (recu !== "past_due") return null;
  if (stocke.statut === "past_due" && stocke.paiementEchoueLe) return stocke.paiementEchoueLe;
  return new Date(creeLe).toISOString();
}

/**
 * « 2026-10-25T09:00:00Z » → « 2026-11-01 » : la date limite pour régulariser, le jour de l'échec à Paris plus 7 jours.
 * C'est la dernière journée entière de Pro : la tâche des impayés annule l'abonnement le lendemain.
 */
export function limiteImpaye(echoueLe: string): string {
  return ajouterJours(partiesParis(echoueLe).date, DELAI_IMPAYE_JOURS);
}

/** Le client Stripe d'une entreprise : la facture porte sa raison sociale, l'adresse du siège, le SIREN et la TVA. */
export function parametresClient({
  fiche,
  email,
  entrepriseId,
}: {
  fiche: FicheEntreprise;
  email: string;
  entrepriseId: string;
}): Stripe.CustomerCreateParams {
  return {
    name: fiche.raison_sociale ?? undefined,
    email,
    address: {
      line1: fiche.siege_adresse ?? "",
      // Vide pour effacer un complément retiré de la fiche.
      line2: fiche.siege_complement ?? "",
      postal_code: fiche.siege_code_postal ?? "",
      city: fiche.siege_ville ?? "",
      country: "FR",
    },
    preferred_locales: ["fr"],
    invoice_settings: { custom_fields: fiche.siren ? [{ name: "SIREN", value: fiche.siren }] : [] },
    tax_id_data: fiche.tva ? [{ type: "eu_vat", value: fiche.tva }] : undefined,
    metadata: { entreprise_id: entrepriseId },
  };
}

/** Stripe exige au moins 30 minutes : une minute de plus couvre l'écart d'horloge avec ses serveurs. */
const DUREE_CHECKOUT_SECONDES = 31 * 60;

/**
 * La page de paiement : 49 € HT par mois, plus la TVA, par carte. Elle expire vite : deux pages ouvertes pourraient
 * donner deux abonnements (le webhook n'applique que le premier). Pas de code promo (hors périmètre).
 */
export function parametresCheckout({
  clientId,
  entrepriseId,
  prixId,
  tauxTvaId,
  urlSite,
  maintenant = new Date(),
}: {
  clientId: string;
  entrepriseId: string;
  prixId: string;
  tauxTvaId: string;
  urlSite: string;
  maintenant?: Date;
}): Stripe.Checkout.SessionCreateParams {
  const abonnement = `${urlSite.replace(/\/+$/, "")}/parametres/abonnement`;
  return {
    mode: "subscription",
    customer: clientId,
    client_reference_id: entrepriseId,
    line_items: [{ price: prixId, quantity: 1, tax_rates: [tauxTvaId] }],
    allowed_payment_method_types: ["card"],
    locale: "fr",
    subscription_data: { metadata: { entreprise_id: entrepriseId } },
    success_url: `${abonnement}?paiement=reussi`,
    cancel_url: abonnement,
    expires_at: Math.floor(maintenant.getTime() / 1000) + DUREE_CHECKOUT_SECONDES,
  };
}

export type Facture = {
  id: string;
  numero: string;
  clientId: string | null;
  /** `metadata.entreprise_id` de l'abonnement facturé. */
  entrepriseId: string | null;
  totalCentimes: number;
  payeeLe: string;
  /** La période facturée : celle de la ligne d'abonnement (la facture elle-même porte la période écoulée). */
  debutPeriode: string;
  finPeriode: string;
  pdf: string | null;
  enLigne: string | null;
};

/** Ce que l'email de facture reprend d'une facture payée (`invoice.paid`). */
export function contenuFacture(facture: Stripe.Invoice): Facture {
  const periode = facture.lines.data[0]?.period ?? { start: facture.period_start, end: facture.period_end };
  return {
    id: facture.id,
    numero: facture.number ?? facture.id,
    clientId: facture.customer ? idDe(facture.customer) : null,
    entrepriseId: facture.parent?.subscription_details?.metadata?.entreprise_id ?? null,
    totalCentimes: facture.total,
    payeeLe: instant(facture.status_transitions.paid_at ?? facture.created),
    debutPeriode: instant(periode.start),
    finPeriode: instant(periode.end),
    pdf: facture.invoice_pdf ?? null,
    enLigne: facture.hosted_invoice_url ?? null,
  };
}

export const MESSAGES_ABONNEMENT = {
  ficheIncomplete:
    "Complétez d'abord la fiche entreprise : la facture porte la raison sociale, le SIREN et le n° de TVA.",
  dejaPro: "Votre entreprise a déjà un abonnement Pro : gérez-le depuis cet écran.",
  indisponible: "Le paiement en ligne est indisponible pour le moment.",
} as const;
