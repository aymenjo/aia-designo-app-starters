import { describe, expect, it } from "vitest";
import { MESSAGES, normaliserPlaque, schemaVehicule } from "@/lib/flotte/regles";
import { formaterDate } from "@/lib/format";

describe("normaliserPlaque", () => {
  it.each([
    ["ab-123-cd", "AB-123-CD"],
    ["AB 123 CD", "AB-123-CD"],
    ["ab123cd", "AB-123-CD"],
    [" AB-123-CD ", "AB-123-CD"],
    ["123 abc 45", "123-ABC-45"],
    ["1234 AB 2A", "1234-AB-2A"],
    ["12 ABC 975", "12-ABC-975"],
    ["1 A 01", "1-A-01"],
  ])("accepte « %s » et l'écrit %s", (brut, attendu) => {
    expect(normaliserPlaque(brut)).toBe(attendu);
  });

  it.each([
    ["AB-12-CD", "trois chiffres au milieu"],
    ["ABC-123-DE", "deux lettres de chaque côté"],
    ["AB-000-CD", "le bloc 000 n'existe pas"],
    ["AB-123-CO", "ni O, ni I, ni U en SIV"],
    ["IB-123-CD", "ni O, ni I, ni U en SIV"],
    ["AB-123-CU", "ni O, ni I, ni U en SIV"],
    ["123 ABC", "un département est requis"],
    ["123 ABC 00", "département 00 inexistant"],
    ["12345 AB 75", "au plus 4 chiffres"],
    ["", "chaîne vide"],
  ])("refuse « %s » (%s)", (brut) => {
    expect(normaliserPlaque(brut)).toBeNull();
  });
});

describe("schemaVehicule", () => {
  const valide = { plaque: "ab 123 cd", modele: "  Renault Master ", type: "attitre" };

  it("normalise la plaque et rogne le modèle", () => {
    expect(schemaVehicule.parse(valide)).toEqual({ plaque: "AB-123-CD", modele: "Renault Master", type: "attitre" });
  });

  it.each(["", "   ", null, undefined])("transforme un modèle vide (%j) en null", (modele) => {
    expect(schemaVehicule.parse({ ...valide, modele }).modele).toBeNull();
  });

  const erreur = (saisie: object) => schemaVehicule.safeParse({ ...valide, ...saisie }).error?.issues[0].message;

  it("donne un message pour chaque règle", () => {
    expect(erreur({ plaque: "" })).toBe(MESSAGES.plaqueVide);
    expect(erreur({ plaque: "   " })).toBe(MESSAGES.plaqueVide);
    expect(erreur({ plaque: undefined })).toBe(MESSAGES.plaqueVide);
    expect(erreur({ plaque: "AB-12-CD" })).toBe(MESSAGES.plaqueMalFormee);
    expect(erreur({ modele: "x".repeat(81) })).toBe(MESSAGES.modeleTropLong);
    expect(erreur({ type: "" })).toBe(MESSAGES.typeVide);
    expect(erreur({ type: "camion" })).toBe(MESSAGES.typeVide);
  });

  it("accepte un modèle de 80 caractères", () => {
    expect(schemaVehicule.safeParse({ ...valide, modele: "x".repeat(80) }).success).toBe(true);
  });

  it("nomme la plaque dans les messages de doublon", () => {
    expect(MESSAGES.plaqueDejaPresente("AB-123-CD")).toBe("La plaque AB-123-CD est déjà dans votre flotte.");
    expect(MESSAGES.plaqueArchivee("AB-123-CD")).toBe("AB-123-CD appartient à un véhicule archivé.");
  });
});

describe("formaterDate", () => {
  it("écrit la date JJ/MM/AAAA à l'heure de Paris", () => {
    // 23:30 UTC le 11/10 = 01:30 le 12/10 à Paris (heure d'été).
    expect(formaterDate("2026-10-11T23:30:00Z")).toBe("12/10/2026");
    // 22:59 UTC le 11/01 = 23:59 le 11/01 à Paris (heure d'hiver).
    expect(formaterDate(new Date("2026-01-11T22:59:00Z"))).toBe("11/01/2026");
  });
});
