import { describe, expect, it } from "vitest";
import { lienPlanning, lireParametresPlanning, periode, positionner } from "@/lib/flotte/planning";

const VEHICULE = "11111111-1111-4111-8111-111111111111";
const CONDUCTEUR = "22222222-2222-4222-8222-222222222222";

describe("periode", () => {
  it("une semaine commence le lundi, même demandée un dimanche", () => {
    for (const jour of ["2026-10-12", "2026-10-14", "2026-10-18"]) {
      const semaine = periode("semaine", jour);
      expect(semaine.jours).toEqual([
        "2026-10-12",
        "2026-10-13",
        "2026-10-14",
        "2026-10-15",
        "2026-10-16",
        "2026-10-17",
        "2026-10-18",
      ]);
    }
    const semaine = periode("semaine", "2026-10-18");
    expect(semaine.libelle).toBe("Semaine du 12/10 au 18/10/2026");
    expect(semaine.precedente).toBe("2026-10-05");
    expect(semaine.suivante).toBe("2026-10-19");
  });

  it("les bornes sont 00:00 à Paris, y compris la semaine du changement d'heure", () => {
    const semaine = periode("semaine", "2026-10-25");
    expect(semaine.debut).toBe("2026-10-18T22:00:00.000Z");
    expect(semaine.fin).toBe("2026-10-25T23:00:00.000Z");
  });

  it("une semaine à cheval sur deux années les nomme toutes deux", () => {
    expect(periode("semaine", "2026-01-01").libelle).toBe("Semaine du 29/12/2025 au 04/01/2026");
  });

  it("un mois va du 1er au dernier jour", () => {
    const fevrier = periode("mois", "2028-02-15");
    expect(fevrier.jours).toHaveLength(29);
    expect(fevrier.jours[0]).toBe("2028-02-01");
    expect(fevrier.jours.at(-1)).toBe("2028-02-29");
    expect(fevrier.libelle).toBe("Février 2028");
    expect(fevrier.debut).toBe("2028-01-31T23:00:00.000Z");
    expect(fevrier.fin).toBe("2028-02-29T23:00:00.000Z");

    const janvier = periode("mois", "2026-01-31");
    expect(janvier.precedente).toBe("2025-12-01");
    expect(janvier.suivante).toBe("2026-02-01");
  });
});

describe("positionner", () => {
  const semaine = periode("semaine", "2026-10-12");

  it("place l'affectation d'après l'heure de Paris", () => {
    // Mardi 08:00 → mardi 20:00 : 1 jour et 1/3, sur 7.
    const position = positionner({ debut: "2026-10-13T06:00:00Z", fin: "2026-10-13T18:00:00Z" }, semaine);
    expect(position.gauche).toBeCloseTo((100 * (1 + 1 / 3)) / 7);
    expect(position.largeur).toBeCloseTo(50 / 7);
    expect(position).toMatchObject({ coupeeAGauche: false, coupeeADroite: false });
  });

  it("coupe à gauche une affectation commencée avant, à droite une affectation sans fin", () => {
    expect(positionner({ debut: "2026-09-01T06:00:00Z", fin: null }, semaine)).toEqual({
      gauche: 0,
      largeur: 100,
      coupeeAGauche: true,
      coupeeADroite: true,
    });
  });

  it("une affectation qui finit pile à la fin de la période n'est pas coupée", () => {
    expect(positionner({ debut: semaine.debut, fin: semaine.fin }, semaine)).toEqual({
      gauche: 0,
      largeur: 100,
      coupeeAGauche: false,
      coupeeADroite: false,
    });
  });

  it("garde les colonnes alignées la semaine du retour à l'heure d'hiver", () => {
    const bascule = periode("semaine", "2026-10-25");
    // Dimanche 25/10 à 12:00 à Paris (heure d'hiver) : 6 jours et demi, sur 7.
    const midi = positionner({ debut: "2026-10-25T11:00:00Z", fin: null }, bascule);
    expect(midi.gauche).toBeCloseTo((100 * 6.5) / 7);
    // Dans l'heure répétée, de 02:45 (été) à 02:15 (hiver) : largeur ramenée à 0.
    expect(positionner({ debut: "2026-10-25T00:45:00Z", fin: "2026-10-25T01:15:00Z" }, bascule).largeur).toBe(0);
  });
});

describe("lireParametresPlanning", () => {
  it("lit la vue, la date et les filtres", () => {
    expect(
      lireParametresPlanning({ vue: "mois", date: "2026-03-12", conducteur: CONDUCTEUR, vehicule: VEHICULE }),
    ).toEqual({ vue: "mois", date: "2026-03-12", conducteur: CONDUCTEUR, vehicule: VEHICULE });
  });

  it("ignore les paramètres invalides, et prend la première valeur d'un paramètre répété", () => {
    expect(
      lireParametresPlanning(
        { vue: "annee", date: "2026-02-30", conducteur: "pas-un-id", vehicule: [VEHICULE, "autre"] },
        "2026-10-13",
      ),
    ).toEqual({ vue: "semaine", date: "2026-10-13", conducteur: undefined, vehicule: VEHICULE });
    expect(lireParametresPlanning({ date: "13/10/2026" }, "2026-10-13").date).toBe("2026-10-13");
  });

  it("lienPlanning omet les valeurs par défaut", () => {
    expect(lienPlanning({})).toBe("/flotte/planning");
    expect(lienPlanning({ vue: "semaine", vehicule: VEHICULE, date: "2026-03-12" })).toBe(
      `/flotte/planning?date=2026-03-12&vehicule=${VEHICULE}`,
    );
  });
});
