import { describe, expect, it } from "vitest";
import { designeATemps } from "@/lib/avis/echeance";
import type { StatutAvis } from "@/lib/avis/regles";
import { moisParis, prochainesEcheances, sansEcheance, syntheseTableauDeBord } from "@/lib/avis/tableau-de-bord";
import { ajouterJours } from "@/lib/dates";

const AUJOURDHUI = "2026-10-17";
/** L'échéance à J-n : négatif une fois dépassée. */
const aJ = (jours: number) => ajouterJours(AUJOURDHUI, jours);

const avis = (
  id: string,
  statut: StatutAvis,
  echeance: string | null,
  designe_le: string | null = null,
  depose_le = "2026-10-01T08:00:00+00:00",
) => ({ id, statut, echeance, designe_le, depose_le });

describe("designeATemps", () => {
  it.each([
    // Le jour de l'échéance à 23:30, heure de Paris (UTC+1 l'hiver) : à temps.
    ["le jour de l'échéance à 23:30", "2026-01-15T22:30:00Z", true],
    // Le lendemain à 00:30 à Paris, alors qu'il est encore le 15 en UTC : en retard.
    ["le lendemain à 00:30", "2026-01-15T23:30:00Z", false],
    ["la veille", "2026-01-14T09:00:00Z", true],
  ])("désigné %s, heure de Paris : %s", (_, designe_le, aTemps) => {
    expect(designeATemps({ statut: "designe", echeance: "2026-01-15", designe_le })).toBe(aTemps);
  });

  it("un avis qui n'est pas désigné, ou sans échéance, ne rapporte rien", () => {
    expect(designeATemps({ statut: "a_valider", echeance: "2026-01-15", designe_le: null })).toBe(false);
    expect(designeATemps({ statut: "designe", echeance: null, designe_le: "2026-01-14T09:00:00Z" })).toBe(false);
  });
});

describe("moisParis", () => {
  it("prend le mois qu'il est à Paris, pas en UTC", () => {
    expect(moisParis("2026-10-31T22:30:00Z")).toBe("2026-10");
    expect(moisParis("2026-10-31T23:30:00Z")).toBe("2026-11");
  });
});

describe("syntheseTableauDeBord", () => {
  it("compte les avis ouverts, « À traiter » et « À valider »", () => {
    const { aTraiter } = syntheseTableauDeBord(
      [
        avis("1", "a_traiter", aJ(30)),
        avis("2", "a_traiter", null),
        avis("3", "a_valider", aJ(10)),
        avis("4", "designe", aJ(10), "2026-10-10T08:00:00Z"),
        avis("5", "classe", aJ(10)),
      ],
      AUJOURDHUI,
    );
    expect(aTraiter).toEqual({ total: 3, a_traiter: 2, a_valider: 1 });
  });

  it.each([
    [16, { total: 0, urgentes: 0, depassees: 0 }],
    [15, { total: 1, urgentes: 0, depassees: 0 }],
    [3, { total: 1, urgentes: 0, depassees: 0 }],
    [2, { total: 1, urgentes: 1, depassees: 0 }],
    [0, { total: 1, urgentes: 1, depassees: 0 }],
    [-1, { total: 1, urgentes: 0, depassees: 1 }],
  ])("échéances proches, à J-%i : %o", (jours, attendu) => {
    expect(syntheseTableauDeBord([avis("1", "a_valider", aJ(jours))], AUJOURDHUI).echeancesProches).toEqual(attendu);
  });

  it("les avis désignés, classés ou sans échéance ne sont pas des échéances proches", () => {
    const { echeancesProches } = syntheseTableauDeBord(
      [
        avis("1", "designe", aJ(1), "2026-10-15T08:00:00Z"),
        avis("2", "classe", aJ(-3)),
        avis("3", "a_traiter", null),
      ],
      AUJOURDHUI,
    );
    expect(echeancesProches).toEqual({ total: 0, urgentes: 0, depassees: 0 });
  });

  it("675 € par avis désigné à temps : le mois de la désignation pour « ce mois-ci », tous pour le cumul", () => {
    const { designes, eurosEvites } = syntheseTableauDeBord(
      [
        avis("ce-mois", "designe", aJ(10), "2026-10-15T08:00:00Z"),
        avis("mois-dernier", "designe", "2026-10-02", "2026-09-28T08:00:00Z"),
        // Désigné ce mois-ci, mais après son échéance : 0 €.
        avis("en-retard", "designe", aJ(-5), "2026-10-16T08:00:00Z"),
        // Rouvert : sa date de désignation est effacée.
        avis("rouvert", "a_valider", aJ(10)),
        avis("classe", "classe", aJ(10)),
      ],
      AUJOURDHUI,
    );
    expect(designes).toEqual({ total: 3, ceMois: 2 });
    expect(eurosEvites).toEqual({ ceMois: 67_500, cumul: 135_000 });
  });

  it("le mois se lit à l'heure de Paris : le 31/10 à 23:30 UTC est déjà en novembre", () => {
    const { designes, eurosEvites } = syntheseTableauDeBord(
      [avis("1", "designe", "2026-11-20", "2026-10-31T23:30:00Z")],
      "2026-11-01",
    );
    expect(designes.ceMois).toBe(1);
    expect(eurosEvites.ceMois).toBe(67_500);
  });

  it("sans avis, tout est à zéro", () => {
    expect(syntheseTableauDeBord([], AUJOURDHUI)).toEqual({
      aTraiter: { total: 0, a_traiter: 0, a_valider: 0 },
      echeancesProches: { total: 0, urgentes: 0, depassees: 0 },
      designes: { total: 0, ceMois: 0 },
      eurosEvites: { ceMois: 0, cumul: 0 },
    });
  });
});

describe("prochainesEcheances", () => {
  it("garde au plus 5 avis ouverts avec une échéance, de la plus proche à la plus lointaine", () => {
    const prochaines = prochainesEcheances([
      avis("j30", "a_valider", aJ(30)),
      avis("sans", "a_traiter", null),
      avis("j10", "a_traiter", aJ(10)),
      avis("designe", "designe", aJ(1), "2026-10-15T08:00:00Z"),
      avis("j-3", "a_traiter", aJ(-3)),
      avis("j40", "a_traiter", aJ(40)),
      avis("classe", "classe", aJ(2)),
      avis("j1", "a_valider", aJ(1)),
      avis("j20", "a_traiter", aJ(20)),
    ]);
    expect(prochaines.map(({ id }) => id)).toEqual(["j-3", "j1", "j10", "j20", "j30"]);
  });
});

describe("sansEcheance", () => {
  it("compte les avis ouverts dont la date d'envoi n'est pas saisie", () => {
    expect(
      sansEcheance([
        avis("1", "a_traiter", null),
        avis("2", "a_traiter", null),
        avis("3", "a_traiter", aJ(10)),
        avis("4", "classe", null),
      ]),
    ).toBe(2);
  });
});
