import { describe, expect, it } from "vitest";
import { noteRecapitulatifs } from "@/lib/agent/regles";
import { instantParis } from "@/lib/dates";
import { MESSAGES } from "@/lib/flotte/regles";
import {
  MESSAGES_RECAPITULATIF,
  ciblesDe,
  ciblesDesEntrees,
  decrireLigne,
  designationLigne,
  estImpossible,
  lignesImpossibles,
  preparerRecapitulatif,
  revaliderRecapitulatif,
  texteLigne,
  texteStatut,
  type ConducteurInstantane,
  type EntreeModification,
  type Instantane,
  type LigneRecapitulatif,
} from "@/lib/flotte/regles-recapitulatif";

// Le récapitulatif de modifications (phase 29) : chaque ligne passe par les règles des écrans, sur la flotte simulée
// après les lignes précédentes, et garde le message exact des écrans. Phase 30 : une ligne que ces règles refusent est
// enregistrée en rouge, avec ce message ; une proposition mal formée par l'agent est refusée en entier.

const id = (n: number) => `6a7b8c9d-0e1f-4a2b-9c3d-${String(n).padStart(12, "0")}`;
const V = id(1); // AB-123-CD, attitré, conduit par Karim
const POOL = id(2); // MN-345-PQ, pool
const ARCHIVE_V = id(3); // ZZ-999-ZZ, archivé
const KARIM = id(11);
const LEA = id(12);
const PAUL = id(13); // archivé
const A = id(21); // Karim sur AB-123-CD, depuis le 01/09/2025 08:00, sans fin
const CLOSE = id(22); // une affectation déjà clôturée sur le pool

const ARCHIVE = "2026-09-30T08:00:00Z";
const DEBUT_A = "2025-09-01T06:00:00.000Z";

const fiche = (champs: Partial<ConducteurInstantane> & Pick<ConducteurInstantane, "id" | "prenom" | "nom">): ConducteurInstantane => ({
  civilite: null,
  date_naissance: null,
  lieu_naissance: null,
  adresse: null,
  adresse_complement: null,
  code_postal: null,
  ville: null,
  permis_numero: null,
  permis_delivre_le: null,
  permis_categories: null,
  email: null,
  archive_le: null,
  ...champs,
});

const flotte = (): Instantane => ({
  vehicules: [
    { id: V, plaque: "AB-123-CD", modele: "Renault Master", type: "attitre", archive_le: null, lecture_seule_le: null },
    { id: POOL, plaque: "MN-345-PQ", modele: null, type: "pool", archive_le: null, lecture_seule_le: null },
    { id: ARCHIVE_V, plaque: "ZZ-999-ZZ", modele: null, type: "attitre", archive_le: ARCHIVE, lecture_seule_le: null },
  ],
  conducteurs: [
    fiche({ id: KARIM, prenom: "Karim", nom: "Benali", permis_numero: "120345678901", email: "karim@exemple.fr" }),
    fiche({ id: LEA, prenom: "Léa", nom: "Moreau", civilite: "mme", date_naissance: "1990-04-02", permis_categories: ["B"] }),
    fiche({ id: PAUL, prenom: "Paul", nom: "Ancien", permis_numero: "ARCH1", email: "paul@exemple.fr", archive_le: ARCHIVE }),
  ],
  affectations: [
    { id: A, vehicule_id: V, conducteur_id: KARIM, debut: DEBUT_A, fin: null },
    { id: CLOSE, vehicule_id: POOL, conducteur_id: LEA, debut: "2026-10-14T06:00:00Z", fin: "2026-10-14T16:00:00Z" },
  ],
});

const KARIM_PART: EntreeModification[] = [
  { operation: "cloturer_affectation", affectation_id: A, fin_date: "2026-11-06" },
  { operation: "creer_affectation", vehicule: { id: V }, conducteur: { id: LEA }, debut_date: "2026-11-07" },
  { operation: "archiver_conducteur", conducteur_id: KARIM },
];

function preparer(entrees: EntreeModification[], instantane = flotte()) {
  return preparerRecapitulatif(instantane, entrees);
}

/** Les lignes d'un récapitulatif sans ligne rouge ni ligne mal formée. */
function lignes(entrees: EntreeModification[], instantane = flotte()): LigneRecapitulatif[] {
  const resultat = preparer(entrees, instantane);
  if (!resultat.ok) throw new Error(JSON.stringify(resultat.motifs));
  const rouges = lignesImpossibles(resultat.lignes);
  if (rouges.length) throw new Error(JSON.stringify(rouges));
  return resultat.lignes;
}

/** Les lignes d'un récapitulatif enregistré, rouges comprises. */
function enregistrees(entrees: EntreeModification[], instantane = flotte()): LigneRecapitulatif[] {
  const resultat = preparer(entrees, instantane);
  if (!resultat.ok) throw new Error(JSON.stringify(resultat.motifs));
  return resultat.lignes;
}

/** Le motif des lignes rouges d'un récapitulatif enregistré. */
const rouges = (entrees: EntreeModification[]) => lignesImpossibles(enregistrees(entrees));

describe("« Karim part vendredi, passe son camion à Léa »", () => {
  it("donne une clôture, une nouvelle affectation bout à bout et un archivage, avec les libellés de la maquette", () => {
    const recap = lignes(KARIM_PART);
    expect(recap.map(texteLigne)).toEqual([
      "Clôturer l'affectation de Karim B. sur AB-123-CD · Fin : sans fin → 07/11/2026 00:00",
      "Créer une affectation pour Léa M. sur AB-123-CD · Début : 07/11/2026 00:00 · sans fin · attitré",
      "Archiver la fiche de Karim B. · Actif → Archivé",
    ]);
    // Un jour sans heure vaut la journée entière : la fin et le début se touchent, le samedi à 00:00 à Paris.
    const samedi = instantParis("2026-11-07", "00:00");
    expect(recap[0]).toMatchObject({ operation: "cloturer_affectation", cible: A, avant: { fin: null }, apres: { fin: samedi } });
    expect(recap[1]).toMatchObject({
      operation: "creer_affectation",
      apres: { vehicule_id: { id: V }, conducteur_id: { id: LEA }, debut: samedi, fin: null },
    });
    expect(recap[2]).toMatchObject({ operation: "archiver_conducteur", cible: KARIM });
  });

  it("dans le désordre, enregistre la ligne en rouge avec le message de conflit des écrans, sans avant ni après", () => {
    const recap = enregistrees([KARIM_PART[1], KARIM_PART[0], KARIM_PART[2]]);
    const conflit = MESSAGES.conflitAffectation("Karim B.", "AB-123-CD", DEBUT_A, null);
    expect(lignesImpossibles(recap)).toEqual([{ ligne: 1, motif: conflit }]);
    expect(recap[0]).toEqual({
      operation: "creer_affectation",
      affichage: {
        vehicule: { ref: { id: V }, plaque: "AB-123-CD", type: "attitre" },
        conducteur: { ref: { id: LEA }, nom: "Léa M." },
      },
      refus: conflit,
    });
    // La ligne rouge n'entre pas dans la flotte simulée : la clôture puis l'archivage passent.
    expect(recap.slice(1).map(estImpossible)).toEqual([false, false]);
  });

  it("sans clôture, enregistre en rouge l'archivage de Karim, qui a encore une affectation ouverte", () => {
    const [ligne] = enregistrees([KARIM_PART[2]]);
    expect(ligne).toMatchObject({
      operation: "archiver_conducteur",
      cible: KARIM,
      refus: MESSAGES.affectationEnCours("Karim B.", "AB-123-CD"),
    });
  });

  it("ne laisse viser un même élément que par une seule ligne", () => {
    const resultat = preparer([KARIM_PART[0], { operation: "cloturer_affectation", affectation_id: A, fin_date: "2026-11-08" }]);
    expect(resultat).toEqual({ ok: false, motifs: [{ ligne: 2, motif: MESSAGES_RECAPITULATIF.uneLigneParElement(1) }] });
  });
});

describe("les références à une ligne précédente", () => {
  const creerVehicule: EntreeModification = { operation: "creer_vehicule", plaque: "gh 789 jk", type: "attitre" };

  it("affectent le véhicule créé par la ligne 1", () => {
    const recap = lignes([
      creerVehicule,
      { operation: "creer_affectation", vehicule: { ligne: 1 }, conducteur: { id: LEA }, debut_date: "2026-11-09", debut_heure: "08:00" },
    ]);
    expect(recap[0]).toMatchObject({ apres: { plaque: "GH-789-JK", modele: null, type: "attitre" } });
    expect(recap[1]).toMatchObject({ apres: { vehicule_id: { ligne: 1 }, conducteur_id: { id: LEA } } });
    expect(texteLigne(recap[1])).toBe("Créer une affectation pour Léa M. sur GH-789-JK · Début : 09/11/2026 08:00 · sans fin · attitré");
    expect(decrireLigne(recap[1]).quoi[3]).toEqual({ plaque: "GH-789-JK", ref: { ligne: 1 } });
  });

  it("refusent une ligne qui ne crée pas l'élément, ou qui vient après", () => {
    const affecter = (ligne: number): EntreeModification => ({
      operation: "creer_affectation",
      vehicule: { ligne },
      conducteur: { id: LEA },
      debut_date: "2026-11-09",
    });
    expect(preparer([affecter(2), creerVehicule])).toMatchObject({
      motifs: [{ ligne: 1, motif: MESSAGES_RECAPITULATIF.referenceInvalide(2, "vehicule") }],
    });
    expect(preparer([{ operation: "creer_conducteur", prenom: "Inès", nom: "Garnier" }, affecter(1)])).toMatchObject({
      motifs: [{ ligne: 2, motif: MESSAGES_RECAPITULATIF.referenceInvalide(1, "vehicule") }],
    });
  });

  it("rendent rouge une ligne qui dépend d'une ligne rouge, en nommant ce que celle-ci aurait créé", () => {
    const recap = enregistrees([
      { operation: "creer_vehicule", plaque: "AB 123", type: "attitre" },
      { operation: "creer_affectation", vehicule: { ligne: 1 }, conducteur: { id: LEA }, debut_date: "2026-11-09" },
    ]);
    expect(lignesImpossibles(recap)).toEqual([
      { ligne: 1, motif: MESSAGES.plaqueMalFormee },
      { ligne: 2, motif: MESSAGES_RECAPITULATIF.dependDeLigne(1) },
    ]);
    // La plaque refusée par son schéma est affichée telle que saisie, en majuscules.
    expect(recap.map(texteLigne)).toEqual([
      `Ajouter le véhicule AB 123 · Impossible : ${MESSAGES.plaqueMalFormee}`,
      `Créer une affectation pour Léa M. sur AB 123 · Impossible : ${MESSAGES_RECAPITULATIF.dependDeLigne(1)}`,
    ]);
    expect(decrireLigne(recap[1]).quoi[3]).toEqual({ plaque: "AB 123", ref: { ligne: 1 } });
  });
});

describe("les règles des écrans", () => {
  /** Le motif de la ligne : rouge, ou mal formée. */
  const motif = (entree: EntreeModification) => {
    const resultat = preparer([entree]);
    return resultat.ok ? (lignesImpossibles(resultat.lignes)[0]?.motif ?? null) : resultat.motifs[0].motif;
  };

  it("refusent une plaque déjà présente ou archivée, comme l'écran Véhicules", () => {
    expect(motif({ operation: "creer_vehicule", plaque: "ab-123-cd", type: "pool" })).toBe(MESSAGES.plaqueDejaPresente("AB-123-CD"));
    expect(motif({ operation: "creer_vehicule", plaque: "ZZ999ZZ", type: "pool" })).toBe(MESSAGES.plaqueArchivee("ZZ-999-ZZ"));
    expect(motif({ operation: "modifier_vehicule", vehicule_id: POOL, plaque: "AB-123-CD" })).toBe(
      MESSAGES.plaqueDejaPresente("AB-123-CD"),
    );
  });

  it("refusent un permis ou un email déjà présent, ou d'un conducteur archivé, comme la fiche conducteur", () => {
    expect(motif({ operation: "creer_conducteur", prenom: "K", nom: "B", permis_numero: "1203 4567 8901" })).toBe(
      MESSAGES.permisDejaPresent("Karim Benali"),
    );
    expect(motif({ operation: "creer_conducteur", prenom: "P", nom: "A", email: "Paul@Exemple.fr" })).toBe(
      MESSAGES.emailArchive("Paul Ancien"),
    );
    expect(motif({ operation: "modifier_conducteur", conducteur_id: LEA, permis_numero: "ARCH1" })).toBe(
      MESSAGES.permisArchive("Paul Ancien"),
    );
  });

  it("exigent une fin sur un véhicule de pool, et refusent une fin avant le début", () => {
    const pool = { operation: "creer_affectation", vehicule: { id: POOL }, conducteur: { id: LEA }, debut_date: "2026-11-09" } as const;
    expect(motif(pool)).toBe(MESSAGES.finPoolObligatoire);
    expect(motif({ ...pool, fin_date: "2026-11-09", debut_heure: "18:00", fin_heure: "08:00" })).toBe(MESSAGES.finAvantDebut);
    expect(lignes([{ ...pool, debut_heure: "08:00", fin_date: "2026-11-09", fin_heure: "18:00" }])).toHaveLength(1);
  });

  it("refusent le passage en pool d'un véhicule qui a une affectation ouverte, sauf une fois clôturée", () => {
    const enPool: EntreeModification = { operation: "modifier_vehicule", vehicule_id: V, type: "pool" };
    expect(motif(enPool)).toBe(MESSAGES.poolAvecAffectationOuverte("Karim B."));
    expect(lignes([KARIM_PART[0], enPool])).toHaveLength(2);
  });

  it("refusent de reclôturer, d'affecter un conducteur archivé et de modifier une fiche archivée", () => {
    expect(motif({ operation: "cloturer_affectation", affectation_id: CLOSE, fin_date: "2026-11-09" })).toBe(
      MESSAGES.affectationDejaCloturee,
    );
    expect(motif({ operation: "creer_affectation", vehicule: { id: POOL }, conducteur: { id: PAUL }, debut_date: "2026-11-09", fin_date: "2026-11-09" })).toBe(
      MESSAGES.conducteurArchiveAffectation("Paul Ancien"),
    );
    expect(motif({ operation: "modifier_vehicule", vehicule_id: ARCHIVE_V, modele: "Iveco Daily" })).toBe(
      MESSAGES.vehiculeArchiveModification("ZZ-999-ZZ"),
    );
    expect(motif({ operation: "archiver_conducteur", conducteur_id: PAUL })).toBe(MESSAGES.conducteurDejaArchive("Paul Ancien"));
  });

  it("refusent un élément introuvable, et une modification qui ne change rien, sans rien enregistrer", () => {
    expect(preparer([{ operation: "archiver_vehicule", vehicule_id: id(99) }])).toEqual({
      ok: false,
      motifs: [{ ligne: 1, motif: MESSAGES.vehiculeIntrouvable }],
    });
    expect(preparer([{ operation: "modifier_vehicule", vehicule_id: V, modele: "Renault Master" }])).toEqual({
      ok: false,
      motifs: [{ ligne: 1, motif: MESSAGES_RECAPITULATIF.rienAModifier }],
    });
  });

  it("ne gardent que les champs modifiés d'une fiche, tels que lus et tels qu'écrits", () => {
    const [ligne] = lignes([
      { operation: "modifier_conducteur", conducteur_id: LEA, email: "Lea.Moreau@Exemple.fr", permis_categories: "c1, b", civilite: "mme" },
    ]);
    expect(ligne).toMatchObject({
      avant: { email: null, permis_categories: ["B"] },
      apres: { email: "lea.moreau@exemple.fr", permis_categories: ["B", "C1"] },
    });
    expect(texteLigne(ligne)).toBe(
      "Modifier la fiche de Léa M. · Catégories de permis : B → B, C1 · Email : — → lea.moreau@exemple.fr",
    );
  });

  it("modifient une affectation : son conducteur et sa fin, avec l'avant et l'après", () => {
    const [ligne] = lignes([{ operation: "modifier_affectation", affectation_id: A, conducteur: { id: LEA }, fin_date: "2026-12-31", fin_heure: "18:00" }]);
    expect(ligne).toMatchObject({
      avant: { conducteur_id: KARIM, fin: null },
      apres: { conducteur_id: { id: LEA }, fin: instantParis("2026-12-31", "18:00") },
      affichage: { conducteur: { nom: "Karim B." }, apres: { conducteur: { nom: "Léa M." } } },
    });
    expect(texteLigne(ligne)).toBe(
      "Modifier l'affectation de Karim B. sur AB-123-CD · Conducteur : Karim B. → Léa M. · Fin : sans fin → 31/12/2026 18:00",
    );
  });
});

describe("les lignes rouges et les propositions mal formées (phase 30)", () => {
  it("refusent tout, sans rien enregistrer, quand une ligne est mal formée, même à côté d'une ligne rouge", () => {
    expect(preparer([KARIM_PART[2], { operation: "archiver_vehicule", vehicule_id: id(99) }])).toEqual({
      ok: false,
      motifs: [{ ligne: 2, motif: MESSAGES.vehiculeIntrouvable }],
    });
  });

  it("voient une erreur mal formée cachée derrière une ligne rouge", () => {
    expect(
      preparer([
        { operation: "creer_vehicule", plaque: "AB 123", type: "attitre" },
        { operation: "creer_affectation", vehicule: { ligne: 1 }, conducteur: { id: id(99) }, debut_date: "2026-11-09" },
      ]),
    ).toEqual({ ok: false, motifs: [{ ligne: 2, motif: MESSAGES.conducteurIntrouvable }] });
    // Une affectation de Paul, archivé : la règle des écrans la refuse avant de lire le nouveau conducteur, inconnu.
    const avecPaul = flotte();
    const dePaul = { id: id(23), vehicule_id: POOL, conducteur_id: PAUL, debut: "2026-09-01T06:00:00Z", fin: "2026-09-01T16:00:00Z" };
    avecPaul.affectations = [...avecPaul.affectations, dePaul];
    const reaffecter = (conducteur: { id: string }): EntreeModification => ({ operation: "modifier_affectation", affectation_id: dePaul.id, conducteur });
    expect(preparer([reaffecter({ id: LEA })], avecPaul)).toMatchObject({ ok: true, lignes: [{ refus: MESSAGES.affectationArchivee }] });
    expect(preparer([reaffecter({ id: id(98) })], avecPaul)).toEqual({
      ok: false,
      motifs: [{ ligne: 1, motif: MESSAGES.conducteurIntrouvable }],
    });
  });

  it("gardent rouge ce qui suit une clôture rouge : l'affectation reste ouverte", () => {
    expect(
      rouges([
        { operation: "cloturer_affectation", affectation_id: A, fin_date: "2025-08-01" },
        { operation: "archiver_conducteur", conducteur_id: KARIM },
      ]),
    ).toEqual([
      { ligne: 1, motif: MESSAGES.finAvantDebut },
      { ligne: 2, motif: MESSAGES.affectationEnCours("Karim B.", "AB-123-CD") },
    ]);
  });

  it("nomment au mieux les éléments d'une ligne que son schéma refuse", () => {
    const [affectation, fiche] = enregistrees([
      { operation: "creer_affectation", vehicule: { id: POOL }, conducteur: { id: LEA }, debut_date: "2026-11-09" },
      { operation: "creer_conducteur", prenom: " Inès ", nom: "garnier", code_postal: "75" },
    ]);
    expect(affectation).toEqual({
      operation: "creer_affectation",
      affichage: {
        vehicule: { ref: { id: POOL }, plaque: "MN-345-PQ", type: "pool" },
        conducteur: { ref: { id: LEA }, nom: "Léa M." },
      },
      refus: MESSAGES.finPoolObligatoire,
    });
    expect(decrireLigne(affectation)).toEqual({
      quoi: [
        { texte: "Créer une affectation pour " },
        { conducteur: "Léa M.", ref: { id: LEA } },
        { texte: " sur " },
        { plaque: "MN-345-PQ", ref: { id: POOL } },
      ],
      details: [],
      refus: MESSAGES.finPoolObligatoire,
    });
    expect(fiche).toMatchObject({ affichage: { conducteur: { ref: { ligne: 2 }, nom: "Inès G." } }, refus: MESSAGES.codePostalMalForme });
    expect(texteLigne(fiche)).toBe(`Ajouter la fiche de Inès G. · Impossible : ${MESSAGES.codePostalMalForme}`);
  });

  it("gardent la cible d'une ligne rouge qui vise un élément existant", () => {
    const [ligne] = enregistrees([{ operation: "modifier_vehicule", vehicule_id: ARCHIVE_V, modele: "Iveco Daily" }]);
    expect(ligne).toEqual({
      operation: "modifier_vehicule",
      cible: ARCHIVE_V,
      affichage: { vehicule: { ref: { id: ARCHIVE_V }, plaque: "ZZ-999-ZZ", type: "attitre" } },
      refus: MESSAGES.vehiculeArchiveModification("ZZ-999-ZZ"),
    });
    expect(ciblesDe([ligne])).toEqual({ vehicules: [ARCHIVE_V], conducteurs: [], affectations: [] });
  });

  it("ne passent jamais « Confirmer » : la revérification refuse une ligne rouge stockée", () => {
    const recap = enregistrees([KARIM_PART[2], { operation: "modifier_vehicule", vehicule_id: POOL, modele: "Iveco Daily" }]);
    expect(revaliderRecapitulatif(flotte(), recap)).toEqual({
      ok: false,
      motifs: [{ ligne: 1, motif: MESSAGES.affectationEnCours("Karim B.", "AB-123-CD") }],
    });
  });
});

describe("« Confirmer » sur la flotte du moment", () => {
  it("revalide un récapitulatif dont la flotte n'a pas changé, même si les instants sont écrits « +00:00 »", () => {
    const recap = lignes(KARIM_PART);
    const relue = flotte();
    relue.affectations = relue.affectations.map((a) => (a.id === A ? { ...a, debut: "2025-09-01T06:00:00+00:00" } : a));
    expect(revaliderRecapitulatif(relue, recap)).toEqual({ ok: true, lignes: recap });
  });

  it("refuse une ligne dont l'« avant » a changé entre-temps", () => {
    const recap = lignes(KARIM_PART);
    const relue = flotte();
    relue.affectations = relue.affectations.map((a) => (a.id === A ? { ...a, fin: "2026-11-20T17:00:00Z" } : a));
    // La ligne 2 en découle : l'affectation de Karim, qui n'est plus clôturée, chevauche celle de Léa.
    expect(revaliderRecapitulatif(relue, recap)).toEqual({
      ok: false,
      motifs: [
        { ligne: 1, motif: MESSAGES_RECAPITULATIF.aChange("L'affectation de Karim B. sur AB-123-CD") },
        { ligne: 2, motif: MESSAGES.conflitAffectation("Karim B.", "AB-123-CD", DEBUT_A, "2026-11-20T17:00:00Z") },
      ],
    });
    expect(designationLigne(recap[2])).toBe("La fiche de Karim B.");
  });

  it("refuse un élément disparu, et un conflit né d'une écriture entre-temps", () => {
    const recap = lignes(KARIM_PART);
    const sansKarim = flotte();
    sansKarim.conducteurs = sansKarim.conducteurs.filter((c) => c.id !== KARIM);
    expect(revaliderRecapitulatif(sansKarim, recap)).toMatchObject({ ok: false, motifs: [{ ligne: 3, motif: MESSAGES.conducteurIntrouvable }] });

    const avecConflit = flotte();
    const inès = { id: id(30), vehicule_id: V, conducteur_id: LEA, debut: "2026-11-07T07:00:00Z", fin: "2026-11-07T16:00:00Z" };
    avecConflit.affectations = [...avecConflit.affectations, inès];
    expect(revaliderRecapitulatif(avecConflit, recap)).toEqual({
      ok: false,
      motifs: [{ ligne: 2, motif: MESSAGES.conflitAffectation("Léa M.", "AB-123-CD", inès.debut, inès.fin) }],
    });
  });

  it("lit les éléments visés et nommés par les lignes", () => {
    expect(ciblesDesEntrees(KARIM_PART)).toEqual({ vehicules: [V], conducteurs: [LEA, KARIM], affectations: [A] });
    expect(ciblesDe(lignes(KARIM_PART))).toEqual({ vehicules: [V], conducteurs: [KARIM, LEA], affectations: [A] });
  });
});

describe("le sort du récapitulatif", () => {
  it("s'affiche sous ses lignes", () => {
    expect(texteStatut({ statut: "propose", applique_le: null })).toBeNull();
    expect(texteStatut({ statut: "applique", applique_le: "2026-11-02T09:15:00Z" })).toBe("Appliqué le 02/11/2026 à 10:15");
    expect(texteStatut({ statut: "annule", applique_le: null })).toBe(MESSAGES_RECAPITULATIF.annule);
    // « Modifier » (phase 30) : le récapitulatif corrigé.
    expect(texteStatut({ statut: "remplace", applique_le: null })).toBe("Remplacé\u00a0: rien n'a été modifié.");
  });

  it("est signalé à l'agent avec la demande suivante, et rien quand il n'y a rien à dire", () => {
    expect(noteRecapitulatifs([])).toBeNull();
    expect(
      noteRecapitulatifs([
        { id: "a", statut: "applique", applique_le: "2026-11-02T09:15:00Z" },
        { id: "b", statut: "annule", applique_le: null },
      ]),
    ).toBe(
      "Le gestionnaire a confirmé le récapitulatif que tu as proposé : ses modifications sont appliquées depuis le 02/11/2026 à 10:15. " +
        "Le gestionnaire a annulé le récapitulatif que tu as proposé : rien n'a été modifié.",
    );
  });

  it("dit « Rien n'a été appliqué » avec le motif de chaque ligne", () => {
    expect(MESSAGES_RECAPITULATIF.rienApplique([{ ligne: 2, motif: "Conflit." }])).toBe("Rien n'a été appliqué. Ligne 2\u00a0: Conflit.");
  });
});
