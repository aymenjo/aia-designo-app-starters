import { describe, expect, it } from "vitest";
import { calculerEcheance, echeanceDepassee, joursRestants, niveauEcheance } from "@/lib/avis/echeance";

describe("calculerEcheance", () => {
  it("vaut la date d'envoi plus 45 jours", () => {
    expect(calculerEcheance("2026-10-14")).toBe("2026-11-28");
    expect(calculerEcheance("2026-11-30")).toBe("2027-01-14");
  });

  it("passe la fin du mois de février, bissextile ou non", () => {
    expect(calculerEcheance("2028-01-20")).toBe("2028-03-05");
    expect(calculerEcheance("2027-01-20")).toBe("2027-03-06");
  });
});

describe("joursRestants", () => {
  it("compte les jours jusqu'à l'échéance, 0 le jour même, négatif une fois dépassée", () => {
    expect(joursRestants("2026-11-28", "2026-10-14")).toBe(45);
    expect(joursRestants("2026-11-28", "2026-11-28")).toBe(0);
    expect(joursRestants("2026-11-28", "2026-11-30")).toBe(-2);
  });
});

describe("niveauEcheance", () => {
  it.each([
    [45, "calme"],
    [16, "calme"],
    [15, "a_regarder"],
    [7, "a_regarder"],
    [3, "a_regarder"],
    [2, "urgent"],
    [0, "urgent"],
    [-1, "depassee"],
  ])("J-%i : %s", (jours, niveau) => {
    expect(niveauEcheance(jours)).toBe(niveau);
  });
});

describe("echeanceDepassee", () => {
  it("un avis ouvert dont l'échéance est passée est dépassé ; J-0 ne l'est pas encore", () => {
    expect(echeanceDepassee({ statut: "a_traiter", echeance: "2026-11-28" }, "2026-11-29")).toBe(true);
    expect(echeanceDepassee({ statut: "a_valider", echeance: "2026-11-28" }, "2026-12-30")).toBe(true);
    expect(echeanceDepassee({ statut: "a_valider", echeance: "2026-11-28" }, "2026-11-28")).toBe(false);
    expect(echeanceDepassee({ statut: "a_traiter", echeance: "2026-11-28" }, "2026-10-14")).toBe(false);
  });

  it("un avis désigné ou classé, ou sans échéance, n'est jamais dépassé", () => {
    expect(echeanceDepassee({ statut: "designe", echeance: "2026-11-28" }, "2026-12-30")).toBe(false);
    expect(echeanceDepassee({ statut: "classe", echeance: "2026-11-28" }, "2026-12-30")).toBe(false);
    expect(echeanceDepassee({ statut: "a_traiter", echeance: null }, "2026-12-30")).toBe(false);
  });
});
