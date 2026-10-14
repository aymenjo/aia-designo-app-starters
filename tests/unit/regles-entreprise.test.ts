import { describe, expect, it } from "vitest";
import {
  CHAMPS_REQUIS,
  MESSAGES,
  champsManquants,
  ficheComplete,
  normaliserSiren,
  normaliserTva,
  schemaEntreprise,
  sirenValide,
  tvaDepuisSiren,
  verifierSaisie,
} from "@/lib/entreprise/regles";
import { normaliserCodePostal } from "@/lib/saisie";

describe("SIREN", () => {
  it.each([
    ["404833048", "404833048"],
    ["404 833 048", "404833048"],
    ["404.833.048", "404833048"],
    ["404 833 048", "404833048"],
  ])("normalise « %s » en %s", (brut, attendu) => {
    expect(normaliserSiren(brut)).toBe(attendu);
  });

  it.each(["40483304", "4048330481", "40483304A", ""])("refuse la forme de « %s »", (brut) => {
    expect(normaliserSiren(brut)).toBeNull();
  });

  it.each(["404833048", "732829320", "552100554", "356000000"])("accepte la clé de Luhn de %s", (siren) => {
    expect(sirenValide(siren)).toBe(true);
  });

  it.each(["404833049", "123456789", "000000000"])("refuse %s", (siren) => {
    expect(sirenValide(siren)).toBe(false);
  });
});

describe("TVA", () => {
  it("calcule le n° de TVA d'un SIREN, clé sur 2 chiffres", () => {
    expect(tvaDepuisSiren("404833048")).toBe("FR83404833048");
    expect(tvaDepuisSiren("732829320")).toBe("FR44732829320");
    expect(tvaDepuisSiren("300000239")).toBe("FR03300000239");
  });

  it.each([
    ["FR83404833048", "FR83404833048"],
    ["fr 83 404 833 048", "FR83404833048"],
    ["FR83-404.833.048", "FR83404833048"],
  ])("normalise « %s » en %s", (brut, attendu) => {
    expect(normaliserTva(brut)).toBe(attendu);
  });

  it.each(["83404833048", "FR8340483304", "BE0404833048", "FRAB404833048"])("refuse la forme de « %s »", (brut) => {
    expect(normaliserTva(brut)).toBeNull();
  });
});

describe("code postal", () => {
  it.each([
    ["75001", "75001"],
    ["75 001", "75001"],
    ["01000", "01000"],
    ["97400", "97400"],
  ])("normalise « %s » en %s", (brut, attendu) => {
    expect(normaliserCodePostal(brut)).toBe(attendu);
  });

  it.each(["7500", "750011", "00100", "99000", "75OO1"])("refuse « %s »", (brut) => {
    expect(normaliserCodePostal(brut)).toBeNull();
  });
});

const complete = {
  raison_sociale: "  Plomberie Martin SARL ",
  siren: "404 833 048",
  tva: "fr83 404 833 048",
  representant_prenom: "Claire",
  representant_nom: "Martin",
  representant_fonction: "Gérante",
  siege_adresse: "12 rue des Lilas",
  siege_complement: "",
  siege_code_postal: "69 003",
  siege_ville: "Lyon",
};

describe("schemaEntreprise", () => {
  it("normalise une fiche complète", () => {
    expect(schemaEntreprise.parse(complete)).toEqual({
      ...complete,
      raison_sociale: "Plomberie Martin SARL",
      siren: "404833048",
      tva: "FR83404833048",
      siege_complement: null,
      siege_code_postal: "69003",
    });
  });

  it("enregistre une fiche vide : tous les champs deviennent null", () => {
    const vide = schemaEntreprise.parse({ raison_sociale: "", siren: "  ", tva: null });
    expect(Object.values(vide).every((valeur) => valeur === null)).toBe(true);
  });

  it("donne un message pour chaque règle", () => {
    expect(verifierSaisie({ siren: "12345678" })).toEqual({ siren: MESSAGES.sirenMalForme });
    expect(verifierSaisie({ siren: "404833049" })).toEqual({ siren: MESSAGES.sirenInvalide });
    expect(verifierSaisie({ tva: "FR834048330" })).toEqual({ tva: MESSAGES.tvaMalFormee });
    expect(verifierSaisie({ tva: "FR84404833048" })).toEqual({ tva: MESSAGES.tvaInvalide });
    expect(verifierSaisie({ siege_code_postal: "6900" })).toEqual({ siege_code_postal: MESSAGES.codePostalMalForme });
    expect(verifierSaisie({ raison_sociale: "x".repeat(121) })).toEqual({ raison_sociale: MESSAGES.tropLong(120) });
    expect(verifierSaisie({ representant_nom: "x".repeat(81) })).toEqual({ representant_nom: MESSAGES.tropLong(80) });
  });

  it("refuse une TVA qui ne porte pas le SIREN, et donne la bonne", () => {
    expect(verifierSaisie({ ...complete, tva: "FR44732829320" })).toEqual({
      tva: "Ce n° de TVA ne correspond pas au SIREN. Attendu : FR83404833048.",
    });
  });

  it("vérifie la TVA même si un autre champ est en erreur", () => {
    expect(verifierSaisie({ ...complete, siege_code_postal: "6900", tva: "FR44732829320" })).toEqual({
      siege_code_postal: MESSAGES.codePostalMalForme,
      tva: MESSAGES.tvaIncoherente("FR83404833048"),
    });
  });

  it("ne juge pas la TVA tant que le SIREN est faux", () => {
    expect(verifierSaisie({ ...complete, siren: "404833049" })).toEqual({ siren: MESSAGES.sirenInvalide });
  });

  it("accepte des longueurs au maximum", () => {
    expect(verifierSaisie({ raison_sociale: "x".repeat(120), siege_ville: "x".repeat(80) })).toEqual({});
  });
});

describe("fiche complète", () => {
  it("demande tous les champs sauf le complément d'adresse", () => {
    expect(CHAMPS_REQUIS).not.toContain("siege_complement");
    expect(CHAMPS_REQUIS).toHaveLength(9);
  });

  it("liste les champs manquants dans l'ordre de la fiche, espaces compris", () => {
    expect(champsManquants({})).toEqual(CHAMPS_REQUIS);
    expect(champsManquants({ ...complete, tva: null, siege_ville: "   " })).toEqual(["tva", "siege_ville"]);
  });

  it("est complète sans complément d'adresse", () => {
    expect(ficheComplete(complete)).toBe(true);
    expect(ficheComplete({ ...complete, representant_fonction: "" })).toBe(false);
  });
});
