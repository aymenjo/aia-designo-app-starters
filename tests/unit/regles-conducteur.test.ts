import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHAMPS_REQUIS_CONDUCTEUR,
  MESSAGES,
  champsManquantsConducteur,
  nomComplet,
  normaliserCategories,
  normaliserEmail,
  normaliserPermis,
  schemaConducteur,
  verifierSaisieConducteur,
} from "@/lib/flotte/regles";

// Horloge simulée : « aujourd'hui » est le 13/10/2026 à Paris.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-13T10:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("normaliserPermis", () => {
  it.each([
    ["123456789012", "123456789012"],
    ["12 34 56 78 90 12", "123456789012"],
    ["1234-5678-9012", "123456789012"],
    ["ab12cd34", "AB12CD34"],
    ["x".repeat(20), "X".repeat(20)],
  ])("écrit « %s » %s", (brut, attendu) => {
    expect(normaliserPermis(brut)).toBe(attendu);
  });

  it.each(["", "   ", "12.34.56", "1234/5678", "x".repeat(21), "12É456"])("refuse « %s »", (brut) => {
    expect(normaliserPermis(brut)).toBeNull();
  });
});

describe("normaliserCategories", () => {
  it("range les catégories dans l'ordre officiel, sans doublon", () => {
    expect(normaliserCategories("c1, b")).toEqual({ ok: true, categories: ["B", "C1"] });
    expect(normaliserCategories("CE;b c1 / B")).toEqual({ ok: true, categories: ["B", "C1", "CE"] });
    expect(normaliserCategories("de am a")).toEqual({ ok: true, categories: ["AM", "A", "DE"] });
  });

  it("accepte une saisie vide", () => {
    expect(normaliserCategories(" , ")).toEqual({ ok: true, categories: [] });
  });

  it("renvoie la première catégorie inconnue", () => {
    expect(normaliserCategories("B, X, Z")).toEqual({ ok: false, inconnue: "X" });
    expect(normaliserCategories("B1E")).toEqual({ ok: false, inconnue: "B1E" });
  });
});

describe("normaliserEmail", () => {
  it("écrit l'email en minuscules", () => {
    expect(normaliserEmail(" Karim.Benali@Exemple.FR ")).toBe("karim.benali@exemple.fr");
  });

  it.each(["karim", "karim@", "karim@exemple", "karim benali@exemple.fr"])("refuse « %s »", (brut) => {
    expect(normaliserEmail(brut)).toBeNull();
  });
});

const complete = {
  civilite: "m",
  prenom: " Karim ",
  nom: "Benali",
  date_naissance: "12031985",
  lieu_naissance: "",
  adresse: "8 rue des Peupliers",
  adresse_complement: "",
  code_postal: "69 003",
  ville: "Lyon",
  permis_numero: "1234 5678 9012",
  permis_delivre_le: "04/06/2004",
  permis_categories: "c1, b",
  email: "Karim@Exemple.fr",
};

describe("schemaConducteur", () => {
  it("normalise une fiche complète", () => {
    expect(schemaConducteur.parse(complete)).toEqual({
      civilite: "m",
      prenom: "Karim",
      nom: "Benali",
      date_naissance: "1985-03-12",
      lieu_naissance: null,
      adresse: "8 rue des Peupliers",
      adresse_complement: null,
      code_postal: "69003",
      ville: "Lyon",
      permis_numero: "123456789012",
      permis_delivre_le: "2004-06-04",
      permis_categories: ["B", "C1"],
      email: "karim@exemple.fr",
    });
  });

  it("accepte une fiche avec le prénom et le nom seuls", () => {
    const fiche = schemaConducteur.parse({ prenom: "Léa", nom: "Martin", civilite: "", permis_categories: "" });
    expect(fiche).toMatchObject({ prenom: "Léa", nom: "Martin", civilite: null, permis_categories: null });
    expect(Object.values(fiche).filter((valeur) => valeur !== null)).toEqual(["Léa", "Martin"]);
  });

  it("exige le prénom et le nom", () => {
    expect(verifierSaisieConducteur({ prenom: " ", nom: undefined })).toEqual({
      prenom: MESSAGES.prenomVide,
      nom: MESSAGES.nomVide,
    });
  });

  it("donne un message pour chaque règle", () => {
    const erreurs = (saisie: object) => verifierSaisieConducteur({ ...complete, ...saisie });
    expect(erreurs({ civilite: "mlle" })).toEqual({ civilite: MESSAGES.civiliteInconnue });
    expect(erreurs({ prenom: "x".repeat(81) })).toEqual({ prenom: MESSAGES.tropLong(80) });
    expect(erreurs({ date_naissance: "12/03/85" })).toEqual({ date_naissance: MESSAGES.dateMalFormee });
    expect(erreurs({ date_naissance: "31/02/1985" })).toEqual({ date_naissance: MESSAGES.dateInexistante("31/02/1985") });
    expect(erreurs({ code_postal: "6900" })).toEqual({ code_postal: MESSAGES.codePostalMalForme });
    expect(erreurs({ permis_numero: "12.34" })).toEqual({ permis_numero: MESSAGES.permisMalForme });
    expect(erreurs({ permis_categories: "B, X" })).toEqual({ permis_categories: MESSAGES.categorieInconnue("X") });
    expect(erreurs({ email: "karim@" })).toEqual({ email: MESSAGES.emailMalForme });
  });
});

describe("vraisemblance des dates", () => {
  const erreurs = (saisie: object) => verifierSaisieConducteur({ ...complete, ...saisie });

  it("la naissance est passée et au plus tôt le 01/01/1900", () => {
    expect(erreurs({ date_naissance: "01/01/1900", permis_delivre_le: "" })).toEqual({});
    expect(erreurs({ date_naissance: "31/12/1899", permis_delivre_le: "" })).toEqual({
      date_naissance: MESSAGES.naissanceTropAncienne,
    });
    expect(erreurs({ date_naissance: "13/10/2026", permis_delivre_le: "" })).toEqual({});
    expect(erreurs({ date_naissance: "14/10/2026", permis_delivre_le: "" })).toEqual({
      date_naissance: MESSAGES.naissanceFuture,
    });
  });

  it("aujourd'hui se compte à l'heure de Paris", () => {
    // 22:30 UTC le 13/10 = 00:30 le 14/10 à Paris.
    vi.setSystemTime(new Date("2026-10-13T22:30:00Z"));
    expect(erreurs({ permis_delivre_le: "14/10/2026" })).toEqual({});
  });

  it("la délivrance est passée", () => {
    expect(erreurs({ permis_delivre_le: "13/10/2026" })).toEqual({});
    expect(erreurs({ permis_delivre_le: "14/10/2026" })).toEqual({ permis_delivre_le: MESSAGES.delivranceFuture });
  });

  it("la délivrance suit la naissance d'au moins 14 ans", () => {
    expect(erreurs({ date_naissance: "12/03/1985", permis_delivre_le: "12/03/1999" })).toEqual({});
    expect(erreurs({ date_naissance: "12/03/1985", permis_delivre_le: "11/03/1999" })).toEqual({
      permis_delivre_le: MESSAGES.delivranceTropTot,
    });
    // Né un 29/02 : ses 14 ans tombent le 28/02, comme en base.
    expect(erreurs({ date_naissance: "29/02/2000", permis_delivre_le: "28/02/2014" })).toEqual({});
    expect(erreurs({ date_naissance: "29/02/2000", permis_delivre_le: "27/02/2014" })).toEqual({
      permis_delivre_le: MESSAGES.delivranceTropTot,
    });
  });

  it("compare les deux dates même si un autre champ est en erreur", () => {
    expect(erreurs({ code_postal: "6900", permis_delivre_le: "01/01/1990" })).toEqual({
      code_postal: MESSAGES.codePostalMalForme,
      permis_delivre_le: MESSAGES.delivranceTropTot,
    });
  });

  it("ne compare pas tant qu'une des deux dates est fausse", () => {
    expect(erreurs({ date_naissance: "31/02/1985", permis_delivre_le: "01/01/1990" })).toEqual({
      date_naissance: MESSAGES.dateInexistante("31/02/1985"),
    });
  });
});

describe("fiche complète", () => {
  it("demande tous les champs sauf le lieu de naissance, le complément, les catégories et l'email", () => {
    expect(CHAMPS_REQUIS_CONDUCTEUR).toEqual([
      "civilite",
      "prenom",
      "nom",
      "date_naissance",
      "adresse",
      "code_postal",
      "ville",
      "permis_numero",
      "permis_delivre_le",
    ]);
  });

  it("liste les champs manquants dans l'ordre de la fiche, espaces compris", () => {
    expect(champsManquantsConducteur({ prenom: "Léa", nom: "Martin" })).toEqual([
      "civilite",
      "date_naissance",
      "adresse",
      "code_postal",
      "ville",
      "permis_numero",
      "permis_delivre_le",
    ]);
    expect(champsManquantsConducteur({ ...complete, ville: "  ", permis_numero: null })).toEqual([
      "ville",
      "permis_numero",
    ]);
    expect(champsManquantsConducteur(complete)).toEqual([]);
  });

  it("ajouter un champ à la liste des requis suffit à changer le compte", () => {
    const requis = [...CHAMPS_REQUIS_CONDUCTEUR, "lieu_naissance", "permis_categories"] as const;
    expect(champsManquantsConducteur(complete, requis)).toEqual(["lieu_naissance"]);
    expect(champsManquantsConducteur({ ...complete, permis_categories: [] }, requis)).toEqual([
      "lieu_naissance",
      "permis_categories",
    ]);
  });
});

describe("nomComplet", () => {
  it("affiche le prénom puis le nom", () => {
    expect(nomComplet({ prenom: "Karim", nom: "Benali" })).toBe("Karim Benali");
  });
});
