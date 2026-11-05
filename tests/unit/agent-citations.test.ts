import { describe, expect, it } from "vitest";
import {
  ECRANS,
  analyserLien,
  cleElement,
  elementsDesResultats,
  lienAffectation,
  lienElement,
  nettoyerReponse,
} from "@/lib/agent/citations";
import { CONSIGNES } from "@/lib/agent/definition";

// Les liens des réponses de l'agent (phase 26) : seul un lien vers un élément renvoyé par un outil, ou vers un écran,
// reste un lien.

const AVIS = "0f9b7a52-1c3d-4e5f-8a9b-1c2d3e4f5a6b";
const VEHICULE = "6a7b8c9d-0e1f-4a2b-9c3d-4e5f6a7b8c9d";
const CONDUCTEUR = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const AUTRE = "9e8d7c6b-5a4f-4e3d-ac2b-1a0f9e8d7c6b";

const connus = new Set([cleElement("avis", AVIS), cleElement("vehicule", VEHICULE), cleElement("conducteur", CONDUCTEUR)]);

describe("analyserLien", () => {
  it("reconnaît un avis, un véhicule, un conducteur et un écran", () => {
    expect(analyserLien(`/avis/${AVIS}`)).toEqual({ element: { type: "avis", id: AVIS, lien: `/avis/${AVIS}` } });
    expect(analyserLien(`/flotte/vehicules/${VEHICULE}`)).toMatchObject({ element: { type: "vehicule", id: VEHICULE } });
    expect(analyserLien(`/flotte/conducteurs/${CONDUCTEUR}`)).toMatchObject({ element: { type: "conducteur" } });
    expect(analyserLien("/flotte/planning")).toEqual({ ecran: "/flotte/planning" });
    expect(analyserLien("/parametres/entreprise")).toEqual({ ecran: "/parametres/entreprise" });
  });

  it("reconnaît les écrans où agir hors du rôle de l'agent (phase 31)", () => {
    for (const ecran of ["/rapports", "/parametres/integrations", "/parametres/abonnement", "/parametres/compte"]) {
      expect(analyserLien(ecran), ecran).toEqual({ ecran });
    }
  });

  it("reconnaît le planning d'un véhicule à une date, dans n'importe quel ordre, et le remet en forme", () => {
    const lien = lienAffectation(VEHICULE, "2026-03-12");
    expect(analyserLien(lien)).toEqual({
      element: { type: "planning", id: VEHICULE, date: "2026-03-12", lien },
    });
    expect(analyserLien(`/flotte/planning?vehicule=${VEHICULE}&date=2026-03-12`)).toMatchObject({ element: { lien } });
    expect(analyserLien(`/flotte/planning?vehicule=${VEHICULE}`)).toMatchObject({ element: { date: null } });
  });

  it("refuse tout autre lien", () => {
    for (const lien of [
      "https://exemple.fr",
      `https://designo.fr/avis/${AVIS}`,
      "javascript:alert(1)",
      `/avis/${AVIS}/recap`,
      "/avis/123",
      `//exemple.fr/avis/${AVIS}`,
      "/parametres/compte/x",
      "/tableau-de-bord",
      `/flotte/planning?vehicule=${VEHICULE}&date=2026-02-30`,
      `/flotte/planning?vehicule=${VEHICULE}&conducteur=${CONDUCTEUR}`,
      `/flotte/planning?vehicule=${VEHICULE}&vehicule=${AUTRE}`,
      "/flotte/planning?date=2026-03-12",
    ]) {
      expect(analyserLien(lien), lien).toBeNull();
    }
  });
});

describe("nettoyerReponse", () => {
  it("garde les liens vers les éléments connus et les écrans, et les cite une fois chacun", () => {
    const { contenu, elements_cites } = nettoyerReponse(
      `[Karim Benali](/flotte/conducteurs/${CONDUCTEUR}) avait [AB-123-CD](/flotte/vehicules/${VEHICULE}) ` +
        `([planning](/flotte/planning?vehicule=${VEHICULE}&date=2026-03-12)). Voir aussi [AB-123-CD](/flotte/vehicules/${VEHICULE}) ` +
        "et l'écran [Planning](/flotte/planning).",
      connus,
    );
    expect(contenu).toContain(`[Karim Benali](/flotte/conducteurs/${CONDUCTEUR})`);
    expect(contenu).toContain(`[planning](${lienAffectation(VEHICULE, "2026-03-12")})`);
    expect(contenu).toContain("[Planning](/flotte/planning)");
    expect(elements_cites).toEqual([
      { type: "conducteur", id: CONDUCTEUR, lien: lienElement("conducteur", CONDUCTEUR) },
      { type: "vehicule", id: VEHICULE, lien: lienElement("vehicule", VEHICULE) },
      { type: "planning", id: VEHICULE, date: "2026-03-12", lien: lienAffectation(VEHICULE, "2026-03-12") },
    ]);
  });

  it("fait du texte d'un lien inventé, externe, ou vers un élément d'une autre entreprise", () => {
    const { contenu, elements_cites } = nettoyerReponse(
      `[avis inventé](/avis/${AUTRE}), [site](https://exemple.fr "titre"), [planning d'ailleurs](/flotte/planning?vehicule=${AUTRE}&date=2026-03-12), ` +
        `![image](https://exemple.fr/x.png), <https://exemple.fr/piege> et [avis n° 1](/avis/${AVIS}).`,
      connus,
    );
    expect(contenu).toBe(
      `avis inventé, site, planning d'ailleurs, image, https://exemple.fr/piege et [avis n° 1](/avis/${AVIS}).`,
    );
    expect(elements_cites).toEqual([{ type: "avis", id: AVIS, lien: `/avis/${AVIS}` }]);
  });

  it("garde le lien vers l'écran où agir d'une demande hors rôle (phase 31)", () => {
    const refus = "Je ne peux pas résilier votre abonnement. Ouvrez [Abonnement](/parametres/abonnement) pour le gérer.";
    expect(nettoyerReponse(refus, new Set())).toEqual({ contenu: refus, elements_cites: [] });
  });

  it("laisse un texte sans lien tel quel", () => {
    expect(nettoyerReponse("  Aucune affectation sur AB-123-CD le 12/03/2026 à 08:00.\n", connus)).toEqual({
      contenu: "Aucune affectation sur AB-123-CD le 12/03/2026 à 08:00.",
      elements_cites: [],
    });
  });
});

describe("elementsDesResultats", () => {
  it("retrouve les éléments renvoyés par les outils, d'après leurs résultats en JSON", () => {
    const resultats = [
      JSON.stringify({ vehicules: [{ id: VEHICULE, lien: lienElement("vehicule", VEHICULE) }] }),
      JSON.stringify({ affectation: { lien: lienAffectation(AUTRE, "2026-03-12") }, avis: { lien: `/avis/${AVIS}` } }),
      JSON.stringify({ erreur: "Ce conducteur est introuvable." }),
    ];
    expect(elementsDesResultats(resultats).toSorted()).toEqual(
      [cleElement("vehicule", VEHICULE), cleElement("vehicule", AUTRE), cleElement("avis", AVIS)].toSorted(),
    );
  });
});

describe("les écrans des consignes (phase 31)", () => {
  // definition.ts n'importe que des paquets : ce test garde ses écrans alignés sur ceux que le panneau rend en lien.
  const liens = (texte: string) => [...texte.matchAll(/\]\((\/[^)\s]*)\)/g)].map(([, lien]) => lien);

  it("listent, dans « # Les écrans », exactement les écrans liables, dans le même ordre", () => {
    const section = /^# Les écrans\n([\s\S]*?)(?=^# )/m.exec(CONSIGNES)?.[1] ?? "";
    expect(liens(section)).toEqual(ECRANS);
  });

  it("ne renvoient vers aucun écran que le panneau rendrait en texte", () => {
    const ecrans = liens(CONSIGNES).filter((lien) => !lien.includes("…"));
    expect(ecrans.length).toBeGreaterThan(ECRANS.length);
    for (const lien of ecrans) expect(analyserLien(lien), lien).toEqual({ ecran: lien });
  });
});
