import { describe, expect, it } from "vitest";
import { cheminRapport, etatEnvoi, moisDepuisSegment, nomFichierRapport, prochainRapportLe } from "@/lib/rapport/liste";
import { destinatairesRapport } from "@/lib/rapport/rapports";

// Les rapports archivés (phase 25) : leur fichier, leur état d'envoi, le prochain envoi et ses destinataires.

describe("fichiers", () => {
  it("range le PDF d'un mois à un chemin fixe, et le nomme pour le téléchargement", () => {
    expect(cheminRapport("e1", "2026-10-01")).toBe("e1/2026-10.pdf");
    expect(nomFichierRapport("2026-10-01")).toBe("rapport-flotte-2026-10.pdf");
  });

  it("lit le mois dans l'adresse de téléchargement", () => {
    expect(moisDepuisSegment("2026-10")).toBe("2026-10-01");
    expect(moisDepuisSegment("2026-13")).toBeNull();
    expect(moisDepuisSegment("2026-10-01")).toBeNull();
    expect(moisDepuisSegment("../e2/2026-10")).toBeNull();
  });
});

describe("etatEnvoi", () => {
  it("dit envoyé, en attente pour le mois écoulé, ou non envoyé pour un mois plus ancien", () => {
    expect(etatEnvoi({ mois: "2026-10-01", envoye_le: "2026-11-01T06:00:00Z" }, "2026-11-02")).toBe("envoye");
    expect(etatEnvoi({ mois: "2026-10-01", envoye_le: null }, "2026-11-02")).toBe("en_attente");
    expect(etatEnvoi({ mois: "2026-09-01", envoye_le: null }, "2026-11-02")).toBe("non_envoye");
  });
});

describe("prochainRapportLe", () => {
  it("annonce le 1er du mois suivant pour une entreprise créée ce mois-ci", () => {
    expect(prochainRapportLe({ entrepriseCreeeLe: "2026-11-05T08:00:00Z", rapports: [], aujourdhui: "2026-11-20" })).toBe(
      "2026-12-01",
    );
  });

  it("annonce le lendemain quand le rapport du mois écoulé est dû et pas encore parti", () => {
    // Créée en octobre (le 31 à 23:30 à Paris), passée en Pro en novembre : le rapport d'octobre part au passage suivant.
    const creeeLe = "2026-10-31T22:30:00Z";
    expect(prochainRapportLe({ entrepriseCreeeLe: creeeLe, rapports: [], aujourdhui: "2026-11-20" })).toBe("2026-11-21");
    expect(
      prochainRapportLe({
        entrepriseCreeeLe: creeeLe,
        rapports: [{ mois: "2026-10-01", envoye_le: null }],
        aujourdhui: "2026-11-20",
      }),
    ).toBe("2026-11-21");
  });

  it("annonce le 1er du mois suivant une fois le rapport du mois écoulé parti", () => {
    expect(
      prochainRapportLe({
        entrepriseCreeeLe: "2026-01-05T08:00:00Z",
        rapports: [{ mois: "2026-10-01", envoye_le: "2026-11-01T06:00:00Z" }],
        aujourdhui: "2026-11-20",
      }),
    ).toBe("2026-12-01");
  });
});

describe("destinatairesRapport", () => {
  it("met la direction en « À » et le gestionnaire en « Cc »", () => {
    expect(destinatairesRapport(["dg@exemple.fr", "daf@exemple.fr"], "office@exemple.fr")).toEqual({
      a: ["dg@exemple.fr", "daf@exemple.fr"],
      cc: ["office@exemple.fr"],
    });
  });

  it("n'écrit qu'une fois au gestionnaire qui est aussi une adresse « direction »", () => {
    expect(destinatairesRapport(["office@exemple.fr", "dg@exemple.fr"], "Office@Exemple.fr")).toEqual({
      a: ["office@exemple.fr", "dg@exemple.fr"],
      cc: [],
    });
  });

  it("écrit au gestionnaire seul sans adresse « direction »", () => {
    expect(destinatairesRapport([], "office@exemple.fr")).toEqual({ a: ["office@exemple.fr"], cc: [] });
  });
});
