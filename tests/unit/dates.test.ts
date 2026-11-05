import { describe, expect, it } from "vitest";
import {
  ajouterAnnees,
  ajouterJours,
  ajouterMois,
  aujourdhuiParis,
  depuisIso,
  ecartJours,
  instantParis,
  normaliserDate,
  normaliserHeure,
  partiesParis,
  versIso,
} from "@/lib/dates";
import {
  formaterDateHeure,
  formaterEuros,
  formaterJourHeure,
  formaterJourLong,
  formaterMontant,
  formaterMontantSaisie,
} from "@/lib/format";

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

describe("ajouterMois", () => {
  it("ajoute ou retire des mois, d'une année à l'autre", () => {
    expect(ajouterMois("2026-10-18", -3)).toBe("2026-07-18");
    expect(ajouterMois("2026-01-15", -3)).toBe("2025-10-15");
    expect(ajouterMois("2026-10-01", 1)).toBe("2026-11-01");
    expect(ajouterMois("2026-12-01", 1)).toBe("2027-01-01");
  });

  it("ramène un jour qui n'existe pas au dernier jour du mois, comme Postgres", () => {
    expect(ajouterMois("2026-05-31", -3)).toBe("2026-02-28");
    expect(ajouterMois("2028-05-31", -3)).toBe("2028-02-29");
    expect(ajouterMois("2026-01-31", 1)).toBe("2026-02-28");
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

  it("écrit la date du jour en toutes lettres, avec une majuscule", () => {
    expect(formaterJourLong("2026-10-17")).toBe("Samedi 17 octobre 2026");
    expect(formaterJourLong("2027-01-01")).toBe("Vendredi 1er janvier 2027");
  });
});

describe("ajouterJours et ecartJours", () => {
  it("ajoute des jours en passant la fin du mois et de l'année", () => {
    expect(ajouterJours("2026-10-14", 45)).toBe("2026-11-28");
    expect(ajouterJours("2026-12-01", 45)).toBe("2027-01-15");
    expect(ajouterJours("2026-03-29", 1)).toBe("2026-03-30");
  });

  it("compte le 29 février d'une année bissextile", () => {
    expect(ajouterJours("2028-02-01", 45)).toBe("2028-03-17");
    expect(ajouterJours("2027-02-01", 45)).toBe("2027-03-18");
  });

  it("donne l'écart en jours, négatif dans le passé", () => {
    expect(ecartJours("2026-10-14", "2026-11-28")).toBe(45);
    expect(ecartJours("2026-11-28", "2026-10-14")).toBe(-45);
    expect(ecartJours("2026-10-14", "2026-10-14")).toBe(0);
    // Le passage à l'heure d'hiver (25/10) ne compte pas : une date du calendrier n'a pas de fuseau.
    expect(ecartJours("2026-10-24", "2026-10-26")).toBe(2);
  });
});

describe("formats des montants", () => {
  it("affiche « 135,00 € », avec une espace fine pour les milliers et une espace insécable avant €", () => {
    expect(formaterMontant(13500)).toBe("135,00\u00a0€");
    expect(formaterMontant(2497500)).toBe("24\u202f975,00\u00a0€");
    expect(formaterMontant(4550)).toBe("45,50\u00a0€");
  });

  it("affiche un montant rond sans centimes : « 675 € », « 24 975 € »", () => {
    expect(formaterEuros(67500)).toBe("675\u00a0€");
    expect(formaterEuros(2497500)).toBe("24\u202f975\u00a0€");
    expect(formaterEuros(0)).toBe("0\u00a0€");
  });

  it("pré-remplit un champ sans symbole ni séparateur de milliers", () => {
    expect(formaterMontantSaisie(13500)).toBe("135,00");
    expect(formaterMontantSaisie(123450)).toBe("1234,50");
  });
});
