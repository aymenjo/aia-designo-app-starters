import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LIMITES_FREE } from "@/lib/abonnement/plans";
import { SUJET_IMPAYE } from "@/lib/abonnement/email-impaye";
import { traiterWebhookStripe } from "@/lib/abonnement/webhook";
import { lireEtRemplirAvis, type Lecture } from "@/lib/avis/lecture";
import { CHAMPS_AVIS, aLireALOuverture } from "@/lib/avis/regles";
import type { Email, Envoyeur } from "@/lib/email/envoi";
import { abonnement, evenement, facture, idStripe, secondes, signer, SECRET_WEBHOOK } from "../stripe";
import {
  admin,
  avisEnBase,
  envoyerFichierAvis,
  premiereConnexion,
  suffixeUnique,
  supprimerGestionnaire,
  type Gestionnaire,
} from "./outils";

// Le webhook Stripe (phase 18), avec des événements signés comme Stripe les signe : la CI ne parle jamais à Stripe.
// Chaque scénario a son compte et ses ids Stripe ; les avis verrouillés sont semés en 2025, hors des mois des autres tests.

const suffixe = suffixeUnique();
const URL_SITE = "https://designo.test";
const gestionnaires: Gestionnaire[] = [];
const emails = new Map<Gestionnaire, string>();

async function compte(nom: string) {
  const email = `webhook-${nom}-${suffixe}@exemple.fr`;
  const g = await premiereConnexion(email);
  gestionnaires.push(g);
  emails.set(g, email);
  return g;
}

afterAll(async () => {
  for (const g of gestionnaires) await supprimerGestionnaire(g);
});

/** Un envoyeur qui garde les emails au lieu de les envoyer. */
function fauxEnvoyeur() {
  const envoyes: Email[] = [];
  const envoyeur: Envoyeur = async (email) => {
    envoyes.push(email);
  };
  return { envoyeur, envoyes };
}

const enPanne: Envoyeur = async () => {
  throw new Error("Resend en panne");
};

function poster(
  evenementStripe: unknown,
  { secret = SECRET_WEBHOOK, envoyeur = null }: { secret?: string; envoyeur?: Envoyeur | null } = {},
) {
  const { corps, signature } = signer(evenementStripe, secret);
  return traiterWebhookStripe({ corps, signature, secret: SECRET_WEBHOOK, supabase: admin, envoyeur, urlSite: URL_SITE });
}

async function etat(g: Gestionnaire) {
  const { data, error } = await admin
    .from("entreprise")
    .select(
      "plan, stripe_client_id, stripe_abonnement_id, abonnement_statut, fin_periode, annulation_programmee, stripe_evenement_le",
    )
    .eq("id", g.entrepriseId)
    .single();
  if (error) throw error;
  return {
    ...data,
    fin_periode: data.fin_periode && new Date(data.fin_periode).toISOString(),
    stripe_evenement_le: data.stripe_evenement_le && new Date(data.stripe_evenement_le).toISOString(),
  };
}

/** Le client Stripe, tel que « Passer en Pro » l'enregistre avant d'ouvrir Checkout. */
async function enregistrerClient(g: Gestionnaire) {
  const client = idStripe("cus");
  const { error } = await admin.from("entreprise").update({ stripe_client_id: client }).eq("id", g.entrepriseId);
  if (error) throw error;
  return client;
}

const T = secondes("2026-10-25T09:00:00Z");
const FIN = secondes("2026-11-25T09:00:00Z");

describe("webhook Stripe : passage en Pro", () => {
  let g: Gestionnaire;
  let client: string;
  let sub: string;
  let verrouilles: string[];
  let aLire: string;

  beforeAll(async () => {
    g = await compte("pro");
    // Avril, puis mars 2025, pleins ; un avis verrouillé en mars, puis un en avril : déposé le 31/03 à 22:30 UTC, il est
    // du 01/04 à Paris. Celui-ci a son fichier dans le bucket, pour la lecture différée.
    const plein = (depose_le: string) => Array.from({ length: LIMITES_FREE.avisParMois }, () => ({ depose_le }));
    const { data, error } = await admin
      .from("avis")
      .insert(
        [
          ...plein("2025-04-02T08:00:00Z"),
          ...plein("2025-03-03T08:00:00Z"),
          { depose_le: "2025-03-10T08:00:00Z" },
          { depose_le: "2025-03-31T22:30:00Z", fichier: await envoyerFichierAvis(g) },
        ].map((champs) => ({
          entreprise_id: g.entrepriseId,
          fichier: `${g.entrepriseId}/${crypto.randomUUID()}.png`,
          fichier_type: "image/png",
          ...champs,
        })),
        { defaultToNull: false },
      )
      .select("id, verrouille");
    if (error) throw error;
    verrouilles = data.filter(({ verrouille }) => verrouille).map(({ id }) => id as string);
    aLire = verrouilles[1];
    client = idStripe("cus");
    sub = idStripe("sub");
  });

  it("deux avis sont verrouillés avant le paiement", () => {
    expect(verrouilles).toHaveLength(2);
  });

  it("un abonnement créé incomplet (paiement en cours) laisse le compte en Free, et retrouve l'entreprise par Checkout", async () => {
    const sous = abonnement({ id: sub, client, statut: "incomplete", entrepriseId: g.entrepriseId, finPeriode: FIN });
    expect(await poster(evenement("customer.subscription.created", sous, { cree: T }))).toMatchObject({ statut: 200 });
    expect(await etat(g)).toMatchObject({
      plan: "free",
      stripe_client_id: client,
      stripe_abonnement_id: sub,
      abonnement_statut: "incomplete",
    });
  });

  it("l'abonnement actif passe le compte en Pro, avec toutes ses colonnes", async () => {
    const actif = abonnement({ id: sub, client, entrepriseId: g.entrepriseId, finPeriode: FIN });
    expect(await poster(evenement("customer.subscription.updated", actif, { cree: T + 5 }))).toEqual({
      statut: 200,
      message: "appliqué : active (pro)",
      // La route synchronise alors l'agenda de l'entreprise (phase 22).
      applique: { entrepriseId: g.entrepriseId, plan: "pro" },
    });
    expect(await etat(g)).toEqual({
      plan: "pro",
      stripe_client_id: client,
      stripe_abonnement_id: sub,
      abonnement_statut: "active",
      fin_periode: "2026-11-25T09:00:00.000Z",
      annulation_programmee: false,
      stripe_evenement_le: "2026-10-25T09:00:05.000Z",
    });
  });

  it("les avis verrouillés sont débloqués, dans le mois de leur dépôt à Paris", async () => {
    expect(await avisEnBase(verrouilles[0])).toMatchObject({ verrouille: false, mois_quota: "2025-03-01" });
    // Le 31/03 à 22:30 UTC est le 01/04 à 00:30 à Paris : avril, et non mars.
    const avis = await avisEnBase(aLire);
    expect(avis).toMatchObject({ verrouille: false, mois_quota: "2025-04-01", lecture_ia: null });
    expect(avis?.deverrouille_le).not.toBeNull();
    expect(aLireALOuverture(avis!)).toBe(true);
  });

  it("débloqué, l'avis est lu à son ouverture", async () => {
    const lecture = Object.fromEntries(
      CHAMPS_AVIS.map((champ) => [champ, { valeur: null, confiance: "non_lu" }]),
    ) as Lecture;
    lecture.plaque = { valeur: "PR-018-AA", confiance: "sur" };
    expect(await lireEtRemplirAvis(g.client, aLire, async () => lecture)).toEqual({ lecture: "lue" });
    expect(await avisEnBase(aLire)).toMatchObject({ plaque: "PR-018-AA", lecture_ia: "lue" });
  });

  it("rejoué, le même événement ne change rien", async () => {
    const avant = await etat(g);
    const actif = abonnement({ id: sub, client, entrepriseId: g.entrepriseId, finPeriode: FIN });
    expect(await poster(evenement("customer.subscription.updated", actif, { cree: T + 5 }))).toMatchObject({ statut: 200 });
    expect(await etat(g)).toEqual(avant);
  });

  it("un événement plus ancien, livré en retard, est ignoré", async () => {
    const vieux = abonnement({ id: sub, client, statut: "incomplete", finPeriode: FIN });
    expect(await poster(evenement("customer.subscription.updated", vieux, { cree: T + 1 }))).toEqual({
      statut: 200,
      message: "ignoré : plus_ancien",
    });
    expect((await etat(g)).plan).toBe("pro");
  });

  it("un second abonnement du même client est ignoré : le suivi reste", async () => {
    const double = abonnement({ client, finPeriode: FIN });
    expect(await poster(evenement("customer.subscription.created", double, { cree: T + 60 }))).toEqual({
      statut: 200,
      message: "ignoré : autre_abonnement",
    });
    expect(await etat(g)).toMatchObject({ plan: "pro", stripe_abonnement_id: sub });
  });

  it("une annulation programmée garde le Pro jusqu'à la fin de la période", async () => {
    const annule = abonnement({ id: sub, client, finPeriode: FIN, annulationFinPeriode: true });
    expect(await poster(evenement("customer.subscription.updated", annule, { cree: T + 120 }))).toMatchObject({
      statut: 200,
    });
    expect(await etat(g)).toMatchObject({ plan: "pro", annulation_programmee: true, fin_periode: "2026-11-25T09:00:00.000Z" });
  });

  it("à la fin de la période, l'abonnement supprimé repasse le compte en Free, sans rien supprimer", async () => {
    const { count: avant } = await admin
      .from("avis")
      .select("id", { count: "exact", head: true })
      .eq("entreprise_id", g.entrepriseId);
    const fini = abonnement({ id: sub, client, statut: "canceled", finPeriode: FIN, annulationFinPeriode: true });
    expect(await poster(evenement("customer.subscription.deleted", fini, { cree: FIN }))).toEqual({
      statut: 200,
      message: "appliqué : canceled (free)",
      applique: { entrepriseId: g.entrepriseId, plan: "free" },
    });
    expect(await etat(g)).toMatchObject({ plan: "free", abonnement_statut: "canceled", stripe_client_id: client });
    const { count: apres } = await admin
      .from("avis")
      .select("id", { count: "exact", head: true })
      .eq("entreprise_id", g.entrepriseId);
    expect(apres).toBe(avant);
    expect(await avisEnBase(verrouilles[0])).toMatchObject({ verrouille: false });
  });

  it("un nouvel abonnement remplace l'abonnement annulé", async () => {
    const nouveau = idStripe("sub");
    const actif = abonnement({ id: nouveau, client, finPeriode: FIN + 30 * 86_400 });
    expect(await poster(evenement("customer.subscription.created", actif, { cree: FIN + 3_600 }))).toMatchObject({
      statut: 200,
    });
    expect(await etat(g)).toMatchObject({ plan: "pro", stripe_abonnement_id: nouveau, abonnement_statut: "active" });
  });
});

describe("webhook Stripe : à la même seconde", () => {
  it("le rang du cycle de vie départage deux événements du même abonnement", async () => {
    const g = await compte("seconde");
    const client = await enregistrerClient(g);
    const sub = idStripe("sub");
    await poster(evenement("customer.subscription.updated", abonnement({ id: sub, client }), { cree: T }));
    // Même seconde, `incomplete` vient avant `active` : ignoré.
    const incomplet = abonnement({ id: sub, client, statut: "incomplete" });
    expect(await poster(evenement("customer.subscription.created", incomplet, { cree: T }))).toMatchObject({
      message: "ignoré : plus_ancien",
    });
    expect((await etat(g)).plan).toBe("pro");
    // Même seconde, `canceled` vient après `active` : appliqué.
    const annule = abonnement({ id: sub, client, statut: "canceled" });
    expect(await poster(evenement("customer.subscription.deleted", annule, { cree: T }))).toMatchObject({ statut: 200 });
    expect((await etat(g)).plan).toBe("free");
  });
});

describe("webhook Stripe : refus et événements ignorés", () => {
  let g: Gestionnaire;
  let client: string;

  beforeAll(async () => {
    g = await compte("refus");
    client = await enregistrerClient(g);
  });

  it("une signature fausse est refusée (400), sans rien appliquer", async () => {
    const evt = evenement("customer.subscription.updated", abonnement({ client }));
    expect(await poster(evt, { secret: "whsec_mauvais" })).toEqual({ statut: 400, message: "Signature invalide" });
    const { corps } = signer(evt);
    const sansSignature = { corps, signature: null, secret: SECRET_WEBHOOK, supabase: admin, envoyeur: null };
    expect(await traiterWebhookStripe({ ...sansSignature, urlSite: URL_SITE })).toMatchObject({ statut: 400 });
    expect((await etat(g)).plan).toBe("free");
  });

  it("un client inconnu est ignoré (200)", async () => {
    const inconnu = abonnement({ client: idStripe("cus"), entrepriseId: crypto.randomUUID() });
    expect(await poster(evenement("customer.subscription.updated", inconnu))).toEqual({
      statut: 200,
      message: "client inconnu : ignoré",
    });
  });

  it("une entreprise des métadonnées qui a déjà un autre client est ignorée", async () => {
    const autre = abonnement({ client: idStripe("cus"), entrepriseId: g.entrepriseId });
    expect(await poster(evenement("customer.subscription.updated", autre))).toMatchObject({
      message: "client inconnu : ignoré",
    });
    expect(await etat(g)).toMatchObject({ plan: "free", stripe_client_id: client });
  });

  it("un type d'événement non géré est ignoré (200)", async () => {
    expect(await poster(evenement("customer.updated", { id: client, object: "customer" }))).toEqual({
      statut: 200,
      message: "ignoré : customer.updated",
    });
  });

  it("un statut inconnu répond 500, pour que Stripe relance, sans rétrograder", async () => {
    const etrange = abonnement({ client, statut: "en_pause_longue" });
    expect(await poster(evenement("customer.subscription.updated", etrange))).toMatchObject({ statut: 500 });
    expect((await etat(g)).abonnement_statut).toBeNull();
  });

  it("le gestionnaire ne peut écrire ni l'abonnement ni les factures envoyées", async () => {
    for (const colonnes of [
      { stripe_client_id: "cus_pirate" },
      { abonnement_statut: "active" },
      { fin_periode: new Date().toISOString() },
      { annulation_programmee: true },
    ]) {
      const { error } = await g.client.from("entreprise").update(colonnes).eq("id", g.entrepriseId);
      expect(error?.code).toBe("42501");
    }
    const lecture = await g.client.from("facture_envoyee").select("facture_id");
    expect(lecture.error?.code).toBe("42501");
  });
});

describe("webhook Stripe : facture payée", () => {
  let g: Gestionnaire;
  let client: string;

  beforeAll(async () => {
    g = await compte("facture");
    client = await enregistrerClient(g);
    const { error } = await admin
      .from("entreprise")
      .update({ raison_sociale: "Plomberie Martin & Fils" })
      .eq("id", g.entrepriseId);
    if (error) throw error;
  });

  it("envoie la facture au gestionnaire, une seule fois même rejouée", async () => {
    const evt = evenement("invoice.paid", facture({ client, numero: "DESIGNO-0001" }));
    const { envoyeur, envoyes } = fauxEnvoyeur();
    expect(await poster(evt, { envoyeur })).toEqual({ statut: 200, message: "facture envoyée" });
    expect(await poster(evt, { envoyeur })).toEqual({ statut: 200, message: "facture déjà envoyée" });

    expect(envoyes).toHaveLength(1);
    const [email] = envoyes;
    expect(email.a).toBe(emails.get(g));
    expect(email.sujet).toBe("Votre facture Désigno Pro · octobre 2026");
    expect(email.texte).toContain("Au nom de : Plomberie Martin & Fils");
    expect(email.texte).toContain("DESIGNO-0001");
    expect(email.cleIdempotence).toBe(`facture/${evt.data.object.id}`);
  });

  it("un envoi en échec répond 500 et libère la facture : la relance de Stripe l'envoie", async () => {
    const evt = evenement("invoice.paid", facture({ client }));
    expect(await poster(evt, { envoyeur: enPanne })).toEqual({
      statut: 500,
      message: "facture non envoyée : Stripe relancera",
    });
    const { count } = await admin
      .from("facture_envoyee")
      .select("facture_id", { count: "exact", head: true })
      .eq("facture_id", evt.data.object.id);
    expect(count).toBe(0);

    const { envoyeur, envoyes } = fauxEnvoyeur();
    expect(await poster(evt, { envoyeur })).toMatchObject({ statut: 200 });
    expect(envoyes).toHaveLength(1);
  });

  it("sans envoi d'email configuré, répond 503, sans réserver la facture", async () => {
    const evt = evenement("invoice.paid", facture({ client }));
    expect(await poster(evt)).toMatchObject({ statut: 503 });
    const { envoyeur, envoyes } = fauxEnvoyeur();
    expect(await poster(evt, { envoyeur })).toMatchObject({ statut: 200 });
    expect(envoyes).toHaveLength(1);
  });

  it("la facture d'un client inconnu est ignorée", async () => {
    const { envoyeur, envoyes } = fauxEnvoyeur();
    const evt = evenement("invoice.paid", facture({ client: idStripe("cus") }));
    expect(await poster(evt, { envoyeur })).toMatchObject({ statut: 200, message: "client inconnu : ignoré" });
    expect(envoyes).toHaveLength(0);
  });
});

describe("webhook Stripe : paiement en échec", () => {
  let g: Gestionnaire;
  let client: string;
  let sub: string;
  const premiere = idStripe("in");
  const seconde = idStripe("in");
  // L'échec arrive le 25/10/2026 à 09:01:40 UTC : le 25/10 à Paris, d'où la date limite du 01/11/2026.
  const ECHEC = T + 100;

  const impaye = (derniereFacture: string | null, cree: number) =>
    evenement("customer.subscription.updated", abonnement({ id: sub, client, statut: "past_due", derniereFacture }), {
      cree,
    });
  const echoueLe = async () => {
    const { data, error } = await admin.from("entreprise").select("paiement_echoue_le").eq("id", g.entrepriseId).single();
    if (error) throw error;
    return data.paiement_echoue_le && new Date(data.paiement_echoue_le).toISOString();
  };

  beforeAll(async () => {
    g = await compte("impaye");
    client = await enregistrerClient(g);
    sub = idStripe("sub");
    await poster(evenement("customer.subscription.created", abonnement({ id: sub, client }), { cree: T }));
  });

  it("le premier échec date l'impayé, garde le Pro, et envoie un seul email avec la date limite", async () => {
    const { envoyeur, envoyes } = fauxEnvoyeur();
    expect(await poster(impaye(premiere, ECHEC), { envoyeur })).toEqual({
      statut: 200,
      message: "appliqué : past_due (pro), impayé signalé",
      applique: { entrepriseId: g.entrepriseId, plan: "pro" },
    });
    expect(await etat(g)).toMatchObject({ plan: "pro", abonnement_statut: "past_due" });
    expect(await echoueLe()).toBe("2026-10-25T09:01:40.000Z");

    expect(envoyes).toHaveLength(1);
    const [email] = envoyes;
    expect(email.a).toBe(emails.get(g));
    expect(email.sujet).toBe(SUJET_IMPAYE);
    expect(email.texte).toContain("d'ici le 01/11/2026");
    expect(email.texte).toContain(`${URL_SITE}/parametres/abonnement`);
    expect(email.cleIdempotence).toBe(`impaye/${premiere}`);
  });

  it("rejoué, ou suivi d'une autre mise à jour de la même facture, rien de plus ; la date de l'échec est gardée", async () => {
    const { envoyeur, envoyes } = fauxEnvoyeur();
    expect(await poster(impaye(premiere, ECHEC), { envoyeur })).toMatchObject({ message: expect.stringContaining("déjà signalé") });
    expect(await poster(impaye(premiere, ECHEC + 3_600), { envoyeur })).toMatchObject({ statut: 200 });
    expect(envoyes).toHaveLength(0);
    expect(await echoueLe()).toBe("2026-10-25T09:01:40.000Z");
  });

  it("un envoi en échec libère la réservation et répond 500 : l'email part au rejeu", async () => {
    expect(await poster(impaye(seconde, ECHEC + 7_200), { envoyeur: enPanne })).toEqual({
      statut: 500,
      message: "impayé non signalé : Stripe relancera",
      applique: { entrepriseId: g.entrepriseId, plan: "pro" },
    });
    const { count } = await admin
      .from("impaye_signale")
      .select("facture_id", { count: "exact", head: true })
      .eq("facture_id", seconde);
    expect(count).toBe(0);

    const { envoyeur, envoyes } = fauxEnvoyeur();
    expect(await poster(impaye(seconde, ECHEC + 7_200), { envoyeur })).toMatchObject({ statut: 200 });
    expect(envoyes).toHaveLength(1);
    // Toujours le même impayé : la date limite ne recule pas.
    expect(envoyes[0].texte).toContain("d'ici le 01/11/2026");
  });

  it("régularisé, l'abonnement redevient actif et la date de l'échec s'efface", async () => {
    const actif = abonnement({ id: sub, client, derniereFacture: seconde });
    expect(await poster(evenement("customer.subscription.updated", actif, { cree: ECHEC + 86_400 }))).toMatchObject({
      message: "appliqué : active (pro)",
    });
    expect(await echoueLe()).toBeNull();
  });

  it("le gestionnaire n'écrit ni la date de l'échec, ni les impayés signalés", async () => {
    const { error } = await g.client.from("entreprise").update({ paiement_echoue_le: null }).eq("id", g.entrepriseId);
    expect(error?.code).toBe("42501");
    const lecture = await g.client.from("impaye_signale").select("facture_id");
    expect(lecture.error?.code).toBe("42501");
  });
});

describe("webhook Stripe : paiement en échec, cas limites", () => {
  it("sans dernière facture, l'impayé est appliqué, sans email", async () => {
    const g = await compte("impaye-sans-facture");
    const client = await enregistrerClient(g);
    const { envoyeur, envoyes } = fauxEnvoyeur();
    const sansFacture = abonnement({ client, statut: "past_due", derniereFacture: null });
    expect(await poster(evenement("customer.subscription.updated", sansFacture), { envoyeur })).toEqual({
      statut: 200,
      message: "appliqué : past_due (pro), sans facture à signaler",
      applique: { entrepriseId: g.entrepriseId, plan: "pro" },
    });
    expect(await etat(g)).toMatchObject({ plan: "pro", abonnement_statut: "past_due" });
    expect(envoyes).toHaveLength(0);
  });

  it("sans envoi d'email configuré, l'impayé est appliqué et répond 503 : l'email part à la relance", async () => {
    const g = await compte("impaye-sans-envoi");
    const client = await enregistrerClient(g);
    const evt = evenement("customer.subscription.updated", abonnement({ client, statut: "past_due", derniereFacture: idStripe("in") }));
    expect(await poster(evt)).toMatchObject({ statut: 503 });
    expect((await etat(g)).abonnement_statut).toBe("past_due");
    const { envoyeur, envoyes } = fauxEnvoyeur();
    expect(await poster(evt, { envoyeur })).toMatchObject({ statut: 200 });
    expect(envoyes).toHaveLength(1);
  });

  it("à la même seconde, la régularisation l'emporte sur l'impayé, dans les deux ordres", async () => {
    const g = await compte("impaye-seconde");
    const client = await enregistrerClient(g);
    const sub = idStripe("sub");
    const facture = idStripe("in");
    const { envoyeur } = fauxEnvoyeur();
    const actif = evenement("customer.subscription.updated", abonnement({ id: sub, client }), { cree: T });
    const enEchec = evenement(
      "customer.subscription.updated",
      abonnement({ id: sub, client, statut: "past_due", derniereFacture: facture }),
      { cree: T },
    );

    await poster(actif);
    expect(await poster(enEchec, { envoyeur })).toMatchObject({ message: "ignoré : plus_ancien" });
    expect((await etat(g)).abonnement_statut).toBe("active");

    // Dans l'autre ordre : l'impayé, puis la régularisation de la même seconde.
    const h = await compte("impaye-seconde-inverse");
    const clientH = await enregistrerClient(h);
    const subH = idStripe("sub");
    await poster(
      evenement("customer.subscription.updated", abonnement({ id: subH, client: clientH, statut: "past_due", derniereFacture: idStripe("in") }), {
        cree: T,
      }),
      { envoyeur },
    );
    expect(await poster(evenement("customer.subscription.updated", abonnement({ id: subH, client: clientH }), { cree: T }))).toMatchObject({
      message: "appliqué : active (pro)",
    });
    expect(await etat(h)).toMatchObject({ abonnement_statut: "active" });
  });
});
