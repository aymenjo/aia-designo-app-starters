import { describe, expect, it } from "vitest";
import { LIMITES_FREE } from "@/lib/abonnement/plans";
import {
  choixVehiculesRequis,
  debutHistorique,
  masqueParHistorique,
  moisQuota,
  prochainDeverrouillage,
} from "@/lib/abonnement/quotas";

describe("moisQuota et prochainDeverrouillage", () => {
  it("le quota d'un jour est celui de son mois ; il se remet à zéro le 1er du mois suivant", () => {
    expect(moisQuota("2026-10-18")).toBe("2026-10-01");
    expect(moisQuota("2026-10-01")).toBe("2026-10-01");
    expect(prochainDeverrouillage("2026-10-18")).toBe("2026-11-01");
    expect(prochainDeverrouillage("2026-12-31")).toBe("2027-01-01");
  });
});

describe("debutHistorique", () => {
  it(`en Free, minuit à Paris il y a ${LIMITES_FREE.historiqueMois} mois`, () => {
    // Heure d'été : minuit à Paris vaut 22:00 UTC la veille.
    expect(debutHistorique("free", "2026-10-18")).toBe("2026-07-17T22:00:00.000Z");
    // Heure d'hiver : 23:00 UTC la veille.
    expect(debutHistorique("free", "2026-04-15")).toBe("2026-01-14T23:00:00.000Z");
    expect(debutHistorique("free", "2026-05-31")).toBe("2026-02-27T23:00:00.000Z");
  });

  it("en Pro, tout est visible", () => {
    expect(debutHistorique("pro", "2026-10-18")).toBeNull();
  });
});

describe("masqueParHistorique", () => {
  const debut = "2026-07-17T22:00:00.000Z";

  it("masque un avis désigné ou classé avant le début de l'historique", () => {
    expect(masqueParHistorique({ designe_le: "2026-07-17T21:59:59Z", classe_le: null }, debut)).toBe(true);
    expect(masqueParHistorique({ designe_le: null, classe_le: "2026-01-02T08:00:00Z" }, debut)).toBe(true);
  });

  it("garde un avis clos depuis, et un avis ouvert quelle que soit sa date de dépôt", () => {
    expect(masqueParHistorique({ designe_le: debut, classe_le: null }, debut)).toBe(false);
    expect(masqueParHistorique({ designe_le: null, classe_le: "2026-10-01T08:00:00Z" }, debut)).toBe(false);
    expect(masqueParHistorique({ designe_le: null, classe_le: null }, debut)).toBe(false);
  });

  it("en Pro, rien n'est masqué", () => {
    expect(masqueParHistorique({ designe_le: "2020-01-01T08:00:00Z", classe_le: null }, null)).toBe(false);
  });
});

describe("choixVehiculesRequis", () => {
  const usage = { avisCeMois: 0 };

  it("au retour en Free, aucun véhicule actif et au moins un en lecture seule : le choix est à faire", () => {
    expect(choixVehiculesRequis({ plan: "free", ...usage, vehicules: 0, enLectureSeule: 5 })).toBe(true);
  });

  it("un véhicule actif suffit : le choix est fait", () => {
    expect(choixVehiculesRequis({ plan: "free", ...usage, vehicules: 1, enLectureSeule: 4 })).toBe(false);
  });

  it("sans véhicule en lecture seule non archivé, rien à choisir", () => {
    // `enLectureSeule` ne compte pas les véhicules archivés, même en lecture seule.
    expect(choixVehiculesRequis({ plan: "free", ...usage, vehicules: 0, enLectureSeule: 0 })).toBe(false);
  });

  it("en Pro, jamais", () => {
    expect(choixVehiculesRequis({ plan: "pro", ...usage, vehicules: 0, enLectureSeule: 5 })).toBe(false);
  });
});
