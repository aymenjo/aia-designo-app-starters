import { describe, expect, it } from "vitest";
import {
  STATUTS_ABONNEMENT,
  StatutInconnu,
  abonnementEnCours,
  contenuFacture,
  decisionEvenement,
  etatAbonnement,
  limiteImpaye,
  paiementEchoueLe,
  parametresCheckout,
  parametresClient,
  planDuStatut,
  type EtatSuivi,
  type StatutAbonnement,
} from "@/lib/abonnement/regles";
import type { FicheEntreprise } from "@/lib/entreprise/fiche";
import { abonnement, facture, secondes } from "../stripe";

// Passage en Pro (phase 18) : le statut d'un abonnement Stripe donne le plan, et le webhook n'applique que l'événement
// le plus récent de l'abonnement suivi. Impayé (phase 19) : sa date d'entrée, et la date limite qui en découle.

describe("planDuStatut", () => {
  it.each([
    ["active", "pro"],
    ["trialing", "pro"],
    ["past_due", "pro"],
    ["incomplete", "free"],
    ["incomplete_expired", "free"],
    ["canceled", "free"],
    ["unpaid", "free"],
    ["paused", "free"],
  ])("%s → %s", (statut, plan) => {
    expect(planDuStatut(statut)).toBe(plan);
  });

  it("couvre tous les statuts connus", () => {
    expect(STATUTS_ABONNEMENT).toHaveLength(8);
  });

  it("refuse un statut inconnu plutôt que de rétrograder en silence", () => {
    expect(() => planDuStatut("en_pause_longue")).toThrow(StatutInconnu);
  });
});

describe("abonnementEnCours", () => {
  it.each<[StatutAbonnement | null, boolean]>([
    [null, false],
    ["incomplete", false],
    ["incomplete_expired", false],
    ["canceled", false],
    ["active", true],
    ["past_due", true],
    ["unpaid", true],
    ["paused", true],
  ])("%s → %s", (statut, enCours) => {
    expect(abonnementEnCours(statut)).toBe(enCours);
  });
});

describe("decisionEvenement", () => {
  const T = Date.parse("2026-10-25T09:00:00Z");
  const suivi = (statut: StatutAbonnement | null, evenementLe: number | null, abonnementId = "sub_a"): EtatSuivi => ({
    abonnementId: statut ? abonnementId : null,
    statut,
    evenementLe,
  });
  const recu = (statut: StatutAbonnement, evenementLe: number, abonnementId = "sub_a") => ({
    abonnementId,
    statut,
    evenementLe,
  });
  const APPLIQUER = { appliquer: true };
  const PLUS_ANCIEN = { appliquer: false, motif: "plus_ancien" };
  const AUTRE = { appliquer: false, motif: "autre_abonnement" };

  it.each([
    ["aucun abonnement suivi", suivi(null, null), recu("incomplete", T), APPLIQUER],
    ["un événement plus récent", suivi("incomplete", T), recu("active", T + 1000), APPLIQUER],
    ["le rejeu du dernier événement", suivi("active", T), recu("active", T), APPLIQUER],
    ["un événement plus ancien, livré en retard", suivi("canceled", T), recu("active", T - 1000), PLUS_ANCIEN],
    ["à la même seconde, un rang plus avancé", suivi("incomplete", T), recu("active", T), APPLIQUER],
    ["à la même seconde, un rang moins avancé", suivi("active", T), recu("incomplete", T), PLUS_ANCIEN],
    ["à la même seconde, la fin après l'activité", suivi("active", T), recu("canceled", T), APPLIQUER],
    // Un impayé relancé par Stripe (l'email avait échoué) n'écrase pas la régularisation de la même seconde.
    ["à la même seconde, l'impayé avant la régularisation", suivi("active", T), recu("past_due", T), PLUS_ANCIEN],
    ["à la même seconde, la régularisation après l'impayé", suivi("past_due", T), recu("active", T), APPLIQUER],
    ["à la même seconde, la fin après l'impayé", suivi("past_due", T), recu("canceled", T), APPLIQUER],
    ["un autre abonnement, le suivi actif", suivi("active", T), recu("active", T + 1000, "sub_b"), AUTRE],
    ["un autre abonnement, le suivi en relance", suivi("past_due", T), recu("active", T + 1000, "sub_b"), AUTRE],
    ["un autre abonnement, le suivi incomplet (3DS abandonné)", suivi("incomplete", T), recu("active", T + 1000, "sub_b"), APPLIQUER],
    ["un autre abonnement, le suivi annulé", suivi("canceled", T), recu("active", T + 1000, "sub_b"), APPLIQUER],
    ["un autre abonnement, le suivi expiré", suivi("incomplete_expired", T), recu("incomplete", T, "sub_b"), APPLIQUER],
    // Le vieil abonnement annulé, relancé par Stripe après un nouvel abonnement : il ne le remplace pas.
    ["le vieil abonnement relancé, le nouveau actif", suivi("active", T, "sub_b"), recu("canceled", T - 1000), AUTRE],
    ["le vieil abonnement relancé, le nouveau annulé ensuite", suivi("canceled", T, "sub_b"), recu("active", T - 1000), PLUS_ANCIEN],
  ])("%s", (_cas, stocke, evenement, decision) => {
    expect(decisionEvenement(stocke, evenement)).toEqual(decision);
  });
});

describe("etatAbonnement", () => {
  const debut = secondes("2026-10-25T09:00:00Z");
  const fin = secondes("2026-11-25T09:00:00Z");

  it("donne le plan, la fin de période et l'entreprise des métadonnées", () => {
    expect(etatAbonnement(abonnement({ id: "sub_1", client: "cus_1", entrepriseId: "e-1", debutPeriode: debut, finPeriode: fin }))).toEqual({
      abonnementId: "sub_1",
      clientId: "cus_1",
      statut: "active",
      plan: "pro",
      finPeriode: "2026-11-25T09:00:00.000Z",
      annulationProgrammee: false,
      entrepriseId: "e-1",
      derniereFacture: null,
    });
  });

  it("lit la dernière facture, en id ou dépliée", () => {
    expect(etatAbonnement(abonnement({ client: "cus_1", derniereFacture: "in_1" })).derniereFacture).toBe("in_1");
    const sub = abonnement({ client: "cus_1" });
    const depliee = { ...sub, latest_invoice: { id: "in_objet", object: "invoice" } as never };
    expect(etatAbonnement(depliee).derniereFacture).toBe("in_objet");
  });

  it("une annulation en fin de période est programmée, et finit avec la période", () => {
    const etat = etatAbonnement(abonnement({ client: "cus_1", finPeriode: fin, annulationFinPeriode: true }));
    expect(etat).toMatchObject({ plan: "pro", annulationProgrammee: true, finPeriode: "2026-11-25T09:00:00.000Z" });
  });

  it("une annulation à une date (`cancel_at`) finit au plus tôt des deux", () => {
    const avant = secondes("2026-11-10T12:00:00Z");
    expect(etatAbonnement(abonnement({ client: "cus_1", finPeriode: fin, annulationLe: avant }))).toMatchObject({
      annulationProgrammee: true,
      finPeriode: "2026-11-10T12:00:00.000Z",
    });
  });

  it("lit le client sous forme d'objet, quand l'événement l'a déplié", () => {
    const sub = abonnement({ client: "cus_1" });
    expect(etatAbonnement({ ...sub, customer: { id: "cus_objet", object: "customer" } as never }).clientId).toBe("cus_objet");
  });

  it("sans métadonnée, l'entreprise reste à retrouver par le client", () => {
    expect(etatAbonnement(abonnement({ client: "cus_1" })).entrepriseId).toBeNull();
  });

  it("refuse un abonnement sans période sur ses lignes (endpoint sur une ancienne version d'API)", () => {
    const sub = abonnement({ client: "cus_1" });
    const ancien = { ...sub, items: { ...sub.items, data: [{ ...sub.items.data[0], current_period_end: undefined }] } };
    expect(() => etatAbonnement(ancien as never)).toThrow(/version d'API/);
  });

  it("refuse un statut inconnu", () => {
    expect(() => etatAbonnement(abonnement({ client: "cus_1", statut: "en_pause_longue" }))).toThrow(StatutInconnu);
  });
});

describe("paiementEchoueLe", () => {
  const T = Date.parse("2026-10-25T09:00:00Z");
  const STOCKEE = "2026-10-20T08:00:00.000Z";

  it("à l'entrée en impayé, l'instant de l'événement", () => {
    expect(paiementEchoueLe({ statut: "active", paiementEchoueLe: null }, "past_due", T)).toBe("2026-10-25T09:00:00.000Z");
    expect(paiementEchoueLe({ statut: null, paiementEchoueLe: null }, "past_due", T)).toBe("2026-10-25T09:00:00.000Z");
  });

  it("tant que l'impayé dure, la date de l'entrée est gardée", () => {
    expect(paiementEchoueLe({ statut: "past_due", paiementEchoueLe: STOCKEE }, "past_due", T)).toBe(STOCKEE);
    // Un impayé enregistré sans date (avant la phase 19) prend celle de l'événement.
    expect(paiementEchoueLe({ statut: "past_due", paiementEchoueLe: null }, "past_due", T)).toBe("2026-10-25T09:00:00.000Z");
  });

  it("hors impayé, vide : régularisé, annulé ou jamais impayé", () => {
    for (const recu of ["active", "canceled", "unpaid", "incomplete"] as const) {
      expect(paiementEchoueLe({ statut: "past_due", paiementEchoueLe: STOCKEE }, recu, T)).toBeNull();
    }
  });

  it("une date d'entrée restée d'un ancien statut n'est pas reprise", () => {
    expect(paiementEchoueLe({ statut: "active", paiementEchoueLe: STOCKEE }, "past_due", T)).toBe("2026-10-25T09:00:00.000Z");
  });
});

describe("limiteImpaye", () => {
  it("le jour de l'échec, à Paris, plus 7 jours", () => {
    expect(limiteImpaye("2026-10-20T08:00:00Z")).toBe("2026-10-27");
  });

  it("le jour de l'échec est celui de Paris, de part et d'autre du passage à l'heure d'hiver (25/10/2026)", () => {
    // 00:30 à Paris, à l'heure d'été (UTC+2), puis à l'heure d'hiver (UTC+1) : le jour suivant celui de l'UTC.
    expect(limiteImpaye("2026-10-24T22:30:00Z")).toBe("2026-11-01");
    expect(limiteImpaye("2026-10-25T23:30:00Z")).toBe("2026-11-02");
    // 23:30 à Paris : encore le jour de l'UTC.
    expect(limiteImpaye("2026-10-25T22:30:00Z")).toBe("2026-11-01");
  });

  it("passe d'un mois et d'une année à l'autre", () => {
    expect(limiteImpaye("2026-12-31T23:30:00Z")).toBe("2027-01-08");
  });
});

const FICHE: FicheEntreprise = {
  raison_sociale: "Plomberie Martin",
  siren: "404833048",
  tva: "FR83404833048",
  representant_prenom: "Claire",
  representant_nom: "Martin",
  representant_fonction: "Gérante",
  siege_adresse: "12 rue des Lilas",
  siege_complement: null,
  siege_code_postal: "69003",
  siege_ville: "Lyon",
};

describe("parametresClient", () => {
  it("porte la raison sociale, le siège, le SIREN, la TVA et l'entreprise", () => {
    expect(parametresClient({ fiche: FICHE, email: "claire@exemple.fr", entrepriseId: "e-1" })).toEqual({
      name: "Plomberie Martin",
      email: "claire@exemple.fr",
      address: { line1: "12 rue des Lilas", line2: "", postal_code: "69003", city: "Lyon", country: "FR" },
      preferred_locales: ["fr"],
      invoice_settings: { custom_fields: [{ name: "SIREN", value: "404833048" }] },
      tax_id_data: [{ type: "eu_vat", value: "FR83404833048" }],
      metadata: { entreprise_id: "e-1" },
    });
  });

  it("reprend le complément d'adresse", () => {
    const fiche = { ...FICHE, siege_complement: "Bâtiment B" };
    expect(parametresClient({ fiche, email: "a@exemple.fr", entrepriseId: "e-1" }).address).toMatchObject({
      line2: "Bâtiment B",
    });
  });
});

describe("parametresCheckout", () => {
  const maintenant = new Date("2026-10-25T09:00:00Z");
  const parametres = parametresCheckout({
    clientId: "cus_1",
    entrepriseId: "e-1",
    prixId: "price_1",
    tauxTvaId: "txr_1",
    urlSite: "https://designo.exemple.fr/",
    maintenant,
  });

  it("un abonnement mensuel, TVA comprise, par carte, en français, sans code promo", () => {
    expect(parametres).toMatchObject({
      mode: "subscription",
      customer: "cus_1",
      client_reference_id: "e-1",
      line_items: [{ price: "price_1", quantity: 1, tax_rates: ["txr_1"] }],
      allowed_payment_method_types: ["card"],
      locale: "fr",
      subscription_data: { metadata: { entreprise_id: "e-1" } },
    });
    expect(parametres).not.toHaveProperty("allow_promotion_codes");
  });

  it("revient sur l'écran Abonnement, avec ou sans paiement", () => {
    expect(parametres.success_url).toBe("https://designo.exemple.fr/parametres/abonnement?paiement=reussi");
    expect(parametres.cancel_url).toBe("https://designo.exemple.fr/parametres/abonnement");
  });

  it("expire au bout d'une demi-heure, le minimum de Stripe, plus une marge", () => {
    const duree = parametres.expires_at! - maintenant.getTime() / 1000;
    expect(duree).toBeGreaterThanOrEqual(30 * 60);
    expect(duree).toBeLessThanOrEqual(32 * 60);
  });
});

describe("contenuFacture", () => {
  it("reprend le n°, le montant, la date du paiement et la période de la ligne d'abonnement", () => {
    const brute = facture({
      id: "in_1",
      client: "cus_1",
      entrepriseId: "e-1",
      numero: "DESIGNO-0042",
      payeeLe: secondes("2026-10-25T09:01:00Z"),
      debutPeriode: secondes("2026-10-25T09:00:00Z"),
      finPeriode: secondes("2026-11-25T09:00:00Z"),
    });
    expect(contenuFacture(brute)).toEqual({
      id: "in_1",
      numero: "DESIGNO-0042",
      clientId: "cus_1",
      entrepriseId: "e-1",
      totalCentimes: 5_880,
      payeeLe: "2026-10-25T09:01:00.000Z",
      debutPeriode: "2026-10-25T09:00:00.000Z",
      finPeriode: "2026-11-25T09:00:00.000Z",
      pdf: "https://pay.stripe.com/invoice/in_1/pdf",
      enLigne: "https://invoice.stripe.com/i/in_1",
    });
  });
});
