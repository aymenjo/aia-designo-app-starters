import { describe, expect, it } from "vitest";
import { MESSAGES } from "@/lib/flotte/regles";
import {
  COLONNES,
  LIGNES_MAX,
  MESSAGES_IMPORT,
  TAILLE_MAX_IMPORT,
  analyserImport,
  ecrireModele,
  lireFichier,
  verifierDepotImport,
  type Existants,
  type FichierAnalyse,
  type FichierLu,
  type LigneConducteur,
  type LigneVehicule,
} from "@/lib/flotte/regles-import";

const AUJOURDHUI = "2026-10-14";
const ARCHIVE_LE = "2026-01-05T09:00:00.000Z";

const lire = (texte: string, nom = "flotte.csv") => lireFichier(nom, new TextEncoder().encode(texte));
const csv = (...lignes: string[]) => lignes.join("\r\n");

const EXISTANTS: Existants = {
  vehicules: [
    { id: "v-actif", plaque: "AB-123-CD", archive_le: null },
    { id: "v-archive", plaque: "EF-456-GH", archive_le: ARCHIVE_LE },
  ],
  conducteurs: [
    { id: "c-karim", prenom: "Karim", nom: "Benali", permis_numero: "120569300123", email: "karim@exemple.fr", archive_le: null },
    { id: "c-lea", prenom: "Léa", nom: "Martin", permis_numero: "LM42", email: "lea@exemple.fr", archive_le: ARCHIVE_LE },
    { id: "c-paul", prenom: "Paul", nom: "Durand", permis_numero: null, email: null, archive_le: null },
  ],
};

function analyser(fichiers: FichierLu[], existants = EXISTANTS) {
  return analyserImport(fichiers, existants, AUJOURDHUI);
}

function lignes<T extends "vehicules" | "conducteurs">(fichier: FichierAnalyse | undefined, type: T) {
  if (fichier?.type !== type) throw new Error(`fichier ${type} attendu : ${JSON.stringify(fichier)}`);
  return fichier.lignes as T extends "vehicules" ? LigneVehicule[] : LigneConducteur[];
}

/** Analyse un fichier véhicules (et un fichier conducteurs) et renvoie les lignes du premier. */
function vehicules(texte: string, conducteurs?: string, existants = EXISTANTS) {
  const fichiers = [lire(texte, "vehicules.csv"), ...(conducteurs ? [lire(conducteurs, "conducteurs.csv")] : [])];
  const resultat = analyser(fichiers, existants);
  return { ...resultat, lignes: lignes(resultat.analyse.fichiers[0], "vehicules") };
}

function conducteurs(texte: string, existants = EXISTANTS) {
  const resultat = analyser([lire(texte, "conducteurs.csv")], existants);
  return { ...resultat, lignes: lignes(resultat.analyse.fichiers[0], "conducteurs") };
}

const V = "Plaque;Modèle;Type;Conducteur attitré;Attitré depuis le";
const C = "Prénom;Nom;N° de permis;Email";

describe("verifierDepotImport", () => {
  const fichier = (name: string, size = 100) => ({ name, size });

  it("accepte 1 ou 2 fichiers .csv ou .txt, quel que soit leur type MIME", () => {
    expect(verifierDepotImport([fichier("vehicules.csv")])).toEqual({ ok: true });
    expect(verifierDepotImport([fichier("Véhicules.CSV"), fichier("conducteurs.txt")])).toEqual({ ok: true });
  });

  it.each([
    ["aucun fichier", [], MESSAGES_IMPORT.aucunFichier],
    ["3 fichiers", [fichier("a.csv"), fichier("b.csv"), fichier("c.csv")], MESSAGES_IMPORT.tropDeFichiers],
    ["un classeur Excel", [fichier("a.csv"), fichier("flotte.xlsx")], MESSAGES_IMPORT.formatNonCsv("flotte.xlsx")],
    [
      "des fichiers trop lourds",
      [fichier("a.csv", TAILLE_MAX_IMPORT), fichier("b.csv", 1)],
      MESSAGES_IMPORT.fichiersTropLourds,
    ],
  ])("refuse %s", (_cas, fichiers, erreur) => {
    expect(verifierDepotImport(fichiers)).toEqual({ ok: false, erreur });
  });
});

describe("ecrireModele", () => {
  it("écrit la ligne d'en-têtes, avec un BOM", () => {
    expect(ecrireModele("vehicules")).toBe(`﻿${V}\r\n`);
    expect(ecrireModele("conducteurs").split(";")).toHaveLength(COLONNES.conducteurs.length);
  });

  it.each(["vehicules", "conducteurs"] as const)("le modèle %s se réimporte tel quel, sans aucune ligne", (type) => {
    expect(lireFichier("modele.csv", new TextEncoder().encode(ecrireModele(type)))).toEqual({
      nom: "modele.csv",
      type,
      colonnesIgnorees: [],
      lignes: [],
    });
  });
});

describe("lireFichier", () => {
  it("reconnaît les en-têtes sans tenir compte de la casse, des accents ni de la ponctuation, et quelques alias", () => {
    expect(lire(csv("IMMATRICULATION;modele;type*", "ab 123 cd;Master;Pool"))).toMatchObject({
      type: "vehicules",
      lignes: [{ ligne: 2, valeurs: { plaque: "ab 123 cd", modele: "Master", type: "Pool" } }],
    });
    expect(lire(csv("prenom;NOM;E-mail;Numéro de permis", "Karim;Benali;k@exemple.fr;123"))).toMatchObject({
      type: "conducteurs",
      lignes: [{ valeurs: { prenom: "Karim", nom: "Benali", email: "k@exemple.fr", permis_numero: "123" } }],
    });
  });

  it("lit aussi un fichier séparé par des virgules", () => {
    expect(lire(csv("Plaque,Modèle,Type", 'AB-123-CD,"Master, L2H2",Pool'))).toMatchObject({
      type: "vehicules",
      lignes: [{ valeurs: { plaque: "AB-123-CD", modele: "Master, L2H2", type: "Pool" } }],
    });
  });

  it("signale les colonnes obligatoires manquantes", () => {
    expect(lire(csv("Plaque;Modèle", "AB-123-CD;Master"))).toEqual({
      nom: "flotte.csv",
      type: null,
      erreur: MESSAGES_IMPORT.colonnesManquantes("flotte.csv", ["Type"]),
    });
    expect(lire("Nom;Email")).toEqual({
      nom: "flotte.csv",
      type: null,
      erreur: MESSAGES_IMPORT.colonnesManquantes("flotte.csv", ["Prénom"]),
    });
  });

  it("ignore les colonnes inconnues ou en double, et tait les colonnes vides en fin de ligne", () => {
    expect(lire(csv("Plaque;Type;Couleur;Plaque;;", "AB-123-CD;Pool;Blanc;XX;;"))).toMatchObject({
      type: "vehicules",
      colonnesIgnorees: ["Couleur", "Plaque"],
      lignes: [{ valeurs: { plaque: "AB-123-CD", type: "Pool" } }],
    });
  });

  it("refuse un fichier dont la première ligne n'est pas celle d'un modèle", () => {
    expect(lire(csv("AB-123-CD;Master;Pool"))).toEqual({
      nom: "flotte.csv",
      type: null,
      erreur: MESSAGES_IMPORT.fichierNonReconnu("flotte.csv"),
    });
  });

  it("refuse un classeur Excel enregistré sans passer par CSV", () => {
    const xlsx = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
    expect(lireFichier("flotte.csv", xlsx)).toEqual({
      nom: "flotte.csv",
      type: null,
      erreur: MESSAGES_IMPORT.formatNonCsv("flotte.csv"),
    });
  });

  it("signale un guillemet jamais fermé", () => {
    expect(lire(csv("Plaque;Type", 'AB-123-CD;"Pool', "EF-456-GH;Pool"))).toEqual({
      nom: "flotte.csv",
      type: null,
      erreur: MESSAGES_IMPORT.guillemetNonFerme("flotte.csv", 2),
    });
  });

  it("ignore les lignes vides, mais garde les n° de ligne d'Excel", () => {
    const lu = lire(csv("Plaque;Type", ";", "AB-123-CD;Pool", "", " ; ", "EF-456-GH;Pool", ""));
    expect(lu.type && lu.lignes.map(({ ligne }) => ligne)).toEqual([3, 6]);
  });

  it(`refuse plus de ${LIGNES_MAX} lignes`, () => {
    const texte = csv("Plaque;Type", ...Array.from({ length: LIGNES_MAX + 1 }, () => "AB-123-CD;Pool"));
    expect(lire(texte)).toEqual({
      nom: "flotte.csv",
      type: null,
      erreur: MESSAGES_IMPORT.tropDeLignes("flotte.csv", LIGNES_MAX),
    });
  });
});

describe("analyserImport : fichiers", () => {
  it("refuse un second fichier du même type", () => {
    const { analyse } = analyser([lire(csv(V, "AA-111-AA;;Pool"), "a.csv"), lire(csv(V, "BB-222-BB;;Pool"), "b.csv")]);
    expect(analyse.fichiers[1]).toEqual({ nom: "b.csv", type: null, erreur: MESSAGES_IMPORT.memeType("b.csv", "vehicules") });
    expect(analyse.aImporter).toEqual({ vehicules: 1, conducteurs: 0, affectations: 0 });
  });

  it("garde un fichier en erreur dans l'analyse, sans rien à écrire", () => {
    const { analyse, aEcrire } = analyser([lire("a;b")]);
    expect(analyse.fichiers).toEqual([{ nom: "flotte.csv", type: null, erreur: MESSAGES_IMPORT.fichierNonReconnu("flotte.csv") }]);
    expect(aEcrire).toEqual({ vehicules: [], conducteurs: [] });
  });
});

describe("analyserImport : véhicules", () => {
  it("prépare une ligne valide, avec une lecture tolérante du type", () => {
    const { lignes, aEcrire, analyse } = vehicules(csv(V, "aa 111 aa;Renault Master;attitré;;", "BB-222-BB;;POOL;;"));
    expect(lignes.map(({ statut, plaque, type }) => ({ statut, plaque, type }))).toEqual([
      { statut: "a_importer", plaque: "AA-111-AA", type: "attitre" },
      { statut: "a_importer", plaque: "BB-222-BB", type: "pool" },
    ]);
    expect(aEcrire.vehicules).toEqual([
      { ligne: 2, saisie: { plaque: "aa 111 aa", modele: "Renault Master", type: "attitre" } },
      { ligne: 3, saisie: { plaque: "BB-222-BB", modele: undefined, type: "pool" } },
    ]);
    expect(analyse.aImporter).toEqual({ vehicules: 2, conducteurs: 0, affectations: 0 });
  });

  it("ignore une plaque déjà dans la flotte, archivée comprise, sans regarder le reste de la ligne", () => {
    const { lignes, aEcrire } = vehicules(csv(V, "ab-123-cd;;Camion;inconnu@exemple.fr;31/02/2024", "EF 456 GH;;Pool;;"));
    expect(lignes[0]).toMatchObject({
      statut: "ignoree",
      plaque: "AB-123-CD",
      motifs: { plaque: MESSAGES.plaqueDejaPresente("AB-123-CD"), attitre: MESSAGES_IMPORT.attitreNonApplique },
    });
    expect(lignes[0].ficheArchivee).toBeUndefined();
    expect(lignes[1]).toMatchObject({
      statut: "ignoree",
      motifs: { plaque: MESSAGES.plaqueArchivee("EF-456-GH") },
      ficheArchivee: { type: "vehicule", id: "v-archive" },
    });
    expect(aEcrire.vehicules).toEqual([]);
  });

  it("signale une plaque déjà plus haut dans le fichier", () => {
    const { lignes } = vehicules(csv(V, "AA-111-AA;;Pool;;", "aa 111 aa;;Attitré;;"));
    expect(lignes[1]).toMatchObject({ statut: "en_erreur", motifs: { plaque: MESSAGES_IMPORT.doublonFichier(2) } });
  });

  it("donne toutes les erreurs de la ligne, avec les motifs des écrans", () => {
    const { lignes } = vehicules(csv(V, `AB-12-CD;${"x".repeat(81)};Camion;;`, ";;Pool;;"));
    expect(lignes[0]).toMatchObject({
      statut: "en_erreur",
      plaque: null,
      motifs: { plaque: MESSAGES.plaqueMalFormee, modele: MESSAGES.modeleTropLong, type: MESSAGES.typeVide },
    });
    expect(lignes[1].motifs).toEqual({ plaque: MESSAGES.plaqueVide });
  });
});

describe("analyserImport : conducteurs", () => {
  it("lit la civilité, le code postal, les dates ISO et les dates suivies de 00:00", () => {
    const texte = csv(
      "Civilité;Prénom;Nom;Date de naissance;Code postal;Date de délivrance du permis",
      "Monsieur;Karim;Haddad;1985-05-14;1000;02/09/2004 00:00:00",
      "Madame;Inès;Roux;;69003;",
      "M.;Hugo;Petit;;;",
    );
    const { lignes, aEcrire } = conducteurs(texte);
    expect(lignes.map(({ statut }) => statut)).toEqual(["a_importer", "a_importer", "a_importer"]);
    expect(aEcrire.conducteurs[0].saisie).toMatchObject({
      civilite: "m",
      code_postal: "01000",
      date_naissance: "14/05/1985",
      permis_delivre_le: "02/09/2004",
    });
    expect(aEcrire.conducteurs.map(({ saisie }) => saisie.civilite)).toEqual(["m", "mme", "m"]);
  });

  it("signale un n° de permis arrondi par Excel", () => {
    const { lignes } = conducteurs(csv(C, "Karim;Haddad;1,20569E+11;"));
    expect(lignes[0]).toMatchObject({ statut: "en_erreur", motifs: { permis_numero: MESSAGES_IMPORT.permisArrondi } });
  });

  it("ignore un permis ou un email déjà dans la flotte, archivés compris", () => {
    const { lignes, aEcrire } = conducteurs(
      csv(C, "K.;Benali;12 0569 300 123;", "Karim;B.;;KARIM@exemple.fr", "Léa;Martin;lm42;", "Léa;M.;;lea@exemple.fr"),
    );
    expect(lignes.map(({ statut, motifs, ficheArchivee }) => ({ statut, motifs, ficheArchivee }))).toEqual([
      { statut: "ignoree", motifs: { permis_numero: MESSAGES.permisDejaPresent("Karim Benali") }, ficheArchivee: undefined },
      { statut: "ignoree", motifs: { email: MESSAGES.emailDejaPresent("Karim Benali") }, ficheArchivee: undefined },
      {
        statut: "ignoree",
        motifs: { permis_numero: MESSAGES.permisArchive("Léa Martin") },
        ficheArchivee: { type: "conducteur", id: "c-lea" },
      },
      {
        statut: "ignoree",
        motifs: { email: MESSAGES.emailArchive("Léa Martin") },
        ficheArchivee: { type: "conducteur", id: "c-lea" },
      },
    ]);
    expect(aEcrire.conducteurs).toEqual([]);
  });

  it("ignore un homonyme sans permis ni email, mais pas un homonyme qui a son propre permis", () => {
    const { lignes } = conducteurs(csv(C, "paul;DURAND;;", "Paul;Durand;PD99;"));
    expect(lignes[0]).toMatchObject({
      statut: "ignoree",
      motifs: { general: MESSAGES_IMPORT.homonymePresent("Paul Durand") },
    });
    expect(lignes[1].statut).toBe("a_importer");
  });

  it("signale les doublons du fichier : permis, email, homonyme sans clé", () => {
    const { lignes } = conducteurs(
      csv(
        C,
        "Inès;Roux;IR1;ines@exemple.fr",
        "Inès;Roux-Bis;ir 1;",
        "Inès;Autre;;INES@exemple.fr",
        "Hugo;Petit;;",
        "hugo;petit;;",
        "Hugo;Petit;HP7;",
      ),
    );
    expect(lignes.map(({ statut, motifs }) => ({ statut, motifs }))).toEqual([
      { statut: "a_importer", motifs: {} },
      { statut: "en_erreur", motifs: { permis_numero: MESSAGES_IMPORT.doublonFichier(2) } },
      { statut: "en_erreur", motifs: { email: MESSAGES_IMPORT.doublonFichier(2) } },
      { statut: "a_importer", motifs: {} },
      { statut: "en_erreur", motifs: { general: MESSAGES_IMPORT.doublonFichier(5) } },
      { statut: "a_importer", motifs: {} },
    ]);
  });

  it("donne les erreurs des règles de la fiche conducteur", () => {
    const { lignes } = conducteurs(csv(C, "Inès;;AB/12;ines@"));
    expect(lignes[0]).toMatchObject({
      statut: "en_erreur",
      nom: "Inès",
      motifs: { nom: MESSAGES.nomVide, permis_numero: MESSAGES.permisMalForme, email: MESSAGES.emailMalForme },
    });
  });
});

describe("analyserImport : conducteur attitré", () => {
  const ligne = (attitre: string, depuis = "", plaque = "AA-111-AA", type = "Attitré") =>
    `${plaque};;${type};${attitre};${depuis}`;

  it("trouve un conducteur de la flotte par son email ou son permis, et débute à la date de l'import par défaut", () => {
    const { lignes, aEcrire, analyse } = vehicules(
      csv(V, ligne("Karim@Exemple.fr"), ligne("1205 6930 0123", "01/09/2024", "BB-222-BB")),
    );
    expect(lignes.map(({ statut, attitre }) => ({ statut, attitre }))).toEqual([
      { statut: "a_importer", attitre: { nom: "Karim Benali", depuis: "14/10/2026" } },
      { statut: "a_importer", attitre: { nom: "Karim Benali", depuis: "01/09/2024" } },
    ]);
    expect(aEcrire.vehicules.map(({ attitre }) => attitre)).toEqual([
      { conducteur: { id: "c-karim" }, debut_date: "14/10/2026" },
      { conducteur: { id: "c-karim" }, debut_date: "01/09/2024" },
    ]);
    expect(analyse.aImporter).toEqual({ vehicules: 2, conducteurs: 0, affectations: 2 });
  });

  it("trouve un conducteur du même import, ou celui de la flotte qu'une ligne ignorée a reconnu", () => {
    const { lignes, aEcrire, analyse } = vehicules(
      csv(V, ligne("ines@exemple.fr", "2024-09-01"), ligne("nouveau@exemple.fr", "", "BB-222-BB")),
      csv(C, "Inès;Roux;IR1;ines@exemple.fr", "Karim;Benali;120569300123;nouveau@exemple.fr"),
    );
    expect(lignes.map(({ attitre }) => attitre)).toEqual([
      { nom: "Inès Roux", depuis: "01/09/2024" },
      { nom: "Karim Benali", depuis: "14/10/2026" },
    ]);
    expect(aEcrire.vehicules.map(({ attitre }) => attitre?.conducteur)).toEqual([{ ligne: 2 }, { id: "c-karim" }]);
    expect(analyse.aImporter).toEqual({ vehicules: 2, conducteurs: 1, affectations: 2 });
  });

  it("refuse un attitré archivé, introuvable, mal formé ou en erreur dans le fichier conducteurs", () => {
    const { lignes } = vehicules(
      csv(
        V,
        ligne("lea@exemple.fr", "", "AA-111-AA"),
        ligne("personne@exemple.fr", "", "BB-222-BB"),
        ligne("K. Benali", "", "CC-333-CC"),
        ligne("IR1", "", "DD-444-DD"),
        ligne("1,20569E+11", "", "EE-555-EE"),
      ),
      csv(C, "Inès;;IR1;"),
    );
    expect(lignes.map(({ statut, motifs, ficheArchivee }) => ({ statut, motifs, ficheArchivee }))).toEqual([
      {
        statut: "en_erreur",
        motifs: { attitre: MESSAGES.conducteurArchiveAffectation("Léa Martin") },
        ficheArchivee: { type: "conducteur", id: "c-lea" },
      },
      { statut: "en_erreur", motifs: { attitre: MESSAGES_IMPORT.attitreIntrouvable }, ficheArchivee: undefined },
      { statut: "en_erreur", motifs: { attitre: MESSAGES_IMPORT.attitreMalForme }, ficheArchivee: undefined },
      { statut: "en_erreur", motifs: { attitre: MESSAGES_IMPORT.attitreEnErreur(2) }, ficheArchivee: undefined },
      { statut: "en_erreur", motifs: { attitre: MESSAGES_IMPORT.permisArrondi }, ficheArchivee: undefined },
    ]);
  });

  it("refuse un attitré sur un véhicule de pool, et une date sans attitré", () => {
    const { lignes } = vehicules(csv(V, ligne("karim@exemple.fr", "", "AA-111-AA", "Pool"), ligne("", "01/09/2024", "BB-222-BB")));
    expect(lignes.map(({ motifs }) => motifs)).toEqual([
      { attitre: MESSAGES_IMPORT.attitrePool },
      { attitre_depuis: MESSAGES_IMPORT.depuisSansAttitre },
    ]);
  });

  it("contrôle la date de début avec les règles des affectations", () => {
    const { lignes } = vehicules(csv(V, ligne("karim@exemple.fr", "31/02/2024"), ligne("karim@exemple.fr", "2024", "BB-222-BB")));
    expect(lignes.map(({ motifs }) => motifs)).toEqual([
      { attitre_depuis: MESSAGES.dateInexistante("31/02/2024") },
      { attitre_depuis: MESSAGES.dateMalFormee },
    ]);
  });
});
