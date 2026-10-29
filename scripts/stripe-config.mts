// Le catalogue et le portail Stripe de Désigno (phase 18) : `npm run stripe:config`, en test puis en live.
// Idempotent : relancé, il retrouve ce qui existe déjà et ne crée que ce qui manque. Lancé par Node seul (les types sont
// retirés à la volée) : il importe les fichiers de src/ par leur chemin, Node ne résout pas l'alias `@/`.
// La clé `sk_test_…` ou `sk_live_…` est lue dans .env.development.local, ou dans l'environnement.
import Stripe from "stripe";
import { CLE_PRIX_PRO, METADONNEE_TVA, PRODUIT_PRO, VERSION_API_STRIPE } from "../src/lib/abonnement/catalogue.ts";
import { PRIX_PRO_HT_CENTIMES, TAUX_TVA } from "../src/lib/abonnement/plans.ts";

const cle = process.env.STRIPE_SECRET_KEY;
if (!cle) {
  console.error("STRIPE_SECRET_KEY manquante : mets la clé secrète Stripe dans .env.development.local (voir .env.example).");
  process.exit(1);
}
const live = /^[sr]k_live_/.test(cle);
const dashboard = live ? "https://dashboard.stripe.com" : "https://dashboard.stripe.com/test";
console.log(`Stripe en mode ${live ? "LIVE" : "test"}, API ${VERSION_API_STRIPE}\n`);

const stripe = new Stripe(cle, { apiVersion: VERSION_API_STRIPE });
const POURCENTAGE_TVA = TAUX_TVA * 100;

async function produit() {
  try {
    const existant = await stripe.products.retrieve(PRODUIT_PRO);
    if (existant.active) return { produit: existant, cree: false };
    return { produit: await stripe.products.update(PRODUIT_PRO, { active: true }), cree: false };
  } catch (erreur) {
    if (!(erreur instanceof Stripe.errors.StripeInvalidRequestError) || erreur.code !== "resource_missing") throw erreur;
    return { produit: await stripe.products.create({ id: PRODUIT_PRO, name: "Désigno Pro" }), cree: true };
  }
}

/** Le prix mensuel, retrouvé par sa lookup_key. S'il ne correspond plus à l'offre, un nouveau prix reprend la clé. */
async function prix() {
  const { data } = await stripe.prices.list({ lookup_keys: [CLE_PRIX_PRO], active: true, limit: 1 });
  const existant = data[0];
  const conforme =
    existant &&
    existant.product === PRODUIT_PRO &&
    existant.unit_amount === PRIX_PRO_HT_CENTIMES &&
    existant.currency === "eur" &&
    existant.recurring?.interval === "month" &&
    existant.recurring.interval_count === 1 &&
    existant.tax_behavior === "exclusive";
  if (conforme) return { prix: existant, cree: false };

  const nouveau = await stripe.prices.create({
    product: PRODUIT_PRO,
    nickname: "Désigno Pro mensuel",
    unit_amount: PRIX_PRO_HT_CENTIMES,
    currency: "eur",
    recurring: { interval: "month" },
    tax_behavior: "exclusive",
    lookup_key: CLE_PRIX_PRO,
    transfer_lookup_key: true,
  });
  // Les abonnements en cours gardent l'ancien prix : l'archiver empêche seulement d'en ouvrir de nouveaux.
  if (existant) await stripe.prices.update(existant.id, { active: false });
  return { prix: nouveau, cree: true };
}

/** Le taux « TVA FR 20 % », exclusif : il s'ajoute au prix HT. Son pourcentage ne se modifie pas : un écart en crée un autre. */
async function tauxTva() {
  const actifs = await stripe.taxRates.list({ active: true, limit: 100 }).autoPagingToArray({ limit: 1000 });
  const nos = actifs.filter((taux) => taux.metadata?.[METADONNEE_TVA.cle] === METADONNEE_TVA.valeur);
  const conforme = nos.find((taux) => taux.percentage === POURCENTAGE_TVA && !taux.inclusive && taux.country === "FR");
  if (conforme) return { taux: conforme, cree: false };

  const nouveau = await stripe.taxRates.create({
    display_name: "TVA",
    description: `TVA FR ${POURCENTAGE_TVA} %`,
    percentage: POURCENTAGE_TVA,
    inclusive: false,
    country: "FR",
    jurisdiction: "FR",
    tax_type: "vat",
    metadata: { [METADONNEE_TVA.cle]: METADONNEE_TVA.valeur },
  });
  for (const ancien of nos) await stripe.taxRates.update(ancien.id, { active: false });
  return { taux: nouveau, cree: true };
}

/**
 * Le portail client : carte, historique des factures et annulation en fin de période. Le gestionnaire n'y change ni son
 * adresse ni son offre : la fiche entreprise est la source de vérité, et il n'y a qu'une offre. La configuration par
 * défaut n'existe qu'après un premier enregistrement dans le Dashboard : le script la met à jour, sans la créer.
 */
async function portail() {
  const { data } = await stripe.billingPortal.configurations.list({ is_default: true, limit: 1 });
  if (!data[0]) {
    console.error(
      `\nAucune configuration par défaut du portail client. Ouvre ${dashboard}/settings/billing/portal, clique sur ` +
        "« Enregistrer » une première fois, puis relance `npm run stripe:config`.",
    );
    process.exit(1);
  }
  return stripe.billingPortal.configurations.update(data[0].id, {
    business_profile: { headline: "Désigno Pro : votre carte, vos factures et votre abonnement." },
    features: {
      payment_method_update: { enabled: true },
      invoice_history: { enabled: true },
      subscription_cancel: { enabled: true, mode: "at_period_end", proration_behavior: "none" },
      customer_update: { enabled: false },
      subscription_update: { enabled: false },
    },
  });
}

const etat = (cree: boolean) => (cree ? "créé" : "déjà là");

const { produit: unProduit, cree: produitCree } = await produit();
console.log(`Produit       ${unProduit.id} « ${unProduit.name} » (${etat(produitCree)})`);
const { prix: unPrix, cree: prixCree } = await prix();
console.log(`Prix          ${unPrix.id} · ${CLE_PRIX_PRO} · ${PRIX_PRO_HT_CENTIMES / 100} € HT/mois (${etat(prixCree)})`);
const { taux, cree: tauxCree } = await tauxTva();
console.log(`TVA           ${taux.id} · ${taux.percentage} % exclusive (${etat(tauxCree)})`);
const configuration = await portail();
console.log(`Portail       ${configuration.id} : carte, factures, annulation en fin de période (mis à jour)`);

console.log(`
Reste à faire à la main dans le Dashboard (${dashboard}), une fois par mode (docs/DEPLOIEMENT.md, « Stripe ») :
  1. Developers › Webhooks : un endpoint https://<site>/api/webhooks/stripe, version d'API ${VERSION_API_STRIPE},
     sur customer.subscription.created, customer.subscription.updated, customer.subscription.deleted et invoice.paid.
     Son secret whsec_… va dans STRIPE_WEBHOOK_SECRET (Vercel).
  2. Settings › Customer emails : désactiver les emails de Stripe (factures et reçus) : Désigno envoie la facture.
  3. Settings › Invoices : le n° de TVA de Désigno et les mentions légales du gabarit de facture.`);
