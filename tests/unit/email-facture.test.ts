import { describe, expect, it } from "vitest";
import { emailFacture } from "@/lib/abonnement/email-facture";
import { contenuFacture } from "@/lib/abonnement/regles";
import { facture as factureStripe, secondes } from "../stripe";

// L'email de facture (phase 18) : envoyé par Désigno sur `invoice.paid`, à la place des emails de Stripe.

const urlSite = "https://designo.exemple.fr";
const facture = (champs: Partial<Parameters<typeof factureStripe>[0]> = {}) =>
  contenuFacture(factureStripe({ id: "in_42", client: "cus_1", numero: "DESIGNO-0042", ...champs }));

describe("emailFacture", () => {
  it("nomme le mois facturé, celui du début de la période à Paris", () => {
    const { sujet } = emailFacture({ facture: facture(), raisonSociale: "Plomberie Martin", urlSite });
    expect(sujet).toBe("Votre facture Désigno Pro · octobre 2026");

    // Le 31/10 à 23:30 UTC est déjà le 01/11 à Paris.
    const novembre = facture({ debutPeriode: secondes("2026-10-31T23:30:00Z") });
    expect(emailFacture({ facture: novembre, raisonSociale: "Plomberie Martin", urlSite }).sujet).toBe(
      "Votre facture Désigno Pro · novembre 2026",
    );
  });

  it("donne le n°, la raison sociale, le montant TTC payé, et la période", () => {
    const { html, texte } = emailFacture({ facture: facture(), raisonSociale: "Plomberie Martin", urlSite });
    expect(texte).toContain("N° de facture : DESIGNO-0042");
    expect(texte).toContain("Au nom de : Plomberie Martin");
    expect(texte).toContain("Montant : 58,80 € TTC, payée le 25/10/2026");
    expect(texte).toContain("Période : du 25/10/2026 au 25/11/2026");
    expect(html).toContain("DESIGNO-0042");
    expect(html).toContain("58,80 € TTC, payée le 25/10/2026");
  });

  it("mène au PDF, à la facture en ligne et à l'écran Abonnement", () => {
    const { html, texte } = emailFacture({ facture: facture(), raisonSociale: "Plomberie Martin", urlSite: `${urlSite}/` });
    expect(html).toContain('href="https://pay.stripe.com/invoice/in_42/pdf"');
    expect(html).toContain("Télécharger la facture (PDF)");
    expect(html).toContain('href="https://invoice.stripe.com/i/in_42"');
    expect(html).toContain("Voir la facture en ligne");
    expect(html).toContain(`href="${urlSite}/parametres/abonnement"`);
    expect(html).toContain("Abonnement › Gérer mon abonnement");
    expect(html).not.toContain(`${urlSite}//`);
    expect(texte).toContain("Télécharger la facture (PDF) : https://pay.stripe.com/invoice/in_42/pdf");
    expect(texte).toContain(`Abonnement › Gérer mon abonnement (${urlSite}/parametres/abonnement)`);
  });

  it("échappe la raison sociale dans l'email HTML", () => {
    const { html, texte } = emailFacture({ facture: facture(), raisonSociale: "Martin & Fils <SARL>", urlSite });
    expect(html).toContain("Martin &amp; Fils &lt;SARL&gt;");
    expect(html).not.toContain("<SARL>");
    expect(texte).toContain("Au nom de : Martin & Fils <SARL>");
  });

  it("sans PDF, garde le lien vers la facture en ligne", () => {
    const sansPdf = { ...facture(), pdf: null };
    const { html } = emailFacture({ facture: sansPdf, raisonSociale: "Plomberie Martin", urlSite });
    expect(html).not.toContain("Télécharger la facture (PDF)");
    expect(html).toContain("Voir la facture en ligne");
  });
});
