import { Font } from "@react-pdf/renderer";
import { describe, expect, it } from "vitest";
import { CHAMPS_REQUIS_CONDUCTEUR, LIBELLES_CHAMP_CONDUCTEUR } from "@/lib/flotte/regles";
import { CHAMPS_REQUIS, LIBELLES_CHAMP } from "@/lib/entreprise/regles";
import { genererPdfRapport } from "@/lib/rapport/pdf";
import type { SyntheseRapport } from "@/lib/rapport/synthese";

// Le PDF du rapport mensuel (phase 25) : il tient en 1 page pour un mois vide, et en 2 pages au plus pour une flotte
// dense, grâce aux listes tronquées. Les pages se comptent dans le PDF lui-même.

const VIDE: SyntheseRapport = {
  mois: "2026-10-01",
  recus: 0,
  designes: 0,
  classes: 0,
  echeancesManquees: [],
  eurosEvites: { mois: 0, cumul: 0 },
  plusVerbalises: { vehicules: [], conducteurs: [] },
  fichesIncompletes: { entreprise: [], conducteurs: [] },
  aucunAvis: true,
};

/** Le pire cas : 20 échéances dépassées, 15 conducteurs et la fiche entreprise incomplets, champs manquants au complet. */
const DENSE: SyntheseRapport = {
  mois: "2026-10-01",
  recus: 42,
  designes: 31,
  classes: 4,
  echeancesManquees: Array.from({ length: 20 }, (_, rang) => ({
    id: `avis-${rang}`,
    numero: String(1_234_567_000 + rang),
    plaque: `AB-${String(100 + rang)}-CD`,
    echeance: `2026-10-${String(rang + 1).padStart(2, "0")}`,
    statut: rang % 3 ? "a_valider" : "designe",
  })),
  eurosEvites: { mois: 2_092_500, cumul: 24_975_000 },
  plusVerbalises: {
    vehicules: Array.from({ length: 3 }, (_, rang) => ({
      plaque: `EF-${400 + rang}-GH`,
      modele: "Renault Master L2H2 Grand Confort",
      douzeMois: 14 - rang,
      mois: 3,
      montantCentimes: 213_500,
    })),
    conducteurs: Array.from({ length: 3 }, (_, rang) => ({
      nom: `Jean-Christophe Delacroix-Montaigne ${rang}`,
      douzeMois: 9 - rang,
      mois: 2,
      montantCentimes: 121_500,
    })),
  },
  fichesIncompletes: {
    entreprise: CHAMPS_REQUIS.map((champ) => LIBELLES_CHAMP[champ]),
    conducteurs: Array.from({ length: 15 }, (_, rang) => ({
      nom: `Marie-Hélène D${rang}.`,
      manquants: CHAMPS_REQUIS_CONDUCTEUR.filter((champ) => champ !== "prenom" && champ !== "nom").map(
        (champ) => LIBELLES_CHAMP_CONDUCTEUR[champ],
      ),
    })),
  },
  aucunAvis: false,
};

const GENERE_LE = "2026-11-01T06:00:00Z";

/** Les pages d'un PDF : ses objets `/Type /Page`, sans `/Pages`. */
function pages(pdf: Buffer) {
  return pdf.toString("latin1").match(/\/Type\s*\/Page(?!s)/g)?.length ?? 0;
}

describe("genererPdfRapport", () => {
  it("rend un PDF d'une page pour un mois sans avis", async () => {
    const pdf = await genererPdfRapport({ raisonSociale: "Plomberie Martin SARL", synthese: VIDE, genereLe: GENERE_LE });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pages(pdf)).toBe(1);
  });

  it("tient en 2 pages au plus pour une flotte dense", async () => {
    const pdf = await genererPdfRapport({ raisonSociale: "Plomberie Martin SARL", synthese: DENSE, genereLe: GENERE_LE });
    expect(pages(pdf)).toBeGreaterThanOrEqual(1);
    expect(pages(pdf)).toBeLessThanOrEqual(2);
  });

  it("garde à chaque lettre son caractère, même écrite après une lettre accentuée qui la contient", async () => {
    // « Échéances » dessine « É », composé de « E » et d'un accent : sans préchauffage, fontkit garderait ce « E » sans
    // caractère, et « SIREN » se couperait ou se copierait de travers.
    await genererPdfRapport({ raisonSociale: "Plomberie Martin SARL", synthese: DENSE, genereLe: GENERE_LE });
    const police = Font.getFont({ fontFamily: "Geist", fontWeight: 400 }).data as unknown as {
      glyphForCodePoint: (codePoint: number) => { codePoints: number[] };
    };
    expect(police.glyphForCodePoint("E".codePointAt(0)!).codePoints).toEqual(["E".codePointAt(0)]);
  });

  it("se rend sans raison sociale", async () => {
    const pdf = await genererPdfRapport({ raisonSociale: null, synthese: VIDE, genereLe: GENERE_LE });
    expect(pages(pdf)).toBe(1);
  });
});
