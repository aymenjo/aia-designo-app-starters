import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { preparerPaiement, preparerPortail, synchroniserApresFiche } from "@/lib/abonnement/paiement";
import { MESSAGES_ABONNEMENT } from "@/lib/abonnement/regles";
import type { ClientStripe } from "@/lib/abonnement/stripe";
import { enregistrerFiche, lireFiche } from "@/lib/entreprise/fiche";
import { tvaDepuisSiren } from "@/lib/entreprise/regles";
import { admin, passerEnPro, premiereConnexion, suffixeUnique, supprimerGestionnaire, type Gestionnaire } from "./outils";

// « Passer en Pro » et « Gérer mon abonnement » (phase 18), avec un faux client Stripe : rien ne part chez Stripe, et
// rien ne passe en Pro ici, seul le webhook le fait.

const suffixe = suffixeUnique();
const URL_SITE = "https://designo.test";
const URL_CHECKOUT = "https://checkout.stripe.com/c/pay/cs_test_faux";
const URL_PORTAIL = "https://billing.stripe.com/p/session/test_faux";
const gestionnaires: Gestionnaire[] = [];

async function compte(nom: string, { fiche = true } = {}) {
  const g = await premiereConnexion(`paiement-${nom}-${suffixe}@exemple.fr`);
  gestionnaires.push(g);
  if (fiche) {
    const resultat = await enregistrerFiche(g.client, {
      raison_sociale: "Plomberie Martin",
      siren: "404833048",
      tva: tvaDepuisSiren("404833048"),
      representant_prenom: "Claire",
      representant_nom: "Martin",
      representant_fonction: "Gérante",
      siege_adresse: "12 rue des Lilas",
      siege_code_postal: "69003",
      siege_ville: "Lyon",
    });
    if (!resultat.ok) throw new Error(`fiche : ${JSON.stringify(resultat.erreurs)}`);
  }
  return g;
}

afterAll(async () => {
  for (const g of gestionnaires) await supprimerGestionnaire(g);
});

/** Un client Stripe qui note ses appels. */
function fauxStripe() {
  let clients = 0;
  const appels = {
    creerClient: [] as Parameters<ClientStripe["creerClient"]>[0][],
    mettreAJourClient: [] as { id: string; parametres: Parameters<ClientStripe["mettreAJourClient"]>[1] }[],
    sessionCheckout: [] as Parameters<ClientStripe["sessionCheckout"]>[0][],
    sessionPortail: [] as Parameters<ClientStripe["sessionPortail"]>[0][],
  };
  const stripe: ClientStripe = {
    tarif: async () => ({ prixId: "price_faux", tauxTvaId: "txr_faux" }),
    creerClient: async (parametres) => {
      appels.creerClient.push(parametres);
      clients += 1;
      return `cus_faux${suffixe.replaceAll("-", "")}${clients}${Math.random().toString(36).slice(2, 6)}`;
    },
    mettreAJourClient: async (id, parametres) => {
      appels.mettreAJourClient.push({ id, parametres });
    },
    sessionCheckout: async (parametres) => {
      appels.sessionCheckout.push(parametres);
      return URL_CHECKOUT;
    },
    sessionPortail: async (parametres) => {
      appels.sessionPortail.push(parametres);
      return URL_PORTAIL;
    },
    // L'annulation d'un impayé et la suppression de compte ont leurs propres tests (impayes.test.ts,
    // suppression-compte.test.ts).
    abonnement: async () => {
      throw new Error("non utilisé ici");
    },
    abonnementsDuClient: async () => {
      throw new Error("non utilisé ici");
    },
    annulerAbonnement: async () => {
      throw new Error("non utilisé ici");
    },
    annulerFacture: async () => {
      throw new Error("non utilisé ici");
    },
  };
  return { stripe, appels };
}

async function clientEnregistre(g: Gestionnaire) {
  const { data, error } = await admin.from("entreprise").select("stripe_client_id, plan").eq("id", g.entrepriseId).single();
  if (error) throw error;
  return data;
}

const payer = (g: Gestionnaire, stripe: ClientStripe | null) =>
  preparerPaiement({ supabase: g.client, admin, stripe, urlSite: URL_SITE });

describe("preparerPaiement : refus", () => {
  it("une fiche entreprise incomplète ne peut pas passer en Pro", async () => {
    const g = await compte("incomplete", { fiche: false });
    const { stripe, appels } = fauxStripe();
    expect(await payer(g, stripe)).toEqual({ ok: false, erreur: MESSAGES_ABONNEMENT.ficheIncomplete });
    expect(appels.creerClient).toHaveLength(0);
  });

  it("sans Stripe configuré, le paiement est indisponible", async () => {
    const g = await compte("sans-stripe");
    expect(await payer(g, null)).toEqual({ ok: false, erreur: MESSAGES_ABONNEMENT.indisponible });
    expect((await clientEnregistre(g)).stripe_client_id).toBeNull();
  });

  it("un compte déjà Pro ne paie pas une seconde fois", async () => {
    const g = await compte("deja-pro");
    await passerEnPro(g.entrepriseId);
    const { stripe, appels } = fauxStripe();
    expect(await payer(g, stripe)).toEqual({ ok: false, erreur: MESSAGES_ABONNEMENT.dejaPro });
    expect(appels.sessionCheckout).toHaveLength(0);
  });

  it("un abonnement en cours, même en Free, empêche d'en ouvrir un second", async () => {
    const g = await compte("en-cours");
    const { error } = await admin.from("entreprise").update({ abonnement_statut: "past_due" }).eq("id", g.entrepriseId);
    if (error) throw error;
    const { stripe } = fauxStripe();
    expect(await payer(g, stripe)).toEqual({ ok: false, erreur: MESSAGES_ABONNEMENT.dejaPro });
  });
});

describe("preparerPaiement : la page de paiement", () => {
  let g: Gestionnaire;
  let client: string;

  beforeAll(async () => {
    g = await compte("checkout");
  });

  it("au premier clic, crée le client Stripe à la raison sociale, l'enregistre, et ouvre Checkout", async () => {
    const { stripe, appels } = fauxStripe();
    expect(await payer(g, stripe)).toEqual({ ok: true, url: URL_CHECKOUT });

    expect(appels.creerClient).toEqual([
      expect.objectContaining({
        name: "Plomberie Martin",
        email: `paiement-checkout-${suffixe}@exemple.fr`,
        tax_id_data: [{ type: "eu_vat", value: tvaDepuisSiren("404833048") }],
        metadata: { entreprise_id: g.entrepriseId },
      }),
    ]);
    const enregistre = await clientEnregistre(g);
    expect(enregistre).toMatchObject({ plan: "free", stripe_client_id: expect.stringMatching(/^cus_faux/) });
    client = enregistre.stripe_client_id!;

    expect(appels.sessionCheckout).toEqual([
      expect.objectContaining({
        customer: client,
        client_reference_id: g.entrepriseId,
        line_items: [{ price: "price_faux", quantity: 1, tax_rates: ["txr_faux"] }],
        success_url: `${URL_SITE}/parametres/abonnement?paiement=reussi`,
      }),
    ]);
  });

  it("au clic suivant, réutilise le client, mis à jour d'après la fiche", async () => {
    const corrige = await enregistrerFiche(g.client, { ...(await lireFiche(g.client)), raison_sociale: "Martin SARL" });
    expect(corrige.ok).toBe(true);
    const { stripe, appels } = fauxStripe();
    expect(await payer(g, stripe)).toEqual({ ok: true, url: URL_CHECKOUT });
    expect(appels.creerClient).toHaveLength(0);
    expect(appels.mettreAJourClient).toEqual([
      { id: client, parametres: expect.objectContaining({ name: "Martin SARL" }) },
    ]);
    expect(appels.sessionCheckout[0]).toMatchObject({ customer: client });
  });

  it("après un double clic, les deux pages visent le même client enregistré", async () => {
    const h = await compte("double-clic");
    const { stripe, appels } = fauxStripe();
    const resultats = await Promise.all([payer(h, stripe), payer(h, stripe)]);
    expect(resultats.every(({ ok }) => ok)).toBe(true);
    const { stripe_client_id } = await clientEnregistre(h);
    expect(appels.sessionCheckout.map(({ customer }) => customer)).toEqual([stripe_client_id, stripe_client_id]);
  });
});

describe("preparerPortail", () => {
  it("sans client Stripe, le portail est indisponible", async () => {
    const g = await compte("portail-vide", { fiche: false });
    const { stripe } = fauxStripe();
    expect(await preparerPortail({ supabase: g.client, stripe, urlSite: URL_SITE })).toEqual({
      ok: false,
      erreur: MESSAGES_ABONNEMENT.indisponible,
    });
  });

  it("ouvre le portail du client, qui revient sur l'écran Abonnement", async () => {
    const g = await compte("portail");
    const { stripe, appels } = fauxStripe();
    await payer(g, stripe);
    const { stripe_client_id } = await clientEnregistre(g);
    expect(await preparerPortail({ supabase: g.client, stripe, urlSite: `${URL_SITE}/` })).toEqual({
      ok: true,
      url: URL_PORTAIL,
    });
    expect(appels.sessionPortail).toEqual([
      { customer: stripe_client_id, return_url: `${URL_SITE}/parametres/abonnement`, locale: "fr" },
    ]);
  });
});

describe("synchroniserApresFiche", () => {
  it("recopie une fiche complète sur le client ; une fiche incomplète attend", async () => {
    const g = await compte("synchro", { fiche: false });
    const { stripe, appels } = fauxStripe();
    const synchro = { stripe, clientId: "cus_synchro", entrepriseId: g.entrepriseId, email: "a@exemple.fr" };
    await synchroniserApresFiche({ ...synchro, fiche: await lireFiche(g.client) });
    expect(appels.mettreAJourClient).toHaveLength(0);

    const complete = await compte("synchro-complete");
    await synchroniserApresFiche({ ...synchro, fiche: await lireFiche(complete.client) });
    expect(appels.mettreAJourClient).toEqual([
      { id: "cus_synchro", parametres: expect.objectContaining({ name: "Plomberie Martin" }) },
    ]);
  });
});
