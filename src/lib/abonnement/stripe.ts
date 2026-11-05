import Stripe from "stripe";
import { CLE_PRIX_PRO, METADONNEE_TVA, VERSION_API_STRIPE } from "./catalogue";

// Les appels à l'API Stripe (phases 18 à 20) : le paiement, le portail, le client de facturation, et l'annulation d'un
// abonnement impayé ou d'un compte supprimé. Le client est injecté, comme l'envoyeur des emails et le lecteur des avis :
// les tests n'appellent jamais Stripe. Le webhook n'en a pas besoin : il vérifie la signature et lit l'objet reçu
// (src/lib/abonnement/webhook.ts).

/** Un abonnement relu chez Stripe, avec sa dernière facture : la tâche des impayés ne se fie pas qu'à la base. */
export type AbonnementRelu = { statut: string; factureId: string | null; factureStatut: string | null };

/** Un abonnement d'un client, relu chez Stripe, avec sa dernière facture. */
export type AbonnementDuClient = AbonnementRelu & { id: string };

export type ClientStripe = {
  /** Le prix du Pro et le taux de TVA, créés par `npm run stripe:config`. */
  tarif(): Promise<{ prixId: string; tauxTvaId: string }>;
  /** Crée le client de facturation ; renvoie son id (`cus_…`). */
  creerClient(parametres: Stripe.CustomerCreateParams): Promise<string>;
  /** Recopie la fiche entreprise sur le client, n° de TVA compris. */
  mettreAJourClient(id: string, parametres: Stripe.CustomerCreateParams): Promise<void>;
  /** Ouvre une page de paiement ; renvoie son adresse. */
  sessionCheckout(parametres: Stripe.Checkout.SessionCreateParams): Promise<string>;
  /** Ouvre le portail client ; renvoie son adresse. */
  sessionPortail(parametres: Stripe.BillingPortal.SessionCreateParams): Promise<string>;
  /** Relit un abonnement et sa dernière facture. */
  abonnement(id: string): Promise<AbonnementRelu>;
  /** Tous les abonnements du client, annulés compris, avec leur dernière facture : celui que suit la base, et un double. */
  abonnementsDuClient(clientId: string): Promise<AbonnementDuClient[]>;
  /**
   * Annule un abonnement sur-le-champ, sans prorata : le webhook `customer.subscription.deleted` repasse le compte en
   * Free. Le commentaire se lit dans le Dashboard de Stripe.
   */
  annulerAbonnement(id: string, commentaire: string): Promise<void>;
  /** Annule (void) une facture ouverte : elle n'est plus due, et Stripe ne la prélève plus. */
  annulerFacture(id: string, cleIdempotence: string): Promise<void>;
};

function relu({ status, latest_invoice }: Stripe.Subscription): AbonnementRelu {
  const facture = typeof latest_invoice === "string" ? null : latest_invoice;
  return {
    statut: status,
    factureId: typeof latest_invoice === "string" ? latest_invoice : (latest_invoice?.id ?? null),
    factureStatut: facture?.status ?? null,
  };
}

function clientStripe(stripe: Stripe): ClientStripe {
  return {
    async tarif() {
      const [prix, taux] = await Promise.all([
        stripe.prices.list({ lookup_keys: [CLE_PRIX_PRO], active: true, limit: 1 }),
        stripe.taxRates.list({ active: true, limit: 100 }),
      ]);
      const tva = taux.data.find(({ metadata }) => metadata?.[METADONNEE_TVA.cle] === METADONNEE_TVA.valeur);
      if (!prix.data[0] || !tva) throw new Error("prix ou TVA introuvable : lancez `npm run stripe:config`");
      return { prixId: prix.data[0].id, tauxTvaId: tva.id };
    },

    async creerClient(parametres) {
      return (await stripe.customers.create(parametres)).id;
    },

    async mettreAJourClient(id, { tax_id_data, ...parametres }) {
      await stripe.customers.update(id, parametres);
      // Un n° de TVA ne se modifie pas : on remplace celui qui a changé, et on retire celui qui a disparu.
      const voulu = tax_id_data?.[0]?.value ?? null;
      const { data } = await stripe.customers.listTaxIds(id, { limit: 100 });
      const actuels = data.filter(({ type }) => type === "eu_vat");
      for (const ancien of actuels.filter(({ value }) => value !== voulu)) {
        await stripe.customers.deleteTaxId(id, ancien.id);
      }
      if (voulu && !actuels.some(({ value }) => value === voulu)) {
        await stripe.customers.createTaxId(id, { type: "eu_vat", value: voulu });
      }
    },

    async sessionCheckout(parametres) {
      const session = await stripe.checkout.sessions.create(parametres);
      if (!session.url) throw new Error(`session Checkout ${session.id} sans adresse`);
      return session.url;
    },

    async sessionPortail(parametres) {
      return (await stripe.billingPortal.sessions.create(parametres)).url;
    },

    async abonnement(id) {
      return relu(await stripe.subscriptions.retrieve(id, { expand: ["latest_invoice"] }));
    },

    // Un abonnement par passage en Pro, et un double au plus : une page de 100 suffit.
    async abonnementsDuClient(clientId) {
      const { data } = await stripe.subscriptions.list({
        customer: clientId,
        status: "all",
        expand: ["data.latest_invoice"],
        limit: 100,
      });
      return data.map((abonnement) => ({ id: abonnement.id, ...relu(abonnement) }));
    },

    // Une suppression (DELETE) est idempotente d'elle-même : Stripe ignore une clé d'idempotence sur ces requêtes.
    async annulerAbonnement(id, commentaire) {
      await stripe.subscriptions.cancel(id, { cancellation_details: { comment: commentaire } });
    },

    async annulerFacture(id, cleIdempotence) {
      await stripe.invoices.voidInvoice(id, {}, { idempotencyKey: cleIdempotence });
    },
  };
}

/** Le client Stripe de l'application, ou `null` sans clé secrète : « Passer en Pro » est alors indisponible. */
export function clientStripeConfigure(): ClientStripe | null {
  const cle = process.env.STRIPE_SECRET_KEY;
  if (!cle) return null;
  return clientStripe(new Stripe(cle, { apiVersion: VERSION_API_STRIPE, maxNetworkRetries: 1, timeout: 20_000 }));
}
