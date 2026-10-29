import { describe, expect, it } from "vitest";
import { lienAvis, lireFiltreAvis, trierPourSuivi } from "@/lib/avis/liste";
import type { StatutAvis } from "@/lib/avis/regles";

const avis = (id: string, statut: StatutAvis, echeance: string | null, depose_le = "2026-10-01T08:00:00+00:00") => ({
  id,
  statut,
  echeance,
  depose_le,
});

describe("trierPourSuivi", () => {
  it("les avis ouverts d'abord, ceux sans échéance en tête, puis par échéance croissante ; désignés et classés à la fin", () => {
    const tries = trierPourSuivi([
      avis("designe-tot", "designe", "2026-10-01"),
      avis("loin", "a_valider", "2026-12-20"),
      avis("classe-sans", "classe", null),
      avis("sans-echeance", "a_traiter", null),
      avis("depassee", "a_traiter", "2026-10-02"),
      avis("proche", "a_valider", "2026-10-20"),
      avis("classe", "classe", "2026-11-01"),
    ]);
    expect(tries.map(({ id }) => id)).toEqual([
      "sans-echeance",
      "depassee",
      "proche",
      "loin",
      "classe-sans",
      "designe-tot",
      "classe",
    ]);
  });

  it("à échéance égale, le premier déposé passe d'abord", () => {
    const tries = trierPourSuivi([
      avis("tard", "a_traiter", "2026-11-01", "2026-10-05T09:00:00.5+00:00"),
      avis("tot", "a_valider", "2026-11-01", "2026-10-05T09:00:00.123456+00:00"),
      avis("sans-tard", "a_traiter", null, "2026-10-06T08:00:00+00:00"),
      avis("sans-tot", "a_traiter", null, "2026-10-02T08:00:00+00:00"),
    ]);
    expect(tries.map(({ id }) => id)).toEqual(["sans-tot", "sans-tard", "tot", "tard"]);
  });

  it("ne modifie pas la liste reçue", () => {
    const liste = [avis("b", "a_traiter", "2026-11-02"), avis("a", "a_traiter", "2026-11-01")];
    trierPourSuivi(liste);
    expect(liste.map(({ id }) => id)).toEqual(["b", "a"]);
  });
});

describe("lireFiltreAvis", () => {
  it("garde un statut proposé par le filtre", () => {
    expect(lireFiltreAvis({ statut: "a_valider" })).toEqual({ statut: "a_valider" });
    expect(lireFiltreAvis({ statut: "designe" })).toEqual({ statut: "designe" });
    expect(lireFiltreAvis({ statut: "classe" })).toEqual({ statut: "classe" });
  });

  it("ignore un statut inconnu ou absent", () => {
    expect(lireFiltreAvis({})).toEqual({ statut: undefined });
    expect(lireFiltreAvis({ statut: "perdu" })).toEqual({ statut: undefined });
    expect(lireFiltreAvis({ statut: "" })).toEqual({ statut: undefined });
  });

  it("d'un paramètre répété, garde la première valeur", () => {
    expect(lireFiltreAvis({ statut: ["a_traiter", "designe"] })).toEqual({ statut: "a_traiter" });
    expect(lireFiltreAvis({ statut: ["perdu", "designe"] })).toEqual({ statut: undefined });
  });
});

describe("lienAvis", () => {
  it("sans filtre, mène à la liste entière ; sinon, porte le statut", () => {
    expect(lienAvis({})).toBe("/avis");
    expect(lienAvis({ statut: "a_valider" })).toBe("/avis?statut=a_valider");
  });

  it("relit son propre lien", () => {
    const lien = new URL(lienAvis({ statut: "designe" }), "http://designo.test");
    expect(lireFiltreAvis(Object.fromEntries(lien.searchParams))).toEqual({ statut: "designe" });
  });
});
