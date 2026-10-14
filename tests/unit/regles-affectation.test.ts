import { describe, expect, it } from "vitest";
import {
  MESSAGES,
  nomAbrege,
  schemaAffectation,
  schemaCloture,
  verifierSaisieAffectation,
  type SaisieAffectation,
} from "@/lib/flotte/regles";

const VEHICULE = "11111111-1111-4111-8111-111111111111";
const CONDUCTEUR = "22222222-2222-4222-8222-222222222222";

const saisie = (champs: SaisieAffectation = {}): SaisieAffectation => ({
  vehicule_id: VEHICULE,
  conducteur_id: CONDUCTEUR,
  debut_date: "03/03/2026",
  debut_heure: "08:00",
  ...champs,
});

describe("schemaAffectation", () => {
  it("donne des instants à l'heure de Paris, sans fin par défaut", () => {
    expect(schemaAffectation("attitre").parse(saisie({ fin_date: "3/3/2026", fin_heure: "18h" }))).toEqual({
      vehicule_id: VEHICULE,
      conducteur_id: CONDUCTEUR,
      debut: "2026-03-03T07:00:00.000Z",
      fin: "2026-03-03T17:00:00.000Z",
    });
    expect(schemaAffectation("attitre").parse(saisie()).fin).toBeNull();
  });

  it("une heure de début vide vaut 00:00", () => {
    expect(schemaAffectation().parse(saisie({ debut_heure: "" })).debut).toBe("2026-03-02T23:00:00.000Z");
  });

  it.each<[string, SaisieAffectation, Record<string, string>]>([
    ["véhicule vide", { vehicule_id: "" }, { vehicule_id: MESSAGES.vehiculeVide }],
    ["véhicule inconnu", { vehicule_id: "pas-un-id" }, { vehicule_id: MESSAGES.vehiculeIntrouvable }],
    ["conducteur vide", { conducteur_id: null }, { conducteur_id: MESSAGES.conducteurVide }],
    ["début vide", { debut_date: " ", debut_heure: "" }, { debut_date: MESSAGES.debutVide }],
    ["date mal formée", { debut_date: "3 mars" }, { debut_date: MESSAGES.dateMalFormee }],
    ["date inexistante", { debut_date: "30/02/2026" }, { debut_date: MESSAGES.dateInexistante("30/02/2026") }],
    ["heure mal formée", { debut_heure: "25h" }, { debut_heure: MESSAGES.heureMalFormee }],
    ["heure inexistante", { debut_date: "29/03/2026", debut_heure: "02:30" }, { debut_heure: MESSAGES.heureInexistante }],
    ["fin sans heure", { fin_date: "04/03/2026" }, { fin_heure: MESSAGES.finSansHeure }],
    ["fin sans date", { fin_heure: "18:00" }, { fin_date: MESSAGES.finSansDate }],
    ["fin avant le début", { fin_date: "03/03/2026", fin_heure: "07:59" }, { fin_date: MESSAGES.finAvantDebut }],
    ["fin égale au début", { fin_date: "03/03/2026", fin_heure: "08:00" }, { fin_date: MESSAGES.finAvantDebut }],
  ])("signale : %s", (_cas, champs, attendu) => {
    expect(verifierSaisieAffectation(saisie(champs), "attitre")).toEqual(attendu);
  });

  it("signale chaque champ fautif, même quand un autre l'est aussi", () => {
    expect(verifierSaisieAffectation({ debut_heure: "8h", fin_date: "xx", fin_heure: "18" })).toEqual({
      vehicule_id: MESSAGES.vehiculeVide,
      conducteur_id: MESSAGES.conducteurVide,
      debut_date: MESSAGES.debutVide,
      fin_date: MESSAGES.dateMalFormee,
    });
  });

  it("un véhicule de pool exige une fin, un attitré ou un type inconnu non", () => {
    expect(verifierSaisieAffectation(saisie(), "pool")).toEqual({ fin_date: MESSAGES.finPoolObligatoire });
    expect(verifierSaisieAffectation(saisie({ fin_date: "03/03/2026", fin_heure: "18:00" }), "pool")).toEqual({});
    expect(verifierSaisieAffectation(saisie(), "attitre")).toEqual({});
    expect(verifierSaisieAffectation(saisie())).toEqual({});
  });
});

describe("schemaCloture", () => {
  const debut = "2026-03-03T07:00:00+00:00";

  it("exige la date et l'heure de fin, après le début", () => {
    expect(schemaCloture(debut).parse({ fin_date: "04/03/2026", fin_heure: "18:00" })).toBe("2026-03-04T17:00:00.000Z");
    expect(schemaCloture(debut).safeParse({}).error?.issues).toEqual([
      expect.objectContaining({ path: ["fin_date"], message: MESSAGES.finVide }),
    ]);
    expect(schemaCloture(debut).safeParse({ fin_date: "03/03/2026", fin_heure: "07:00" }).error?.issues).toEqual([
      expect.objectContaining({ path: ["fin_date"], message: MESSAGES.finAvantDebut }),
    ]);
  });
});

describe("messages des affectations", () => {
  it("nomAbrege donne le prénom et l'initiale du nom", () => {
    expect(nomAbrege({ prenom: "Karim", nom: "Benali" })).toBe("Karim B.");
    expect(nomAbrege({ prenom: "Léa", nom: " élise" })).toBe("Léa É.");
  });

  it("le conflit nomme le conducteur, le véhicule et le créneau, à l'heure de Paris", () => {
    expect(
      MESSAGES.conflitAffectation("Karim B.", "AB-123-CD", "2026-03-03T07:00:00Z", "2026-03-03T17:00:00Z"),
    ).toBe("Conflit avec : Karim B. sur AB-123-CD du 03/03 08:00 au 03/03 18:00.");
    expect(MESSAGES.conflitAffectation("Karim B.", "AB-123-CD", "2026-07-01T06:00:00Z", null)).toBe(
      "Conflit avec : Karim B. sur AB-123-CD à partir du 01/07 08:00.",
    );
  });

  it("les refus d'archivage et de passage en pool nomment l'affectation ouverte", () => {
    expect(MESSAGES.affectationEnCours("Karim B.", "AB-123-CD")).toBe(
      "Clôturez d'abord l'affectation de Karim B. sur AB-123-CD.",
    );
    expect(MESSAGES.poolAvecAffectationOuverte("Karim B.")).toBe(
      "Clôturez d'abord l'affectation de Karim B. : un véhicule de pool n'a que des affectations avec une fin.",
    );
  });
});
