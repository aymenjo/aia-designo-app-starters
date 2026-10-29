import { LIMITES_FREE, type Plan } from "@/lib/abonnement/plans";
import { decoderCsv, ecrireCsv, lireCsv } from "@/lib/csv";
import { aujourdhuiParis, depuisIso, normaliserDate } from "@/lib/dates";
import { premieresErreurs } from "@/lib/saisie";
import {
  CHAMPS_CONDUCTEUR,
  LIBELLES_CHAMP_CONDUCTEUR,
  LONGUEUR_MAX_MODELE,
  MESSAGES,
  TYPES_VEHICULE,
  nomComplet,
  normaliserEmail,
  normaliserPermis,
  normaliserPlaque,
  schemaConducteur,
  schemaVehicule,
  verifierSaisieAffectation,
  type ChampConducteur,
  type ChampVehicule,
  type Civilite,
  type SaisieConducteur,
  type SaisieVehicule,
  type TypeVehicule,
} from "./regles";

// Import CSV de la flotte (phase 6) : colonnes des modèles, lecture tolérante des fichiers et analyse à blanc.
// Pur : la page s'en sert pour décrire les colonnes, le serveur pour l'aperçu et l'import (./import.ts).
// Les règles et les messages d'une ligne sont ceux des écrans (./regles).

export const TYPES_FICHIER = ["vehicules", "conducteurs"] as const;
export type TypeFichier = (typeof TYPES_FICHIER)[number];

export const LIBELLES_FICHIER: Record<TypeFichier, string> = { vehicules: "véhicules", conducteurs: "conducteurs" };

/** Les colonnes du fichier véhicules : celles de la fiche, plus le conducteur attitré et le début de son affectation. */
export type ChampLigneVehicule = ChampVehicule | "attitre" | "attitre_depuis";

export type Colonne<Champ extends string = string> = {
  champ: Champ;
  entete: string;
  requise: boolean;
  format: string;
  exemple?: string;
  /** D'autres en-têtes reconnus, en plus de `entete`. */
  alias?: readonly string[];
};

const COLONNES_VEHICULES: readonly Colonne<ChampLigneVehicule>[] = [
  {
    champ: "plaque",
    entete: "Plaque",
    requise: true,
    format: "AB-123-CD ou 123 ABC 45",
    exemple: "AB-123-CD",
    alias: ["immatriculation", "plaque d'immatriculation", "immat"],
  },
  {
    champ: "modele",
    entete: "Modèle",
    requise: false,
    format: `Texte libre, ${LONGUEUR_MAX_MODELE} caractères au plus`,
    exemple: "Renault Master",
  },
  { champ: "type", entete: "Type", requise: true, format: "Attitré ou Pool", exemple: "Attitré" },
  {
    champ: "attitre",
    entete: "Conducteur attitré",
    requise: false,
    format: "Email ou n° de permis d'un conducteur de votre flotte ou du fichier conducteurs",
    exemple: "karim.benali@exemple.fr",
    alias: ["attitre"],
  },
  {
    champ: "attitre_depuis",
    entete: "Attitré depuis le",
    requise: false,
    format: "JJ/MM/AAAA ; vide, la date de l'import",
    exemple: "01/09/2024",
    alias: ["depuis le", "depuis"],
  },
];

/** Seuls le prénom et le nom sont obligatoires, comme à l'ajout d'un conducteur. */
const REQUIS_CONDUCTEUR: readonly ChampConducteur[] = ["prenom", "nom"];

const DESCRIPTION_CONDUCTEUR: Record<ChampConducteur, Pick<Colonne, "format" | "exemple" | "alias">> = {
  civilite: { format: "M. ou Mme", exemple: "M." },
  prenom: { format: "Texte", exemple: "Karim" },
  nom: { format: "Texte", exemple: "Benali" },
  date_naissance: { format: "JJ/MM/AAAA", exemple: "14/05/1985", alias: ["naissance", "ne le"] },
  lieu_naissance: { format: "Texte", exemple: "Lyon" },
  adresse: { format: "N° et voie", exemple: "12 rue des Lilas" },
  adresse_complement: { format: "Texte", exemple: "Bâtiment B", alias: ["complement"] },
  code_postal: { format: "5 chiffres", exemple: "69003", alias: ["cp"] },
  ville: { format: "Texte", exemple: "Lyon" },
  permis_numero: {
    format: "Chiffres et lettres, 20 au plus",
    exemple: "120569300123",
    alias: ["numero de permis", "n de permis", "no de permis", "permis"],
  },
  permis_delivre_le: {
    format: "JJ/MM/AAAA",
    exemple: "02/09/2004",
    alias: ["date de delivrance", "delivrance du permis", "permis delivre le"],
  },
  permis_categories: {
    format: "Catégories séparées par des virgules",
    exemple: "B, C1",
    alias: ["categories", "categories du permis", "categorie de permis"],
  },
  email: { format: "nom@domaine.fr", exemple: "karim.benali@exemple.fr", alias: ["e-mail", "courriel", "mail"] },
};

const COLONNES_CONDUCTEURS: readonly Colonne<ChampConducteur>[] = CHAMPS_CONDUCTEUR.map((champ) => ({
  champ,
  entete: LIBELLES_CHAMP_CONDUCTEUR[champ],
  requise: REQUIS_CONDUCTEUR.includes(champ),
  ...DESCRIPTION_CONDUCTEUR[champ],
}));

/** Les colonnes des deux modèles, dans leur ordre : la page les décrit, `ecrireModele` en écrit les en-têtes. */
export const COLONNES = { vehicules: COLONNES_VEHICULES, conducteurs: COLONNES_CONDUCTEURS } as const;

/** Sous la limite de 1 Mo d'une server action, qui reçoit les fichiers. */
export const TAILLE_MAX_IMPORT = 900 * 1024;
export const LIGNES_MAX = 500;
export const FICHIERS_ACCEPTES_IMPORT = ".csv,.txt,text/csv";

const pluriel = (n: number, mot: string) => `${mot}${n > 1 ? "s" : ""}`;
const entreGuillemets = (textes: readonly string[]) => textes.map((texte) => `« ${texte} »`).join(", ");

// Espace insécable avant les deux-points : ils ne passent jamais seuls en début de ligne.
export const MESSAGES_IMPORT = {
  ...MESSAGES,

  // Fichiers
  aucunFichier: "Déposez un fichier CSV.",
  formatNonCsv: (nom: string) =>
    `${nom} n'est pas un fichier CSV : dans Excel, « Fichier › Enregistrer sous », puis « CSV UTF-8 ».`,
  fichiersTropLourds: `Fichiers trop lourds : ${TAILLE_MAX_IMPORT / 1024} Ko au maximum en tout.`,
  tropDeFichiers: "Déposez au plus 2 fichiers : un pour les véhicules, un pour les conducteurs.",
  memeType: (nom: string, type: TypeFichier) =>
    `${nom} est un second fichier ${LIBELLES_FICHIER[type]} : importez-le ensuite, séparément.`,
  fichierNonReconnu: (nom: string) =>
    `${nom} n'est pas reconnu : sa première ligne doit reprendre les en-têtes d'un modèle.`,
  colonnesManquantes: (nom: string, colonnes: readonly string[]) =>
    `${pluriel(colonnes.length, "Colonne")} ${pluriel(colonnes.length, "obligatoire")} ${pluriel(colonnes.length, "absente")} de ${nom} : ${entreGuillemets(colonnes)}.`,
  tropDeLignes: (nom: string, max: number) =>
    `${nom} compte plus de ${max} lignes : découpez-le en plusieurs fichiers.`,
  guillemetNonFerme: (nom: string, ligne: number) =>
    `${nom}, ligne ${ligne} : un guillemet n'est jamais fermé.`,
  envoiImpossible: "L'envoi des fichiers a échoué. Réessayez dans un instant.",

  // Informations sur un fichier
  aucuneLigne: "Aucune ligne sous les en-têtes : complétez le modèle, puis déposez-le à nouveau.",
  colonnesIgnorees: (colonnes: readonly string[]) =>
    `${pluriel(colonnes.length, "Colonne")} ${pluriel(colonnes.length, "ignorée")} : ${entreGuillemets(colonnes)}.`,

  // Lignes
  doublonFichier: (ligne: number) => `Déjà présent ligne ${ligne} de ce fichier.`,
  homonymePresent: (nom: string) =>
    `${nom} est déjà dans votre flotte : sans n° de permis ni email pour les distinguer, la ligne est ignorée.`,
  permisArrondi: "Excel a arrondi ce n° de permis : mettez la colonne au format Texte, puis ressaisissez-le.",
  attitreMalForme: "Conducteur attitré mal formé : attendu son email ou son n° de permis.",
  attitreIntrouvable:
    "Aucun conducteur n'a cet email ou ce n° de permis, ni dans votre flotte ni dans le fichier conducteurs.",
  attitreEnErreur: (ligne: number) =>
    `Ce conducteur est en erreur ligne ${ligne} du fichier conducteurs : corrigez-la d'abord.`,
  attitrePool: "Un véhicule de pool n'a pas de conducteur attitré : affectez-le depuis le planning, avec une fin.",
  depuisSansAttitre: "Date sans conducteur attitré : remplissez aussi « Conducteur attitré », ou videz cette cellule.",
  attitreNonApplique:
    "Ce véhicule est déjà dans votre flotte : son conducteur attitré n'est pas repris, affectez-le depuis le planning.",
  interrompu: "L'import s'est interrompu avant cette ligne : déposez à nouveau le même fichier pour le reprendre.",
  horsLimite: `Plan Free : ${LIMITES_FREE.vehicules} véhicules actifs au plus. Ce véhicule n'est pas importé : archivez-en un, ou passez en Pro.`,
  attitreHorsLimite: "Le véhicule n'est pas importé : son conducteur attitré n'est pas affecté.",
} as const;

// Dépôt

export type ControleImport = { ok: true } | { ok: false; erreur: string };

/**
 * 1 ou 2 fichiers CSV, légers. Le type MIME n'est pas contrôlé : Excel sous Windows envoie un CSV
 * en `application/vnd.ms-excel`. Contrôlé par l'écran, puis par le serveur.
 */
export function verifierDepotImport(fichiers: readonly { name: string; size: number }[]): ControleImport {
  if (!fichiers.length) return { ok: false, erreur: MESSAGES_IMPORT.aucunFichier };
  if (fichiers.length > 2) return { ok: false, erreur: MESSAGES_IMPORT.tropDeFichiers };
  const autre = fichiers.find(({ name }) => !/\.(csv|txt)$/i.test(name));
  if (autre) return { ok: false, erreur: MESSAGES_IMPORT.formatNonCsv(autre.name) };
  const taille = fichiers.reduce((total, { size }) => total + size, 0);
  if (taille > TAILLE_MAX_IMPORT) return { ok: false, erreur: MESSAGES_IMPORT.fichiersTropLourds };
  return { ok: true };
}

/** Le modèle à télécharger : la ligne d'en-têtes seule. La page décrit chaque colonne. */
export function ecrireModele(type: TypeFichier): string {
  return ecrireCsv([COLONNES[type].map(({ entete }) => entete)]);
}

// Lecture d'un fichier

/** « N° de permis* » → « n de permis » : sans accents, casse ni ponctuation. */
function cle(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const INDEX_ENTETES = Object.fromEntries(
  TYPES_FICHIER.map((type) => [
    type,
    new Map<string, string>(
      COLONNES[type].flatMap(({ champ, entete, alias = [] }) =>
        [entete, ...alias].map((nom) => [cle(nom), champ] as const),
      ),
    ),
  ]),
) as Record<TypeFichier, Map<string, string>>;

type LigneLue<Champ extends string> = {
  /** N° de ligne dans Excel : la ligne d'en-têtes vaut 1. */
  ligne: number;
  /** Les cellules remplies, rognées. */
  valeurs: Partial<Record<Champ, string>>;
};

export type FichierLu =
  | { nom: string; type: "vehicules"; colonnesIgnorees: string[]; lignes: LigneLue<ChampLigneVehicule>[] }
  | { nom: string; type: "conducteurs"; colonnesIgnorees: string[]; lignes: LigneLue<ChampConducteur>[] }
  | { nom: string; type: null; erreur: string };

/** Le type du fichier d'après ses en-têtes, et le nombre d'en-têtes reconnus pour choisir le séparateur. */
function reconnaitre(entetes: readonly string[]): { type: TypeFichier | null; reconnus: number } {
  const champs = (type: TypeFichier) =>
    new Set(entetes.map((entete) => INDEX_ENTETES[type].get(cle(entete))).filter(Boolean));
  const vehicules = champs("vehicules");
  const conducteurs = champs("conducteurs");
  const type = vehicules.has("plaque")
    ? "vehicules"
    : conducteurs.has("prenom") || conducteurs.has("nom")
      ? "conducteurs"
      : null;
  return { type, reconnus: Math.max(vehicules.size, conducteurs.size) };
}

/** Un classeur Excel (.xlsx, une archive zip, ou .xls) enregistré sans passer par « CSV ». */
function estClasseur(octets: Uint8Array): boolean {
  const debut = (...signature: number[]) => signature.every((octet, i) => octets[i] === octet);
  return debut(0x50, 0x4b, 0x03, 0x04) || debut(0xd0, 0xcf, 0x11, 0xe0);
}

/**
 * Lit un fichier déposé : décode, choisit entre « ; » et « , » celui qui reconnaît le plus d'en-têtes,
 * déduit le type (une colonne Plaque : véhicules ; Prénom ou Nom : conducteurs), puis garde les cellules
 * des colonnes reconnues. Les lignes vides sont ignorées, mais comptées dans les n° de ligne.
 */
export function lireFichier(nom: string, octets: Uint8Array): FichierLu {
  if (estClasseur(octets)) return { nom, type: null, erreur: MESSAGES_IMPORT.formatNonCsv(nom) };
  const texte = decoderCsv(octets);

  const premiereLigne = texte.split(/\r\n|\r|\n/, 1)[0] ?? "";
  const [separateur] = [";", ","]
    .map((candidat) => {
      const lue = lireCsv(premiereLigne, candidat);
      return [candidat, lue.ok ? reconnaitre(lue.enregistrements[0] ?? []).reconnus : 0] as const;
    })
    .reduce((meilleur, candidat) => (candidat[1] > meilleur[1] ? candidat : meilleur));

  const lue = lireCsv(texte, separateur);
  if (!lue.ok) return { nom, type: null, erreur: MESSAGES_IMPORT.guillemetNonFerme(nom, lue.ligne) };
  const [entetes = [], ...enregistrements] = lue.enregistrements;
  const { type } = reconnaitre(entetes);
  if (!type) return { nom, type: null, erreur: MESSAGES_IMPORT.fichierNonReconnu(nom) };

  // Une colonne reconnue deux fois n'est lue qu'une fois ; les en-têtes vides (colonnes vides en fin de ligne) sont tus.
  const vus = new Set<string>();
  const colonnesIgnorees: string[] = [];
  const champs = entetes.map((brut) => {
    const entete = brut.trim();
    const champ = INDEX_ENTETES[type].get(cle(entete));
    if (champ && !vus.has(champ)) {
      vus.add(champ);
      return champ;
    }
    if (entete) colonnesIgnorees.push(entete);
    return null;
  });
  const manquantes = COLONNES[type].filter(({ champ, requise }) => requise && !vus.has(champ)).map((c) => c.entete);
  if (manquantes.length) return { nom, type: null, erreur: MESSAGES_IMPORT.colonnesManquantes(nom, manquantes) };

  const lignes: LigneLue<string>[] = [];
  enregistrements.forEach((cellules, i) => {
    if (cellules.every((cellule) => !cellule.trim())) return;
    const valeurs: Record<string, string> = {};
    cellules.forEach((cellule, j) => {
      const champ = champs[j];
      const valeur = cellule.trim();
      if (champ && valeur) valeurs[champ] = valeur;
    });
    lignes.push({ ligne: i + 2, valeurs });
  });
  if (lignes.length > LIGNES_MAX) return { nom, type: null, erreur: MESSAGES_IMPORT.tropDeLignes(nom, LIGNES_MAX) };

  return { nom, type, colonnesIgnorees, lignes } as FichierLu;
}

// Lecture tolérante, propre au CSV, avant les règles des écrans

const CIVILITES_LUES: Record<string, Civilite> = { m: "m", mr: "m", monsieur: "m", mme: "mme", madame: "mme" };
/** « 1,23457E+11 » : Excel a pris le n° de permis pour un nombre. */
const NOTATION_SCIENTIFIQUE = /^\d+([.,]\d+)?e\+?\d+$/i;
const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;

/** « 2024-09-01 » ou « 01/09/2024 00:00:00 » (une date passée par un tableur) → « 01/09/2024 ». */
function lireDateTolerante(brut: string | undefined): string | undefined {
  if (!brut) return brut;
  const date = brut.replace(/(\s+|T)00:00(:00)?$/, "");
  return DATE_ISO.test(date) ? depuisIso(date) : date;
}

function lireType(brut: string | undefined): string | undefined {
  const type = brut && cle(brut);
  return TYPES_VEHICULE.find((candidat) => candidat === type) ?? brut;
}

function saisieConducteur(valeurs: Partial<Record<ChampConducteur, string>>) {
  const saisie: SaisieConducteur = {
    ...valeurs,
    date_naissance: lireDateTolerante(valeurs.date_naissance),
    permis_delivre_le: lireDateTolerante(valeurs.permis_delivre_le),
  };
  if (valeurs.civilite) saisie.civilite = CIVILITES_LUES[cle(valeurs.civilite)] ?? valeurs.civilite;
  // Excel retire le zéro initial d'un code postal pris pour un nombre : 1000 pour 01000.
  if (valeurs.code_postal && /^\d{4}$/.test(valeurs.code_postal)) saisie.code_postal = `0${valeurs.code_postal}`;
  const arrondi = Boolean(valeurs.permis_numero && NOTATION_SCIENTIFIQUE.test(valeurs.permis_numero));
  return { saisie, arrondi };
}

// Analyse à blanc

/** `hors_limite` : une ligne valide, mais au-delà des véhicules actifs du plan Free. */
export type StatutLigne = "a_importer" | "importee" | "ignoree" | "en_erreur" | "hors_limite";
/** La fiche archivée qui explique un refus : la ligne propose « Ouvrir sa fiche ». */
export type FicheArchivee = { type: "vehicule" | "conducteur"; id: string };
export type Motifs<Champ extends string> = Partial<Record<Champ | "general", string>>;

type LigneAnalysee<Champ extends string> = LigneLue<Champ> & {
  statut: StatutLigne;
  /** Le motif de chaque colonne en erreur ou qui fait ignorer la ligne ; `general` pour la ligne entière. */
  motifs: Motifs<Champ>;
  ficheArchivee?: FicheArchivee;
};

export type LigneVehicule = LigneAnalysee<ChampLigneVehicule> & {
  /** La plaque normalisée, `null` si elle est vide ou mal formée. */
  plaque: string | null;
  type?: TypeVehicule;
  /** Le conducteur attitré et le début de son affectation (JJ/MM/AAAA). */
  attitre?: { nom: string; depuis: string };
};

export type LigneConducteur = LigneAnalysee<ChampConducteur> & { nom: string };

export type FichierAnalyse =
  | { nom: string; type: "vehicules"; colonnesIgnorees: string[]; lignes: LigneVehicule[] }
  | { nom: string; type: "conducteurs"; colonnesIgnorees: string[]; lignes: LigneConducteur[] }
  | { nom: string; type: null; erreur: string };

export type Comptes = { vehicules: number; conducteurs: number; affectations: number };
export const AUCUN: Comptes = { vehicules: 0, conducteurs: 0, affectations: 0 };

/** L'aperçu : rien n'est écrit. Sérialisable, sans aucun id d'écriture. */
export type AnalyseImport = { erreur?: string; fichiers: FichierAnalyse[]; aImporter: Comptes };
/** Après l'import : chaque ligne écrite passe en « importee », et les comptes de ce qui a été écrit. */
export type RapportImport = AnalyseImport & { importes: Comptes };

// Côté serveur seulement : ce qui est déjà en base, et ce qu'il reste à écrire.

/** Un véhicule en base : en lecture seule (retour en Free), il ne compte pas parmi les actifs de la limite Free. */
export type VehiculeExistant = { id: string; plaque: string; archive_le: string | null; lecture_seule_le: string | null };
export type ConducteurExistant = {
  id: string;
  prenom: string;
  nom: string;
  permis_numero: string | null;
  email: string | null;
  archive_le: string | null;
};
/** La flotte de l'entreprise, archivés compris, et son plan : en Free, les véhicules actifs sont limités. */
export type Existants = { plan: Plan; vehicules: VehiculeExistant[]; conducteurs: ConducteurExistant[] };

/** Un conducteur déjà en base, ou la ligne du fichier conducteurs qui le crée. */
export type RefConducteur = { id: string } | { ligne: number };
export type AEcrire = {
  conducteurs: { ligne: number; saisie: SaisieConducteur }[];
  vehicules: {
    ligne: number;
    saisie: SaisieVehicule;
    attitre?: { conducteur: RefConducteur; debut_date: string };
  }[];
};

/** Un id bien formé, pour contrôler le début d'une affectation dont le véhicule et le conducteur restent à créer. */
const ID_A_CREER = "00000000-0000-4000-8000-000000000000";

/** Une ligne du fichier conducteurs, telle que la voit la colonne « Conducteur attitré ». */
type ConducteurDuFichier = { ligne: number; nom: string; statut: StatutLigne; reconnu?: ConducteurExistant };

const nomLu = ({ prenom, nom }: Partial<Record<ChampConducteur, string>>) =>
  [prenom, nom].filter(Boolean).join(" ");

function analyserConducteurs(
  lignesLues: LigneLue<ChampConducteur>[],
  existants: Existants,
  aEcrire: AEcrire,
) {
  const parPermis = new Map<string, ConducteurExistant>();
  const parEmail = new Map<string, ConducteurExistant>();
  const parNom = new Map<string, ConducteurExistant>();
  for (const conducteur of existants.conducteurs) {
    if (conducteur.permis_numero) parPermis.set(conducteur.permis_numero, conducteur);
    if (conducteur.email) parEmail.set(conducteur.email, conducteur);
    parNom.set(cle(nomComplet(conducteur)), conducteur);
  }

  // Pour la colonne « Conducteur attitré » : la première ligne qui porte chaque permis ou email.
  const duFichier = new Map<string, ConducteurDuFichier>();
  const vus = new Map<string, number>();
  const lignes: LigneConducteur[] = [];

  for (const { ligne, valeurs } of lignesLues) {
    const nom = nomLu(valeurs);
    const permis = valeurs.permis_numero ? normaliserPermis(valeurs.permis_numero) : null;
    const email = valeurs.email ? normaliserEmail(valeurs.email) : null;
    const sansCle = !valeurs.permis_numero && !valeurs.email;
    const cles = [permis && `permis:${permis}`, email && `email:${email}`].filter((c): c is string => Boolean(c));
    const cleNom = `nom:${cle(nom)}`;
    const retenir = (vue: ConducteurDuFichier) => {
      for (const c of cles) if (!duFichier.has(c)) duFichier.set(c, vue);
    };

    // 1. Déjà dans la flotte, archivés compris : la ligne est ignorée, sans regarder ses autres colonnes.
    const memePermis = permis ? parPermis.get(permis) : undefined;
    const memeEmail = email ? parEmail.get(email) : undefined;
    const homonyme = sansCle ? parNom.get(cle(nom)) : undefined;
    const reconnu = memePermis ?? memeEmail ?? homonyme;
    if (reconnu) {
      const nomReconnu = nomComplet(reconnu);
      const archive = Boolean(reconnu.archive_le);
      const motifs: Motifs<ChampConducteur> = memePermis
        ? { permis_numero: archive ? MESSAGES.permisArchive(nomReconnu) : MESSAGES.permisDejaPresent(nomReconnu) }
        : memeEmail
          ? { email: archive ? MESSAGES.emailArchive(nomReconnu) : MESSAGES.emailDejaPresent(nomReconnu) }
          : { general: MESSAGES_IMPORT.homonymePresent(nomReconnu) };
      lignes.push({
        ligne,
        valeurs,
        nom,
        statut: "ignoree",
        motifs,
        ...(archive && { ficheArchivee: { type: "conducteur", id: reconnu.id } }),
      });
      retenir({ ligne, nom, statut: "ignoree", reconnu });
      continue;
    }

    // 2. Déjà plus haut dans le fichier.
    const champCle = (c: string): ChampConducteur | "general" =>
      c.startsWith("permis:") ? "permis_numero" : c.startsWith("email:") ? "email" : "general";
    const doublon = [...cles, ...(sansCle ? [cleNom] : [])].find((c) => vus.has(c));
    if (doublon) {
      lignes.push({
        ligne,
        valeurs,
        nom,
        statut: "en_erreur",
        motifs: { [champCle(doublon)]: MESSAGES_IMPORT.doublonFichier(vus.get(doublon)!) },
      });
      continue;
    }
    for (const c of [...cles, cleNom]) if (!vus.has(c)) vus.set(c, ligne);

    // 3. Les règles de la fiche conducteur.
    const { saisie, arrondi } = saisieConducteur(valeurs);
    const valide = schemaConducteur.safeParse(saisie);
    const motifs: Motifs<ChampConducteur> = valide.success ? {} : premieresErreurs<ChampConducteur>(valide.error);
    if (arrondi) motifs.permis_numero = MESSAGES_IMPORT.permisArrondi;
    if (Object.keys(motifs).length) {
      lignes.push({ ligne, valeurs, nom, statut: "en_erreur", motifs });
      retenir({ ligne, nom, statut: "en_erreur" });
      continue;
    }

    lignes.push({ ligne, valeurs, nom, statut: "a_importer", motifs: {} });
    aEcrire.conducteurs.push({ ligne, saisie });
    retenir({ ligne, nom, statut: "a_importer" });
  }

  return { lignes, duFichier };
}

type Attitre =
  | { ok: true; conducteur: RefConducteur; nom: string }
  | { ok: false; motif: string; ficheArchivee?: FicheArchivee };

/** Le conducteur attitré, par son email (une valeur avec « @ ») ou son n° de permis : en base d'abord, puis dans le fichier. */
function trouverAttitre(
  brut: string,
  existants: { parPermis: Map<string, ConducteurExistant>; parEmail: Map<string, ConducteurExistant> },
  duFichier: Map<string, ConducteurDuFichier>,
): Attitre {
  if (NOTATION_SCIENTIFIQUE.test(brut)) return { ok: false, motif: MESSAGES_IMPORT.permisArrondi };
  const email = brut.includes("@") ? normaliserEmail(brut) : null;
  const permis = brut.includes("@") ? null : normaliserPermis(brut);
  if (!email && !permis) return { ok: false, motif: MESSAGES_IMPORT.attitreMalForme };

  const ligne = duFichier.get(email ? `email:${email}` : `permis:${permis}`);
  const reconnu = (email ? existants.parEmail.get(email) : existants.parPermis.get(permis!)) ?? ligne?.reconnu;
  if (reconnu) {
    const nom = nomComplet(reconnu);
    if (reconnu.archive_le) {
      return {
        ok: false,
        motif: MESSAGES.conducteurArchiveAffectation(nom),
        ficheArchivee: { type: "conducteur", id: reconnu.id },
      };
    }
    return { ok: true, conducteur: { id: reconnu.id }, nom };
  }
  if (ligne?.statut === "a_importer") return { ok: true, conducteur: { ligne: ligne.ligne }, nom: ligne.nom };
  if (ligne) return { ok: false, motif: MESSAGES_IMPORT.attitreEnErreur(ligne.ligne) };
  return { ok: false, motif: MESSAGES_IMPORT.attitreIntrouvable };
}

/** Le motif d'une ligne au-delà de la limite Free, et celui de son conducteur attitré, qui n'est pas affecté. */
export function motifsHorsLimite(attitre: unknown): Motifs<ChampLigneVehicule> {
  return { general: MESSAGES_IMPORT.horsLimite, ...(attitre ? { attitre: MESSAGES_IMPORT.attitreHorsLimite } : {}) };
}

function analyserVehicules(
  lignesLues: LigneLue<ChampLigneVehicule>[],
  existants: Existants,
  duFichier: Map<string, ConducteurDuFichier>,
  aujourdhui: string,
  aEcrire: AEcrire,
) {
  const parPlaque = new Map(existants.vehicules.map((vehicule) => [vehicule.plaque, vehicule]));
  const conducteurs = {
    parPermis: new Map(existants.conducteurs.filter((c) => c.permis_numero).map((c) => [c.permis_numero!, c])),
    parEmail: new Map(existants.conducteurs.filter((c) => c.email).map((c) => [c.email!, c])),
  };
  const vues = new Map<string, number>();
  const lignes: LigneVehicule[] = [];
  const actifs = existants.vehicules.filter(({ archive_le, lecture_seule_le }) => !archive_le && !lecture_seule_le).length;

  for (const { ligne, valeurs } of lignesLues) {
    const plaque = valeurs.plaque ? normaliserPlaque(valeurs.plaque) : null;

    // 1. Déjà dans la flotte, archivés compris : toute la ligne est ignorée, conducteur attitré compris.
    const existant = plaque ? parPlaque.get(plaque) : undefined;
    if (existant && plaque) {
      const archive = Boolean(existant.archive_le);
      lignes.push({
        ligne,
        valeurs,
        plaque,
        statut: "ignoree",
        motifs: {
          plaque: archive ? MESSAGES.plaqueArchivee(plaque) : MESSAGES.plaqueDejaPresente(plaque),
          ...(valeurs.attitre && { attitre: MESSAGES_IMPORT.attitreNonApplique }),
        },
        ...(archive && { ficheArchivee: { type: "vehicule", id: existant.id } }),
      });
      continue;
    }

    // 2. Déjà plus haut dans le fichier.
    const premiere = plaque ? vues.get(plaque) : undefined;
    if (premiere) {
      lignes.push({
        ligne,
        valeurs,
        plaque,
        statut: "en_erreur",
        motifs: { plaque: MESSAGES_IMPORT.doublonFichier(premiere) },
      });
      continue;
    }
    if (plaque) vues.set(plaque, ligne);

    // 3. Les règles de la fiche véhicule.
    const saisie: SaisieVehicule = { plaque: valeurs.plaque, modele: valeurs.modele, type: lireType(valeurs.type) };
    const valide = schemaVehicule.safeParse(saisie);
    const motifs: Motifs<ChampLigneVehicule> = valide.success ? {} : premieresErreurs<ChampVehicule>(valide.error);
    const type = valide.success ? valide.data.type : TYPES_VEHICULE.find((candidat) => candidat === saisie.type);

    // 4. Le conducteur attitré, et le début de son affectation : vide, la date de l'import.
    let attitre: Extract<Attitre, { ok: true }> | undefined;
    let ficheArchivee: FicheArchivee | undefined;
    const debut_date = lireDateTolerante(valeurs.attitre_depuis) ?? depuisIso(aujourdhui);
    if (!valeurs.attitre) {
      if (valeurs.attitre_depuis) motifs.attitre_depuis = MESSAGES_IMPORT.depuisSansAttitre;
    } else if (type === "pool") {
      motifs.attitre = MESSAGES_IMPORT.attitrePool;
    } else {
      const trouve = trouverAttitre(valeurs.attitre, conducteurs, duFichier);
      if (trouve.ok) attitre = trouve;
      else {
        motifs.attitre = trouve.motif;
        ficheArchivee = trouve.ficheArchivee;
      }
      const debut = verifierSaisieAffectation(
        { vehicule_id: ID_A_CREER, conducteur_id: ID_A_CREER, debut_date },
        "attitre",
      );
      const motifDebut = debut.debut_date ?? debut.debut_heure;
      if (motifDebut) motifs.attitre_depuis = motifDebut;
    }

    if (Object.keys(motifs).length) {
      lignes.push({ ligne, valeurs, plaque, type, statut: "en_erreur", motifs, ...(ficheArchivee && { ficheArchivee }) });
      continue;
    }

    // 5. En Free, au-delà du 3e véhicule actif, dans l'ordre du fichier : la ligne n'est pas importée.
    const affiche = attitre && { attitre: { nom: attitre.nom, depuis: normaliserDate(debut_date) ?? debut_date } };
    if (existants.plan === "free" && actifs + aEcrire.vehicules.length >= LIMITES_FREE.vehicules) {
      lignes.push({ ligne, valeurs, plaque, type, statut: "hors_limite", motifs: motifsHorsLimite(attitre), ...affiche });
      continue;
    }

    lignes.push({ ligne, valeurs, plaque, type, statut: "a_importer", motifs: {}, ...affiche });
    aEcrire.vehicules.push({
      ligne,
      saisie,
      ...(attitre && { attitre: { conducteur: attitre.conducteur, debut_date } }),
    });
  }

  return lignes;
}

/**
 * L'analyse à blanc des fichiers lus, face à la flotte en base. Chaque ligne est jugée dans cet ordre,
 * pour qu'un réimport du même fichier reste sans effet :
 * 1. sa clé (plaque, permis, email ; à défaut, le nom) est déjà en base, archivés compris : la ligne est ignorée ;
 * 2. sa clé est déjà plus haut dans le fichier : doublon ;
 * 3. les règles de la fiche, avec toutes les erreurs par colonne ;
 * 4. pour un véhicule, son conducteur attitré (en base, puis dans le fichier conducteurs) et sa date de début ;
 * 5. pour un véhicule, en Free, la limite des véhicules actifs : au-delà, la ligne n'est pas importée ;
 * 6. sinon, la ligne est à importer.
 */
export function analyserImport(
  lus: readonly FichierLu[],
  existants: Existants,
  aujourdhui = aujourdhuiParis(),
): { analyse: AnalyseImport; aEcrire: AEcrire } {
  const aEcrire: AEcrire = { conducteurs: [], vehicules: [] };

  // Un fichier de chaque type au plus : le second est refusé.
  const types = new Set<TypeFichier>();
  const retenus = lus.map((lu): FichierLu => {
    if (!lu.type) return lu;
    if (types.has(lu.type)) return { nom: lu.nom, type: null, erreur: MESSAGES_IMPORT.memeType(lu.nom, lu.type) };
    types.add(lu.type);
    return lu;
  });

  // Les conducteurs d'abord : un véhicule peut avoir pour attitré un conducteur du même import.
  const fichierConducteurs = retenus.find((lu) => lu.type === "conducteurs");
  const conducteurs = analyserConducteurs(fichierConducteurs?.lignes ?? [], existants, aEcrire);
  const fichierVehicules = retenus.find((lu) => lu.type === "vehicules");
  const vehicules = analyserVehicules(
    fichierVehicules?.lignes ?? [],
    existants,
    conducteurs.duFichier,
    aujourdhui,
    aEcrire,
  );

  const fichiers = retenus.map((lu): FichierAnalyse => {
    if (lu.type === "conducteurs") return { ...lu, lignes: conducteurs.lignes };
    if (lu.type === "vehicules") return { ...lu, lignes: vehicules };
    return lu;
  });
  const aImporter: Comptes = {
    vehicules: aEcrire.vehicules.length,
    conducteurs: aEcrire.conducteurs.length,
    affectations: aEcrire.vehicules.filter(({ attitre }) => attitre).length,
  };
  return { analyse: { fichiers, aImporter }, aEcrire };
}
