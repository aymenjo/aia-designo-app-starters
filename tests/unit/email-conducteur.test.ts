import { describe, expect, it } from "vitest";
import { contenuEmailConducteur, emailConducteur } from "@/lib/avis/email-conducteur";
import { EXPEDITEUR, nomExpediteur } from "@/lib/email/envoi";

// L'email au conducteur (phase 21) : au clic sur « J'ai désigné sur l'ANTAI », l'entreprise prévient le conducteur
// qu'un nouvel avis va arriver à son nom. Les réponses vont au gestionnaire.

// Le 03/10/2026 à 08:30, heure de Paris (heure d'été, UTC+2).
const AVIS = {
  plaque: "AB-123-CD",
  infraction_le: "2026-10-03T06:30:00.000Z",
  lieu: "A6, Auxerre, sens Paris-Province",
  infraction: "Excès de vitesse inférieur à 20 km/h",
  montant_centimes: 13500,
};
const KARIM = { civilite: "m" as const, prenom: "Karim", nom: "Benali", email: "karim@exemple.fr" };

const contenu = (champs: Partial<Parameters<typeof contenuEmailConducteur>[0]> = {}) =>
  contenuEmailConducteur({
    avis: AVIS,
    vehicule: { plaque: "AB-123-CD", modele: "Renault Master" },
    conducteur: KARIM,
    raisonSociale: "Plomberie Martin SARL",
    repondreA: "claire@plomberie-martin.fr",
    ...champs,
  });

describe("contenuEmailConducteur", () => {
  it("part au conducteur, au nom de l'entreprise, et les réponses vont au gestionnaire", () => {
    expect(contenu()).toMatchObject({
      a: "karim@exemple.fr",
      repondreA: "claire@plomberie-martin.fr",
      expediteur: "Plomberie Martin SARL via Désigno",
    });
  });

  it("l'objet nomme la date de l'infraction, à l'heure de Paris, et la plaque", () => {
    expect(contenu().sujet).toBe("Vous avez été désigné conducteur – infraction du 03/10/2026 (AB-123-CD)");
  });

  it("salue le conducteur par son prénom, et annonce un nouvel avis à son nom", () => {
    const { salutation, paragraphes, question, pied } = contenu();
    expect(salutation).toBe("Bonjour Karim,");
    expect(paragraphes).toEqual([
      "Plomberie Martin SARL vous a désigné sur le site de l'ANTAI comme conducteur du véhicule au moment de l'infraction ci-dessous.",
      "Vous allez recevoir à votre nom un nouvel avis de contravention pour cette infraction.",
    ]);
    expect(question).toBe("Une question ? Répondez à cet email : votre réponse arrivera chez Plomberie Martin SARL.");
    expect(pied).toBe("Envoyé avec Désigno pour Plomberie Martin SARL.");
  });

  it("les faits : date à heure, lieu, plaque et modèle, infraction, montant", () => {
    expect(contenu().faits).toEqual([
      { libelle: "Date", valeur: "03/10/2026 à 08:30" },
      { libelle: "Lieu", valeur: "A6, Auxerre, sens Paris-Province" },
      { libelle: "Véhicule", valeur: "Renault Master", plaque: "AB-123-CD" },
      { libelle: "Infraction", valeur: "Excès de vitesse inférieur à 20 km/h" },
      { libelle: "Montant", valeur: "135,00 €" },
    ]);
  });

  it("sans modèle, le véhicule se réduit à sa plaque", () => {
    const vehicule = contenu({ vehicule: { plaque: "AB-123-CD", modele: null } }).faits.find(
      ({ libelle }) => libelle === "Véhicule",
    );
    expect(vehicule).toEqual({ libelle: "Véhicule", valeur: "", plaque: "AB-123-CD" });
    expect(emailConducteur(contenu({ vehicule: { plaque: "AB-123-CD", modele: null } })).texte).toContain(
      "Véhicule : AB-123-CD\n",
    );
  });

  it("« désigné » s'accorde avec la civilité Mme", () => {
    const lea = contenu({ conducteur: { civilite: "mme", prenom: "Léa", nom: "Martin", email: "lea@exemple.fr" } });
    expect(lea.sujet).toBe("Vous avez été désignée conducteur – infraction du 03/10/2026 (AB-123-CD)");
    expect(lea.paragraphes[0]).toContain("vous a désignée sur le site de l'ANTAI");
    // Sans civilité, le masculin.
    const sans = contenu({ conducteur: { ...KARIM, civilite: null } });
    expect(sans.sujet).toContain("Vous avez été désigné conducteur");
  });
});

describe("emailConducteur", () => {
  const email = emailConducteur(contenu());

  it("reprend l'objet, et chaque fait en version texte", () => {
    expect(email.sujet).toBe("Vous avez été désigné conducteur – infraction du 03/10/2026 (AB-123-CD)");
    expect(email.texte).toContain("Bonjour Karim,");
    expect(email.texte).toContain("Date : 03/10/2026 à 08:30");
    expect(email.texte).toContain("Véhicule : AB-123-CD · Renault Master");
    expect(email.texte).toContain("Montant : 135,00 €");
    expect(email.texte).toContain("Envoyé avec Désigno pour Plomberie Martin SARL.");
  });

  it("ni lien, ni bouton : le conducteur n'a pas de compte", () => {
    expect(email.html).not.toMatch(/<a\s/i);
    expect(email.html).not.toContain("href");
    expect(email.texte).not.toMatch(/https?:\/\//);
  });

  it("échappe le texte dans l'email HTML", () => {
    const piege = emailConducteur(
      contenu({ raisonSociale: "Martin & Fils <script>", avis: { ...AVIS, lieu: `Rue "des" <b>Lilas</b>` } }),
    );
    expect(piege.html).toContain("Martin &amp; Fils &lt;script&gt;");
    expect(piege.html).toContain("Rue &quot;des&quot; &lt;b&gt;Lilas&lt;/b&gt;");
    expect(piege.html).not.toContain("<script>");
    expect(piege.html).not.toContain("<b>Lilas");
  });
});

describe("nomExpediteur", () => {
  it("retire ce qui casserait l'en-tête From", () => {
    expect(nomExpediteur(`Martin "Plomberie" <SARL> via Désigno`)).toBe("Martin Plomberie SARL via Désigno");
    expect(nomExpediteur("Martin\r\nBcc: x@exemple.fr via Désigno")).toBe("Martin Bcc: x@exemple.fr via Désigno");
  });

  it("sans nom, l'expéditeur de l'application", () => {
    expect(nomExpediteur(undefined)).toBe(EXPEDITEUR.nom);
    expect(nomExpediteur(' "<>" ')).toBe(EXPEDITEUR.nom);
  });
});
