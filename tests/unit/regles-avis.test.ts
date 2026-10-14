import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MESSAGES_AVIS,
  TAILLE_MAX_FICHIER,
  champsAConfirmer,
  champsManquantsAvis,
  confiancesApres,
  estOuvert,
  lireMontant,
  normaliserNumeroAvis,
  plusFaible,
  schemaAvis,
  statutDerive,
  typeFichier,
  verifierDepot,
  verifierSaisieAvis,
  type SaisieAvis,
} from "@/lib/avis/regles";

// Aujourd'hui : le 14/10/2026 à midi, heure de Paris.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-14T10:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

const COMPLET: SaisieAvis = {
  numero: "1234567890",
  plaque: "ab 123 cd",
  infraction_date: "03/10/2026",
  infraction_heure: "8h30",
  lieu: "A6, Auxerre",
  infraction: "Excès de vitesse inférieur à 20 km/h",
  montant: "135",
  date_envoi: "06/10/2026",
};

describe("normaliserNumeroAvis", () => {
  it.each([
    ["1234567890", "1234567890"],
    ["12 3456 7890", "1234567890"],
    ["1234-567-890", "1234567890"],
    [" 1234.567.890 ", "1234567890"],
  ])("écrit « %s » %s", (brut, attendu) => {
    expect(normaliserNumeroAvis(brut)).toBe(attendu);
  });

  it.each([
    ["123456789", "9 chiffres"],
    ["12345678901", "11 chiffres"],
    ["12345A7890", "une lettre"],
    ["", "chaîne vide"],
  ])("refuse « %s » (%s)", (brut) => {
    expect(normaliserNumeroAvis(brut)).toBeNull();
  });
});

describe("lireMontant", () => {
  it.each([
    ["135", 13500],
    ["135,00", 13500],
    ["135.5", 13550],
    ["135,05", 13505],
    ["1 234,50", 123450],
    ["1 234,50 €", 123450],
    ["45 €", 4500],
    ["0,50", 50],
  ])("lit « %s » : %i centimes", (brut, centimes) => {
    expect(lireMontant(brut)).toBe(centimes);
  });

  it.each([
    ["0", "nul"],
    ["0,00", "nul"],
    ["-135", "négatif"],
    ["abc", "pas un nombre"],
    ["135,555", "trois décimales"],
    ["1.234,50", "point des milliers, ambigu"],
    ["1234567", "au-delà de 999 999 €"],
    ["", "vide"],
  ])("refuse « %s » (%s)", (brut) => {
    expect(lireMontant(brut)).toBeNull();
  });
});

describe("schemaAvis", () => {
  it("normalise un avis complet : instant à l'heure de Paris, centimes, dates ISO", () => {
    expect(schemaAvis.parse(COMPLET)).toEqual({
      numero: "1234567890",
      plaque: "AB-123-CD",
      infraction_le: "2026-10-03T06:30:00.000Z",
      lieu: "A6, Auxerre",
      infraction: "Excès de vitesse inférieur à 20 km/h",
      montant_centimes: 13500,
      date_envoi: "2026-10-06",
    });
  });

  it("accepte une saisie partielle, et même vide : un champ vide donne null", () => {
    expect(schemaAvis.parse({ numero: "1234567890", lieu: "  " })).toEqual({
      numero: "1234567890",
      plaque: null,
      infraction_le: null,
      lieu: null,
      infraction: null,
      montant_centimes: null,
      date_envoi: null,
    });
    expect(schemaAvis.safeParse({}).success).toBe(true);
  });

  it("signale chaque champ rempli mais fautif, avec le message des écrans", () => {
    expect(
      verifierSaisieAvis({ numero: "123", plaque: "AB-12-CD", montant: "abc", date_envoi: "31/02/2026" }),
    ).toEqual({
      numero: MESSAGES_AVIS.numeroMalForme,
      plaque: MESSAGES_AVIS.plaqueMalFormee,
      montant: MESSAGES_AVIS.montantMalForme,
      date_envoi: "Le 31/02/2026 n'existe pas.",
    });
  });

  it("refuse un texte de plus de 200 caractères", () => {
    expect(verifierSaisieAvis({ lieu: "x".repeat(201) })).toEqual({ lieu: MESSAGES_AVIS.tropLong(200) });
  });
});

describe("cohérence des dates", () => {
  it("la date et l'heure de l'infraction vont ensemble", () => {
    expect(verifierSaisieAvis({ infraction_date: "03/10/2026" })).toEqual({
      infraction_heure: MESSAGES_AVIS.infractionSansHeure,
    });
    expect(verifierSaisieAvis({ infraction_heure: "08:30" })).toEqual({
      infraction_date: MESSAGES_AVIS.infractionSansDate,
    });
  });

  it("signale une heure mal formée, ou qui n'existe pas le jour du passage à l'heure d'été", () => {
    expect(verifierSaisieAvis({ infraction_date: "03/10/2026", infraction_heure: "25h" })).toEqual({
      infraction_heure: MESSAGES_AVIS.heureMalFormee,
    });
    expect(verifierSaisieAvis({ infraction_date: "29/03/2026", infraction_heure: "02:30" })).toEqual({
      infraction_heure: MESSAGES_AVIS.heureInexistante,
    });
  });

  it("la date d'envoi n'est pas dans le futur, à l'heure de Paris", () => {
    expect(verifierSaisieAvis({ date_envoi: "14/10/2026" })).toEqual({});
    expect(verifierSaisieAvis({ date_envoi: "15/10/2026" })).toEqual({ date_envoi: MESSAGES_AVIS.envoiFutur });

    // 23 h 30 à Paris le 14 : le serveur, en UTC, est encore le 14 ; le 15 reste dans le futur.
    vi.setSystemTime(new Date("2026-10-14T21:30:00Z"));
    expect(verifierSaisieAvis({ date_envoi: "15/10/2026" })).toEqual({ date_envoi: MESSAGES_AVIS.envoiFutur });
    // 00 h 30 à Paris le 15 : le serveur, en UTC, est encore le 14 ; le 15 est aujourd'hui.
    vi.setSystemTime(new Date("2026-10-14T22:30:00Z"));
    expect(verifierSaisieAvis({ date_envoi: "15/10/2026" })).toEqual({});
  });

  it("l'infraction n'est pas postérieure à l'envoi, comparée sur le jour de Paris", () => {
    expect(
      verifierSaisieAvis({ infraction_date: "07/10/2026", infraction_heure: "08:00", date_envoi: "06/10/2026" }),
    ).toEqual({ date_envoi: MESSAGES_AVIS.infractionApresEnvoi });
    // Le jour même de l'envoi, même à 23 h 30 (le 06 à 21 h 30 en UTC), c'est accepté.
    expect(
      verifierSaisieAvis({ infraction_date: "06/10/2026", infraction_heure: "23:30", date_envoi: "06/10/2026" }),
    ).toEqual({});
  });
});

describe("champs manquants et statut dérivé", () => {
  const donnees = schemaAvis.parse(COMPLET);

  it("un avis complet passe « À valider »", () => {
    expect(champsManquantsAvis(donnees)).toEqual([]);
    expect(statutDerive(donnees)).toBe("a_valider");
  });

  it("un champ vide le laisse « À traiter », et la liste suit l'ordre de l'avis", () => {
    expect(champsManquantsAvis({ ...donnees, montant_centimes: null, numero: null })).toEqual([
      "numero",
      "montant_centimes",
    ]);
    expect(statutDerive({ ...donnees, infraction_le: null })).toBe("a_traiter");
    expect(champsManquantsAvis({})).toHaveLength(7);
  });
});

describe("confiance de la lecture IA", () => {
  const donnees = schemaAvis.parse(COMPLET);

  it("le moins sûr de deux niveaux l'emporte", () => {
    expect(plusFaible(undefined, "a_verifier")).toBe("a_verifier");
    expect(plusFaible("sur", "a_verifier")).toBe("a_verifier");
    expect(plusFaible("non_lu", "sur")).toBe("non_lu");
  });

  it("seuls les champs rouges remplis sont à confirmer", () => {
    const confiances = { numero: "non_lu", lieu: "a_verifier", montant_centimes: "non_lu" } as const;
    expect(champsAConfirmer({ ...donnees, confiances })).toEqual(["numero", "montant_centimes"]);
    // Rouge et vide : le champ manque, il n'y a rien à confirmer.
    expect(champsAConfirmer({ ...donnees, numero: null, confiances })).toEqual(["montant_centimes"]);
    expect(champsAConfirmer(donnees)).toEqual([]);
  });

  it("un champ rouge laisse l'avis « À traiter », même complet ; un champ orange, non", () => {
    expect(statutDerive({ ...donnees, confiances: { date_envoi: "non_lu" } })).toBe("a_traiter");
    expect(statutDerive({ ...donnees, confiances: { date_envoi: "a_verifier", plaque: "sur" } })).toBe("a_valider");
  });

  describe("confiancesApres", () => {
    const confiances = { numero: "sur", plaque: "a_verifier", infraction_le: "non_lu", date_envoi: "non_lu" } as const;
    // Tel que la base le renvoie : l'instant est écrit autrement, mais c'est le même.
    const enBase = { ...donnees, infraction_le: "2026-10-03T06:30:00+00:00" };

    it("garde le niveau d'un champ inchangé, quel que soit le format de l'instant", () => {
      expect(confiancesApres(confiances, enBase, donnees)).toEqual(confiances);
    });

    it("efface le niveau d'un champ modifié ou vidé", () => {
      const apres = { ...donnees, plaque: "AB-124-CD", infraction_le: null };
      expect(confiancesApres(confiances, enBase, apres)).toEqual({ numero: "sur", date_envoi: "non_lu" });
    });

    it("efface le niveau d'un champ rouge confirmé, pas celui d'un champ orange", () => {
      expect(confiancesApres(confiances, enBase, donnees, ["date_envoi", "plaque"])).toEqual({
        numero: "sur",
        plaque: "a_verifier",
        infraction_le: "non_lu",
      });
    });
  });
});

describe("fichier déposé", () => {
  it.each([
    [{ type: "application/pdf", name: "avis.pdf" }, "pdf"],
    [{ type: "image/jpeg", name: "avis.jpg" }, "jpeg"],
    [{ type: "image/png", name: "scan.png" }, "png"],
    [{ type: "image/heic", name: "IMG_0001.HEIC" }, "heic"],
    [{ type: "image/heif", name: "IMG_0001.heif" }, "heic"],
    [{ type: "", name: "IMG_0001.HEIC" }, "heic"],
    [{ type: "application/octet-stream", name: "photo.heic" }, "heic"],
    [{ type: "", name: "avis.JPEG" }, "jpeg"],
  ])("reconnaît %o : %s", (fichier, format) => {
    expect(typeFichier(fichier)).toBe(format);
  });

  it.each([
    { type: "text/plain", name: "notes.txt" },
    { type: "image/gif", name: "anim.gif" },
    { type: "text/plain", name: "deguise.pdf" },
    { type: "", name: "sans-extension" },
  ])("refuse %o", (fichier) => {
    expect(typeFichier(fichier)).toBeNull();
  });

  it("n'accepte qu'un fichier à la fois, d'un format accepté, de 10 Mo au plus", () => {
    const png = { type: "image/png", name: "avis.png", size: 1000 };
    expect(verifierDepot([png])).toEqual({ ok: true, format: "png" });
    expect(verifierDepot([png, png])).toEqual({ ok: false, erreur: MESSAGES_AVIS.unSeulFichier });
    expect(verifierDepot([{ type: "text/plain", name: "a.txt", size: 10 }])).toEqual({
      ok: false,
      erreur: MESSAGES_AVIS.formatRefuse,
    });
    expect(verifierDepot([{ ...png, size: TAILLE_MAX_FICHIER }])).toEqual({ ok: true, format: "png" });
    expect(verifierDepot([{ ...png, size: TAILLE_MAX_FICHIER + 1 }])).toEqual({
      ok: false,
      erreur: MESSAGES_AVIS.fichierTropLourd,
    });
  });
});

describe("estOuvert", () => {
  it("un avis « À traiter » ou « À valider » est ouvert ; désigné ou classé, il ne l'est plus", () => {
    expect(estOuvert("a_traiter")).toBe(true);
    expect(estOuvert("a_valider")).toBe(true);
    expect(estOuvert("designe")).toBe(false);
    expect(estOuvert("classe")).toBe(false);
  });
});
