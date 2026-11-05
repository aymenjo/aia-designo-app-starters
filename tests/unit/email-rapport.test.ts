import { describe, expect, it } from "vitest";
import { emailRapport } from "@/lib/rapport/email-rapport";
import type { SyntheseRapport } from "@/lib/rapport/synthese";

// L'email du rapport mensuel (phase 25) : au nom de l'entreprise, 4 chiffres et le PDF en pièce jointe.

const SYNTHESE: SyntheseRapport = {
  mois: "2026-10-01",
  recus: 12,
  designes: 9,
  classes: 1,
  echeancesManquees: [{ id: "a", numero: "1234567890", plaque: "AB-123-CD", statut: "a_valider", echeance: "2026-10-12" }],
  eurosEvites: { mois: 607_500, cumul: 2_497_500 },
  plusVerbalises: { vehicules: [], conducteurs: [] },
  fichesIncompletes: { entreprise: [], conducteurs: [] },
  aucunAvis: false,
};

const email = (champs: Partial<Parameters<typeof emailRapport>[0]> = {}) =>
  emailRapport({ raisonSociale: "Plomberie Martin SARL", synthese: SYNTHESE, sansDirection: false, ...champs });

describe("emailRapport", () => {
  it("nomme le mois du rapport dans le sujet", () => {
    expect(email().sujet).toBe("Rapport de flotte – octobre 2026");
  });

  it("donne les avis reçus, désignés, les échéances dépassées et les amendes évitées", () => {
    const { texte, html } = email();
    expect(texte).toContain("Voici le bilan de la flotte de Plomberie Martin SARL pour octobre 2026.");
    expect(texte).toContain("Avis reçus : 12");
    expect(texte).toContain("Avis désignés : 9");
    expect(texte).toContain("Échéances dépassées : 1");
    expect(texte).toContain("Amendes de non-désignation évitées : 6\u202F075\u00A0€");
    expect(texte).toContain("Le rapport complet est en pièce jointe");
    // Les échéances dépassées en rouge, les amendes évitées en vert.
    expect(html).toMatch(/color:#B42318;">1</);
    expect(html).toMatch(/color:#0E7A4E;">6\u202F075\u00A0€</);
  });

  it("n'a ni lien ni bouton", () => {
    expect(email().html).not.toContain("<a ");
  });

  it("laisse les échéances dépassées en encre quand il n'y en a pas", () => {
    const { html } = email({ synthese: { ...SYNTHESE, echeancesManquees: [] } });
    expect(html).toMatch(/color:#202020;">0</);
  });

  it("dit « Aucun avis ce mois-ci » quand rien n'a été déposé", () => {
    expect(email({ synthese: { ...SYNTHESE, recus: 0, aucunAvis: true } }).texte).toContain("Aucun avis ce mois-ci.");
    expect(email().texte).not.toContain("Aucun avis ce mois-ci.");
  });

  it("invite le gestionnaire à ajouter les adresses de la direction quand il est seul destinataire", () => {
    expect(email({ sansDirection: true }).texte).toContain("Ce rapport ne part qu'à vous.");
    expect(email().texte).not.toContain("Ce rapport ne part qu'à vous.");
  });

  it("échappe la raison sociale", () => {
    const { html } = email({ raisonSociale: "Dupont & Fils <SARL>" });
    expect(html).toContain("Dupont &amp; Fils &lt;SARL&gt;");
    expect(html).not.toContain("<SARL>");
  });

  it("se passe de raison sociale", () => {
    const { texte } = email({ raisonSociale: null });
    expect(texte).toContain("Voici le bilan de la flotte pour octobre 2026.");
    expect(texte).toContain("Envoyé avec Désigno.");
  });
});
