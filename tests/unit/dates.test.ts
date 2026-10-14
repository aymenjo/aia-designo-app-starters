import { describe, expect, it } from "vitest";
import {
  ajouterAnnees,
  aujourdhuiParis,
  depuisIso,
  instantParis,
  normaliserDate,
  normaliserHeure,
  partiesParis,
  versIso,
} from "@/lib/dates";
import { formaterDateHeure, formaterJourHeure } from "@/lib/format";

describe("normaliserDate", () => {
  it.each([
    ["12/03/1985", "12/03/1985"],
    ["12031985", "12/03/1985"],
    ["12/3/1985", "12/03/1985"],
    ["2/3/1985", "02/03/1985"],
    ["12.03.1985", "12/03/1985"],
    ["12-03-1985", "12/03/1985"],
    [" 12 / 03 / 1985 ", "12/03/1985"],
    ["31/02/1985", "31/02/1985"],
  ])("écrit « %s » %s", (brut, attendu) => {
    expect(normaliserDate(brut)).toBe(attendu);
  });

  it.each([
    ["12/03/85", "année sur 2 chiffres, ambiguë"],
    ["120385", "année sur 2 chiffres, ambiguë"],
    ["1985-03-12", "ordre ISO"],
    ["123/03/1985", "jour sur 3 chiffres"],
    ["12 mars 1985", "mois en lettres"],
    ["", "chaîne vide"],
  ])("refuse « %s » (%s)", (brut) => {
    expect(normaliserDate(brut)).toBeNull();
  });
});

describe("versIso et depuisIso", () => {
  it("fait l'aller-retour", () => {
    expect(versIso("12/03/1985")).toBe("1985-03-12");
    expect(depuisIso("1985-03-12")).toBe("12/03/1985");
    expect(depuisIso(versIso("01/01/1900")!)).toBe("01/01/1900");
  });

  it("accepte le 29/02 d'une année bissextile", () => {
    expect(versIso("29/02/2000")).toBe("2000-02-29");
    expect(versIso("29/02/2024")).toBe("2024-02-29");
  });

  it.each(["31/02/1985", "29/02/2023", "29/02/1900", "31/04/1985", "00/01/1985", "12/13/1985", "12031985"])(
    "refuse « %s », qui n'existe pas ou n'est pas normalisée",
    (date) => {
      expect(versIso(date)).toBeNull();
    },
  );
});

describe("aujourdhuiParis", () => {
  it("donne le jour à Paris, pas celui du serveur", () => {
    // 23:30 UTC le 11/10 = 01:30 le 12/10 à Paris (heure d'été).
    expect(aujourdhuiParis(new Date("2026-10-11T23:30:00Z"))).toBe("2026-10-12");
    // 22:59 UTC le 11/01 = 23:59 le 11/01 à Paris (heure d'hiver).
    expect(aujourdhuiParis(new Date("2026-01-11T22:59:00Z"))).toBe("2026-01-11");
  });
});

describe("ajouterAnnees", () => {
  it("ajoute des années", () => {
    expect(ajouterAnnees("1985-03-12", 14)).toBe("1999-03-12");
  });

  it("ramène le 29/02 au 28/02 d'une année non bissextile, comme Postgres", () => {
    expect(ajouterAnnees("2000-02-29", 14)).toBe("2014-02-28");
    expect(ajouterAnnees("2000-02-29", 4)).toBe("2004-02-29");
  });
});

describe("normaliserHeure", () => {
  it.each([
    ["8", "08:00"],
    ["8h", "08:00"],
    ["8h30", "08:30"],
    ["8 h 30", "08:30"],
    ["0830", "08:30"],
    ["830", "08:30"],
    ["8:30", "08:30"],
    ["8.30", "08:30"],
    ["18H45", "18:45"],
    ["00:00", "00:00"],
    ["23:59", "23:59"],
  ])("écrit « %s » %s", (brut, attendu) => {
    expect(normaliserHeure(brut)).toBe(attendu);
  });

  it.each(["24:00", "8h60", "8:3", "12345", "midi", ""])("refuse « %s »", (brut) => {
    expect(normaliserHeure(brut)).toBeNull();
  });
});

describe("instantParis et partiesParis", () => {
  it("convertit l'heure de Paris, en hiver (+1) comme en été (+2)", () => {
    expect(instantParis("2026-03-03", "08:00")).toBe("2026-03-03T07:00:00.000Z");
    expect(instantParis("2026-07-01", "08:00")).toBe("2026-07-01T06:00:00.000Z");
    expect(partiesParis("2026-03-03T07:00:00Z")).toEqual({ date: "2026-03-03", heure: "08:00" });
    expect(partiesParis("2026-07-01T22:30:00Z")).toEqual({ date: "2026-07-02", heure: "00:30" });
  });

  it("refuse une heure qui n'existe pas, le jour du passage à l'heure d'été", () => {
    expect(instantParis("2026-03-29", "02:30")).toBeNull();
    expect(instantParis("2026-03-29", "01:59")).toBe("2026-03-29T00:59:00.000Z");
    expect(instantParis("2026-03-29", "03:00")).toBe("2026-03-29T01:00:00.000Z");
  });

  it("donne la seconde occurrence d'une heure répétée, le jour du retour à l'heure d'hiver", () => {
    expect(instantParis("2026-10-25", "02:30")).toBe("2026-10-25T01:30:00.000Z");
    expect(partiesParis("2026-10-25T00:30:00Z").heure).toBe("02:30");
  });
});

describe("formats date et heure", () => {
  it("affiche à l'heure de Paris, sur 24 h", () => {
    expect(formaterDateHeure("2026-03-03T07:00:00Z")).toBe("03/03/2026 08:00");
    expect(formaterJourHeure("2026-03-03T17:00:00Z")).toBe("03/03 18:00");
    expect(formaterJourHeure("2026-12-31T23:15:00Z")).toBe("01/01 00:15");
  });
});
