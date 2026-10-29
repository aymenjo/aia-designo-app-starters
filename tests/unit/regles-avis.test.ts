import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LONGUEUR_MAX_TEXTE_AVIS,
  MESSAGES_AVIS,
  TAILLE_MAX_FICHIER,
  aLireALOuverture,
  champsAConfirmer,
  champsManquantsAvis,
  confiancesApres,
  estOuvert,
  lireMontant,
  normaliserNumeroAvis,
  plusFaible,
  refusAffectationManquante,
  refusClassement,
  refusReouverture,
  refusValidationConducteur,
  refusVehiculeDepuisAvis,
  schemaAvis,
  schemaClassement,
  statutDerive,
  typeFichier,
  validationPerimee,
  vehiculeInconnu,
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

describe("refusValidationConducteur", () => {
  const VEHICULE = "11111111-1111-4111-8111-111111111111";

  it("le conducteur se valide sur un avis « À valider » rattaché à un véhicule, et seulement là", () => {
    expect(refusValidationConducteur({ statut: "a_valider", vehicule_id: VEHICULE, verrouille: false, vehicule_lecture_seule: false })).toBeNull();
    expect(refusValidationConducteur({ statut: "a_valider", vehicule_id: null, verrouille: false, vehicule_lecture_seule: false })).toBe(
      MESSAGES_AVIS.validationSansVehicule,
    );
    for (const vehicule_id of [VEHICULE, null]) {
      expect(refusValidationConducteur({ statut: "a_traiter", vehicule_id, verrouille: false, vehicule_lecture_seule: false })).toBe(
        MESSAGES_AVIS.validationAvantVerification,
      );
    }
  });

  it("verrouillé (plan Free), son conducteur ne se valide pas avant le déverrouillage", () => {
    expect(refusValidationConducteur({ statut: "a_valider", vehicule_id: VEHICULE, verrouille: true, vehicule_lecture_seule: false })).toBe(
      MESSAGES_AVIS.verrouille,
    );
    // Désigné ou classé, le refus le plus précis l'emporte.
    expect(refusValidationConducteur({ statut: "classe", vehicule_id: VEHICULE, verrouille: true, vehicule_lecture_seule: false })).toBe(
      MESSAGES_AVIS.conducteurFige("classe"),
    );
  });

  it("bloqué par son véhicule en lecture seule (retour en Free), son conducteur ne se valide pas, même « À traiter »", () => {
    for (const statut of ["a_valider", "a_traiter"] as const) {
      expect(
        refusValidationConducteur({ statut, vehicule_id: VEHICULE, verrouille: false, vehicule_lecture_seule: true }),
      ).toBe(MESSAGES_AVIS.vehiculeLectureSeule);
    }
    expect(
      refusValidationConducteur({ statut: "classe", vehicule_id: VEHICULE, verrouille: false, vehicule_lecture_seule: true }),
    ).toBe(MESSAGES_AVIS.conducteurFige("classe"));
  });

  it("désigné ou classé, son conducteur ne change plus", () => {
    for (const vehicule_id of [VEHICULE, null]) {
      expect(refusValidationConducteur({ statut: "designe", vehicule_id, verrouille: false, vehicule_lecture_seule: false })).toBe(MESSAGES_AVIS.conducteurFige("designe"));
      expect(refusValidationConducteur({ statut: "classe", vehicule_id, verrouille: false, vehicule_lecture_seule: false })).toBe(MESSAGES_AVIS.conducteurFige("classe"));
    }
    expect(MESSAGES_AVIS.conducteurFige("designe")).toBe("Cet avis est désigné\u00a0: son conducteur ne change plus.");
  });
});

describe("cas dégradés de la proposition", () => {
  const VEHICULE = "11111111-1111-4111-8111-111111111111";
  const CONDUCTEUR = "22222222-2222-4222-8222-222222222222";
  const INCONNU = {
    statut: "a_valider",
    plaque: "AB-123-CD",
    vehicule_id: null,
    verrouille: false,
    vehicule_lecture_seule: false,
  } as const;

  it("le badge « Véhicule inconnu » : un avis ouvert, avec une plaque, sans véhicule", () => {
    expect(vehiculeInconnu(INCONNU)).toBe(true);
    expect(vehiculeInconnu({ ...INCONNU, statut: "a_traiter" })).toBe(true);
    expect(vehiculeInconnu({ ...INCONNU, statut: "designe" })).toBe(false);
    expect(vehiculeInconnu({ ...INCONNU, statut: "classe" })).toBe(false);
    expect(vehiculeInconnu({ ...INCONNU, plaque: null })).toBe(false);
    expect(vehiculeInconnu({ ...INCONNU, vehicule_id: VEHICULE })).toBe(false);
  });

  it("le véhicule se crée depuis un avis « À valider » sans véhicule, et seulement là", () => {
    expect(refusVehiculeDepuisAvis(INCONNU)).toBeNull();
    expect(refusVehiculeDepuisAvis({ ...INCONNU, statut: "a_traiter" })).toBe(MESSAGES_AVIS.vehiculeAvantVerification);
    expect(refusVehiculeDepuisAvis({ ...INCONNU, vehicule_id: VEHICULE })).toBe(MESSAGES_AVIS.vehiculeDejaRattache);
    expect(refusVehiculeDepuisAvis({ ...INCONNU, statut: "classe" })).toBe(MESSAGES_AVIS.vehiculeAvisFerme("classe"));
    expect(MESSAGES_AVIS.vehiculeAvisFerme("designe")).toBe(
      "Cet avis est désigné\u00a0: rouvrez-le pour créer son véhicule.",
    );
  });

  it("l'affectation manquante demande un conducteur validé, sur un avis dont le conducteur se valide", () => {
    const avis = {
      statut: "a_valider",
      vehicule_id: VEHICULE,
      conducteur_id: CONDUCTEUR,
      infraction_le: "2026-10-03T06:30:00+00:00",
      verrouille: false,
      vehicule_lecture_seule: false,
    } as const;
    expect(refusAffectationManquante(avis)).toBeNull();
    expect(refusAffectationManquante({ ...avis, conducteur_id: null })).toBe(MESSAGES_AVIS.affectationSansConducteur);
    expect(refusAffectationManquante({ ...avis, vehicule_id: null })).toBe(MESSAGES_AVIS.validationSansVehicule);
    expect(refusAffectationManquante({ ...avis, statut: "a_traiter" })).toBe(MESSAGES_AVIS.validationAvantVerification);
    expect(refusAffectationManquante({ ...avis, statut: "designe" })).toBe(MESSAGES_AVIS.conducteurFige("designe"));
  });

  it("un avis verrouillé (plan Free) ne crée pas de véhicule et n'enregistre pas d'affectation", () => {
    expect(refusVehiculeDepuisAvis({ ...INCONNU, verrouille: true, vehicule_lecture_seule: false })).toBe(MESSAGES_AVIS.verrouille);
    expect(
      refusAffectationManquante({
        statut: "a_valider",
        vehicule_id: VEHICULE,
        conducteur_id: CONDUCTEUR,
        infraction_le: "2026-10-03T06:30:00+00:00",
        verrouille: true,
        vehicule_lecture_seule: false,
      }),
    ).toBe(MESSAGES_AVIS.verrouille);
  });

  it("un avis bloqué par son véhicule en lecture seule (retour en Free) n'enregistre pas d'affectation", () => {
    expect(
      refusAffectationManquante({
        statut: "a_valider",
        vehicule_id: VEHICULE,
        conducteur_id: null,
        infraction_le: "2026-10-03T06:30:00+00:00",
        verrouille: false,
        vehicule_lecture_seule: true,
      }),
    ).toBe(MESSAGES_AVIS.vehiculeLectureSeule);
  });

  it("le message de l'affectation manquante nomme le conducteur validé", () => {
    expect(MESSAGES_AVIS.affectationManquante("Léa Martin")).toBe(
      "Le planning n'a pas d'affectation au moment de l'infraction\u00a0: enregistrez celle de Léa Martin pour le compléter.",
    );
  });
});

describe("validationPerimee", () => {
  const AVANT = { vehicule_id: "11111111-1111-4111-8111-111111111111", infraction_le: "2026-10-03T06:30:00+00:00" };

  it("un autre véhicule ou un autre instant d'infraction efface la validation", () => {
    expect(validationPerimee(AVANT, { ...AVANT, vehicule_id: "22222222-2222-4222-8222-222222222222" })).toBe(true);
    expect(validationPerimee(AVANT, { ...AVANT, vehicule_id: null })).toBe(true);
    expect(validationPerimee(AVANT, { ...AVANT, infraction_le: "2026-10-03T06:31:00Z" })).toBe(true);
    expect(validationPerimee(AVANT, { ...AVANT, infraction_le: null })).toBe(true);
  });

  it("le même instant écrit autrement, ou le même véhicule, garde la validation", () => {
    expect(validationPerimee(AVANT, { ...AVANT })).toBe(false);
    expect(validationPerimee(AVANT, { ...AVANT, infraction_le: "2026-10-03T06:30:00.000Z" })).toBe(false);
    expect(validationPerimee(AVANT, { ...AVANT, infraction_le: "2026-10-03T08:30:00+02:00" })).toBe(false);
    expect(validationPerimee({ vehicule_id: null, infraction_le: null }, { vehicule_id: null, infraction_le: null })).toBe(
      false,
    );
  });
});

describe("schemaClassement", () => {
  const erreurs = (saisie: Record<string, string | null>) => {
    const valide = schemaClassement.safeParse(saisie);
    return valide.success ? {} : Object.fromEntries(valide.error.issues.map((issue) => [issue.path[0], issue.message]));
  };

  it("un motif de la liste suffit, sans texte libre", () => {
    expect(schemaClassement.parse({ motif: "conteste" })).toEqual({ motif_classement: "conteste", motif_libre: null });
    expect(schemaClassement.parse({ motif: "vol_usurpation", motif_libre: "" })).toEqual({
      motif_classement: "vol_usurpation",
      motif_libre: null,
    });
  });

  it("le motif est requis, et doit être l'un des motifs proposés", () => {
    for (const motif of [undefined, null, "", "  ", "perdu", "CONTESTE"]) {
      expect(erreurs({ motif: motif ?? null })).toEqual({ motif: MESSAGES_AVIS.motifVide });
    }
  });

  it("« Autre » demande le motif en toutes lettres, rogné", () => {
    expect(erreurs({ motif: "autre" })).toEqual({ motif_libre: MESSAGES_AVIS.motifLibreVide });
    expect(erreurs({ motif: "autre", motif_libre: "   " })).toEqual({ motif_libre: MESSAGES_AVIS.motifLibreVide });
    expect(schemaClassement.parse({ motif: "autre", motif_libre: "  Déposé deux fois  " })).toEqual({
      motif_classement: "autre",
      motif_libre: "Déposé deux fois",
    });
  });

  it("le texte saisi sous « Autre » est ignoré pour un autre motif", () => {
    expect(schemaClassement.parse({ motif: "non_soumis", motif_libre: "Stationnement" })).toEqual({
      motif_classement: "non_soumis",
      motif_libre: null,
    });
  });

  it(`le texte libre fait ${LONGUEUR_MAX_TEXTE_AVIS} caractères au plus`, () => {
    const max = "a".repeat(LONGUEUR_MAX_TEXTE_AVIS);
    expect(schemaClassement.parse({ motif: "autre", motif_libre: max }).motif_libre).toBe(max);
    expect(erreurs({ motif: "autre", motif_libre: `${max}a` })).toEqual({
      motif_libre: MESSAGES_AVIS.tropLong(LONGUEUR_MAX_TEXTE_AVIS),
    });
  });
});

describe("refusClassement et refusReouverture", () => {
  it("un avis se classe depuis tout statut, sauf s'il l'est déjà", () => {
    for (const statut of ["a_traiter", "a_valider", "designe"] as const) expect(refusClassement({ statut })).toBeNull();
    expect(refusClassement({ statut: "classe" })).toBe(MESSAGES_AVIS.dejaClasse);
  });

  it("seul un avis désigné ou classé se rouvre", () => {
    expect(refusReouverture({ statut: "designe" })).toBeNull();
    expect(refusReouverture({ statut: "classe" })).toBeNull();
    for (const statut of ["a_traiter", "a_valider"] as const) {
      expect(refusReouverture({ statut })).toBe(MESSAGES_AVIS.dejaOuvert);
    }
    expect(MESSAGES_AVIS.dejaOuvert).toBe("Cet avis est déjà ouvert\u00a0: il n'y a rien à rouvrir.");
  });
});

describe("aLireALOuverture", () => {
  const DEVERROUILLE = {
    statut: "a_traiter",
    source: "depot",
    verrouille: false,
    deverrouille_le: "2026-11-01T00:30:00Z",
    lecture_ia: null,
  } as const;
  const RELEVE = { ...DEVERROUILLE, source: "gmail", deverrouille_le: null } as const;

  it("un avis déverrouillé, jamais lu, encore « À traiter », se lit à son ouverture", () => {
    expect(aLireALOuverture(DEVERROUILLE)).toBe(true);
  });

  it("un avis relevé dans Gmail, jamais lu, encore « À traiter », se lit aussi à son ouverture", () => {
    expect(aLireALOuverture(RELEVE)).toBe(true);
    expect(aLireALOuverture({ ...RELEVE, lecture_ia: "lue" })).toBe(false);
    expect(aLireALOuverture({ ...RELEVE, verrouille: true })).toBe(false);
  });

  it("pas un avis encore verrouillé, déjà lu, déposé sans verrouillage, ou déjà vérifié", () => {
    expect(aLireALOuverture({ ...DEVERROUILLE, verrouille: true, deverrouille_le: null })).toBe(false);
    expect(aLireALOuverture({ ...DEVERROUILLE, lecture_ia: "echec" })).toBe(false);
    expect(aLireALOuverture({ ...DEVERROUILLE, deverrouille_le: null })).toBe(false);
    expect(aLireALOuverture({ ...DEVERROUILLE, statut: "a_valider" })).toBe(false);
  });
});
