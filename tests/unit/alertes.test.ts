import { afterEach, describe, expect, it, vi } from "vitest";
import { echeancesDuJour, seuilDuJour } from "@/lib/avis/echeance";
import { emailAlertes, type AvisAlerte } from "@/lib/avis/email-alertes";
import { ajouterJours } from "@/lib/dates";

// Alertes J-15, J-7, J-2 (phase 14) : le seuil du jour, à l'heure de Paris, et l'email qui regroupe les avis.

afterEach(() => {
  vi.useRealTimers();
});

describe("seuilDuJour", () => {
  const echeance = "2026-11-28";

  it.each([
    [15, 15],
    [7, 7],
    [2, 2],
  ])("J-%i : seuil %i", (jours, seuil) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(`${ajouterJours(echeance, -jours)}T10:00:00Z`));
    expect(seuilDuJour(echeance)).toBe(seuil);
  });

  it.each([45, 16, 14, 8, 6, 3, 1, 0, -1, -10])("J-%i : aucun seuil", (jours) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(`${ajouterJours(echeance, -jours)}T10:00:00Z`));
    expect(seuilDuJour(echeance)).toBeNull();
  });

  it("compte à l'heure de Paris : à 23:30 UTC, c'est déjà le lendemain", () => {
    vi.useFakeTimers();
    // Le 13/11 à 23:30 UTC est le 14/11 à 00:30 à Paris : J-14, plus J-15.
    vi.setSystemTime(new Date("2026-11-13T23:30:00Z"));
    expect(seuilDuJour(echeance)).toBeNull();
    // Le 13/11 à 22:30 UTC est encore le 13/11 à 23:30 à Paris : J-15.
    vi.setSystemTime(new Date("2026-11-13T22:30:00Z"));
    expect(seuilDuJour(echeance)).toBe(15);
  });

  it("prend le jour qu'on lui donne", () => {
    expect(seuilDuJour(echeance, "2026-11-21")).toBe(7);
    expect(seuilDuJour(echeance, "2026-11-22")).toBeNull();
  });
});

describe("echeancesDuJour", () => {
  it("donne les échéances à J+15, J+7 et J+2", () => {
    expect(echeancesDuJour("2026-10-17")).toEqual(["2026-11-01", "2026-10-24", "2026-10-19"]);
  });

  it("passe d'un mois et d'une année à l'autre", () => {
    expect(echeancesDuJour("2026-12-25")).toEqual(["2027-01-09", "2027-01-01", "2026-12-27"]);
  });
});

describe("emailAlertes", () => {
  const aujourdhui = "2026-10-17";
  const urlSite = "https://designo.exemple.fr";
  const avis = (id: string, jours: number, champs: Partial<AvisAlerte> = {}): AvisAlerte => ({
    id,
    numero: "1234567890",
    plaque: "AB-123-CD",
    // Le 03/10 à 08:30 à Paris.
    infraction_le: "2026-10-03T06:30:00Z",
    echeance: ajouterJours(aujourdhui, jours),
    ...champs,
  });

  it("trie les avis par échéance, chacun avec son échéance et son lien absolu", () => {
    const { html, texte } = emailAlertes({
      avis: [avis("a15", 15, { numero: "1500000000" }), avis("a2", 2, { numero: "0200000000" }), avis("a7", 7)],
      aujourdhui,
      urlSite,
    });

    const ordre = ["/avis/a2", "/avis/a7", "/avis/a15"].map((lien) => html.indexOf(`href="${urlSite}${lien}"`));
    expect(ordre.every((position) => position > 0)).toBe(true);
    expect(ordre).toEqual(ordre.toSorted((a, b) => a - b));

    expect(texte).toContain("avant le 19/10/2026 · J-2");
    expect(texte).toContain("avant le 24/10/2026 · J-7");
    expect(texte).toContain("avant le 01/11/2026 · J-15");
    expect(texte).toContain("AB-123-CD · avis n° 0200000000");
    expect(texte).toContain("Infraction du 03/10/2026 à 08:30");
    expect(texte).toContain(`${urlSite}/avis/a2`);
    expect(texte.indexOf("/avis/a2")).toBeLessThan(texte.indexOf("/avis/a7"));
    expect(texte.indexOf("/avis/a7")).toBeLessThan(texte.indexOf("/avis/a15"));
  });

  it("J-2 en rouge, J-7 et J-15 en ambre", () => {
    const { html } = emailAlertes({ avis: [avis("a2", 2), avis("a7", 7), avis("a15", 15)], aujourdhui, urlSite });
    expect(html).toMatch(/color:#B42318;[^>]*>avant le 19\/10\/2026 · J-2</);
    expect(html).toMatch(/color:#B45309;[^>]*>avant le 24\/10\/2026 · J-7</);
    expect(html).toMatch(/color:#B45309;[^>]*>avant le 01\/11\/2026 · J-15</);
  });

  it("mène à la liste des avis, sans double barre si l'adresse du site en a une", () => {
    const { html, texte } = emailAlertes({ avis: [avis("a2", 2)], aujourdhui, urlSite: `${urlSite}/` });
    expect(html).toContain(`href="${urlSite}/avis"`);
    expect(html).toContain("Voir mes avis");
    expect(texte).toContain(`Voir mes avis : ${urlSite}/avis`);
    expect(html).not.toContain(`${urlSite}//`);
  });

  it("remplace un champ vide par un libellé", () => {
    const { html, texte } = emailAlertes({
      avis: [avis("a7", 7, { numero: null, plaque: null, infraction_le: null })],
      aujourdhui,
      urlSite,
    });
    for (const contenu of [html, texte]) {
      expect(contenu).toContain("Plaque non saisie");
      expect(contenu).toContain("N° non saisi");
    }
    expect(html).toContain("Date de l&#39;infraction non saisie");
    expect(texte).toContain("Date de l'infraction non saisie");
  });

  it("échappe les valeurs dans le HTML", () => {
    const { html } = emailAlertes({
      avis: [avis('"><script>alert(1)</script>', 7, { plaque: "<b>AB</b>" })],
      aujourdhui,
      urlSite,
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>AB</b>");
    expect(html).toContain("&lt;b&gt;AB&lt;/b&gt;");
    expect(html).toContain("/avis/&quot;&gt;&lt;script&gt;");
  });

  it("sujet au pluriel : le nombre d'avis et l'échéance la plus proche", () => {
    const { sujet, html } = emailAlertes({ avis: [avis("a7", 7), avis("a2", 2), avis("a15", 15)], aujourdhui, urlSite });
    expect(sujet).toBe("3 avis à désigner · échéance la plus proche le 19/10 (J-2)");
    expect(html).toContain("Leur échéance de désignation approche");
  });

  it("sujet au singulier", () => {
    const { sujet, html } = emailAlertes({ avis: [avis("a15", 15)], aujourdhui, urlSite });
    expect(sujet).toBe("1 avis à désigner · échéance le 01/11 (J-15)");
    expect(html).toContain("Son échéance de désignation approche");
  });

  it("refuse une liste vide : sans avis, pas d'email", () => {
    expect(() => emailAlertes({ avis: [], aujourdhui, urlSite })).toThrow();
  });
});
