import { describe, expect, it } from "vitest";
import { decoderCsv, ecrireCsv, lireCsv } from "@/lib/csv";

const octets = (...valeurs: number[]) => new Uint8Array(valeurs);
const utf8 = (texte: string) => new TextEncoder().encode(texte);

describe("decoderCsv", () => {
  it("lit l'UTF-8 et retire le BOM", () => {
    expect(decoderCsv(utf8("Modèle;Prénom"))).toBe("Modèle;Prénom");
    expect(decoderCsv(octets(0xef, 0xbb, 0xbf, ...utf8("Modèle")))).toBe("Modèle");
  });

  it("retombe sur windows-1252 quand le fichier n'est pas de l'UTF-8 (CSV d'Excel sous Windows)", () => {
    // « Modèle;Bâtiment » en windows-1252 : è = 0xE8, â = 0xE2.
    const texte = octets(0x4d, 0x6f, 0x64, 0xe8, 0x6c, 0x65, 0x3b, 0x42, 0xe2, 0x74, 0x69, 0x6d, 0x65, 0x6e, 0x74);
    expect(decoderCsv(texte)).toBe("Modèle;Bâtiment");
  });
});

describe("lireCsv", () => {
  it("découpe les cellules et les enregistrements, quelle que soit la fin de ligne", () => {
    const attendu = [
      ["a", "b"],
      ["c", "d"],
      ["e", ""],
    ];
    expect(lireCsv("a;b\r\nc;d\r\ne;\r\n", ";")).toEqual({ ok: true, enregistrements: attendu });
    expect(lireCsv("a;b\nc;d\ne;", ";")).toEqual({ ok: true, enregistrements: attendu });
    expect(lireCsv("a;b\rc;d\re;\r", ";")).toEqual({ ok: true, enregistrements: attendu });
  });

  it("garde les lignes vides, pour numéroter les lignes comme Excel", () => {
    expect(lireCsv("a\n\n;;\nb\n", ";")).toEqual({ ok: true, enregistrements: [["a"], [""], ["", "", ""], ["b"]] });
  });

  it("lit les guillemets : séparateur, guillemet échappé et saut de ligne dans une cellule", () => {
    expect(lireCsv('"Dupont; Karim";"5 rue ""Haute""";"Bât. B\r\n2e étage"\nx', ";")).toEqual({
      ok: true,
      enregistrements: [["Dupont; Karim", '5 rue "Haute"', "Bât. B\r\n2e étage"], ["x"]],
    });
    expect(lireCsv('"";a', ";")).toEqual({ ok: true, enregistrements: [["", "a"]] });
  });

  it("garde tel quel un guillemet au milieu d'une cellule", () => {
    expect(lireCsv('Écran 5" pouces;b', ";")).toEqual({ ok: true, enregistrements: [['Écran 5" pouces', "b"]] });
  });

  it("lit le séparateur demandé", () => {
    expect(lireCsv("a,b;c", ",")).toEqual({ ok: true, enregistrements: [["a", "b;c"]] });
  });

  it("signale un guillemet jamais fermé, avec le n° de l'enregistrement où il s'ouvre", () => {
    expect(lireCsv('a;b\nc;"d\ne;f\n', ";")).toEqual({ ok: false, ligne: 2 });
  });

  it("un fichier vide n'a aucun enregistrement", () => {
    expect(lireCsv("", ";")).toEqual({ ok: true, enregistrements: [] });
  });
});

describe("ecrireCsv", () => {
  it("écrit un BOM, des « ; » et des fins de ligne CRLF", () => {
    expect(ecrireCsv([["Plaque", "Modèle"], ["AB-123-CD", null]])).toBe("﻿Plaque;Modèle\r\nAB-123-CD;\r\n");
  });

  it("met entre guillemets les cellules qui contiennent ; \" ou un saut de ligne", () => {
    expect(ecrireCsv([["a;b", 'dit "oui"', "1\n2", 135]])).toBe('﻿"a;b";"dit ""oui""";"1\n2";135\r\n');
  });

  it("se relit à l'identique", () => {
    const lignes = [
      ["Nom", "Adresse"],
      ["Benali; Karim", '12 rue "des Lilas"\r\nBât. B'],
      ["", "é"],
    ];
    expect(lireCsv(decoderCsv(utf8(ecrireCsv(lignes))), ";")).toEqual({ ok: true, enregistrements: lignes });
  });
});
