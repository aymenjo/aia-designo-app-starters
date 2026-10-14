import { z } from "zod";
import { aujourdhuiParis, instantParis, normaliserHeure, partiesParis } from "@/lib/dates";
import { MESSAGES as MESSAGES_FLOTTE, lireDate, normaliserPlaque } from "@/lib/flotte/regles";
import { MESSAGES_SAISIE, SEPARATEURS, premieresErreurs, transformer, type Signaler } from "@/lib/saisie";

// Règles d'un avis de contravention et leurs messages, définis une seule fois.
// Reprises par l'écran de saisie, la lecture IA (phase 9) et la relève Gmail (phase 23).

export const STATUTS_AVIS = ["a_traiter", "a_valider", "designe", "classe"] as const;
export type StatutAvis = (typeof STATUTS_AVIS)[number];

export const LIBELLES_STATUT: Record<StatutAvis, string> = {
  a_traiter: "À traiter",
  a_valider: "À valider",
  designe: "Désigné",
  classe: "Classé",
};

/** Un avis ouvert attend encore la désignation : ni désigné, ni classé. Lui seul est concerné par son échéance. */
export function estOuvert(statut: StatutAvis): boolean {
  return statut === "a_traiter" || statut === "a_valider";
}

export const LONGUEUR_MAX_TEXTE_AVIS = 200;

// Espace insécable avant les deux-points : ils ne passent jamais seuls en début de ligne.
export const MESSAGES_AVIS = {
  ...MESSAGES_SAISIE,
  plaqueMalFormee: MESSAGES_FLOTTE.plaqueMalFormee,
  dateMalFormee: MESSAGES_FLOTTE.dateMalFormee,
  heureMalFormee: MESSAGES_FLOTTE.heureMalFormee,
  heureInexistante: MESSAGES_FLOTTE.heureInexistante,
  numeroMalForme: "Le n° d'avis compte 10 chiffres.",
  montantMalForme: "Montant mal formé : attendu un montant en euros, par exemple 135 ou 135,00.",
  envoiFutur: "La date d'envoi ne peut pas être dans le futur.",
  infractionApresEnvoi: "La date d'envoi ne peut pas précéder la date de l'infraction.",
  infractionSansHeure: "Saisissez aussi l'heure de l'infraction.",
  infractionSansDate: "Saisissez aussi la date de l'infraction.",
  avisIntrouvable: "Cet avis est introuvable.",
  avisExistant: "Cet avis existe déjà.",
  depotAbandonne: "Ce dépôt a été abandonné pour ne pas traiter deux fois le même avis.",

  // Fichier déposé
  formatRefuse: "Format non accepté : déposez un PDF, un JPG, un PNG ou un HEIC.",
  fichierTropLourd: "Fichier trop lourd : 10 Mo au maximum.",
  unSeulFichier: "Déposez un fichier à la fois : chaque fichier devient un avis.",
  conversionImpossible: "Cette photo HEIC n'a pas pu être convertie. Réessayez, ou déposez-la en JPG.",
  envoiImpossible: "L'envoi du fichier a échoué. Réessayez dans un instant.",
  fichierIntrouvable: "Le fichier n'a pas été reçu. Déposez-le à nouveau.",
} as const;

// Saisie

/** Les champs du formulaire, dans l'ordre de l'avis. La date et l'heure de l'infraction se saisissent à part. */
export const CHAMPS_AVIS = [
  "numero",
  "plaque",
  "infraction_date",
  "infraction_heure",
  "lieu",
  "infraction",
  "montant",
  "date_envoi",
] as const;
export type ChampAvis = (typeof CHAMPS_AVIS)[number];

/** Saisie brute, telle qu'elle vient du formulaire, de la lecture IA ou de la relève Gmail. */
export type SaisieAvis = Partial<Record<ChampAvis, string | null>>;
export type ErreursAvis = Partial<Record<ChampAvis | "general", string>>;

/** Un avis prêt à écrire : un instant ISO pour l'infraction, des centimes, une date ISO. Vide = `null`. */
export type DonneesAvis = {
  numero: string | null;
  plaque: string | null;
  infraction_le: string | null;
  lieu: string | null;
  infraction: string | null;
  montant_centimes: number | null;
  date_envoi: string | null;
};

/**
 * Champs à remplir pour qu'un avis passe « À valider » : la seule liste, lue par le statut dérivé et l'écran.
 * La date et l'heure de l'infraction forment un seul champ. Un champ lu en rouge doit aussi être confirmé.
 */
export const CHAMPS_REQUIS_AVIS = [
  "numero",
  "plaque",
  "infraction_le",
  "lieu",
  "infraction",
  "montant_centimes",
  "date_envoi",
] as const satisfies readonly (keyof DonneesAvis)[];
export type ChampRequisAvis = (typeof CHAMPS_REQUIS_AVIS)[number];

/** Libellés hors contexte, pour la liste des champs manquants. */
export const LIBELLES_CHAMP_AVIS: Record<ChampRequisAvis, string> = {
  numero: "N° d'avis",
  plaque: "Plaque",
  infraction_le: "Date et heure de l'infraction",
  lieu: "Lieu",
  infraction: "Infraction",
  montant_centimes: "Montant",
  date_envoi: "Date d'envoi",
};

/** Le champ requis que remplit chaque champ du formulaire : la date et l'heure donnent l'instant de l'infraction. */
export const CHAMP_REQUIS_DE: Record<ChampAvis, ChampRequisAvis> = {
  numero: "numero",
  plaque: "plaque",
  infraction_date: "infraction_le",
  infraction_heure: "infraction_le",
  lieu: "lieu",
  infraction: "infraction",
  montant: "montant_centimes",
  date_envoi: "date_envoi",
};

// Confiance de la lecture IA

/** Du plus sûr au moins sûr : vert, orange, rouge. Un champ rouge (« non lu ») se confirme à la main. */
export const NIVEAUX_CONFIANCE = ["sur", "a_verifier", "non_lu"] as const;
export type Confiance = (typeof NIVEAUX_CONFIANCE)[number];

/** Niveau de chaque champ lu par l'IA. Un champ absent a été saisi ou confirmé par le gestionnaire : aucun niveau. */
export type Confiances = Partial<Record<ChampRequisAvis, Confiance>>;

export const LIBELLES_CONFIANCE: Record<Confiance, string> = {
  sur: "Sûr",
  a_verifier: "À vérifier",
  non_lu: "Non lu",
};

/**
 * Une valeur lue sur l'avis, mais refusée par les règles de la saisie : le champ reste vide et rouge, et l'écran la
 * montre avec son motif, pour que le gestionnaire voie ce que l'IA a relevé.
 */
export type ValeurRefusee = { valeur: string; motif: string };
export type ValeursRefusees = Partial<Record<ChampRequisAvis, ValeurRefusee>>;

/** Une valeur refusée ne se montre que tant que son champ reste rouge : rempli par le gestionnaire, il la perd. */
export function valeursRefuseesApres(refusees: ValeursRefusees, confiances: Confiances): ValeursRefusees {
  return Object.fromEntries(
    Object.entries(refusees).filter(([champ]) => confiances[champ as ChampRequisAvis] === "non_lu"),
  );
}

/** Le moins sûr des deux niveaux : la date et l'heure de l'infraction n'en font qu'un. */
export function plusFaible(a: Confiance | undefined, b: Confiance): Confiance {
  return a && NIVEAUX_CONFIANCE.indexOf(a) > NIVEAUX_CONFIANCE.indexOf(b) ? a : b;
}

/** Un avis tel qu'il est en base, ou une saisie validée, avec les niveaux de sa lecture. */
type AvisAVerifier = Partial<Record<ChampRequisAvis, unknown>> & { confiances?: Confiances };

const estVide = (valeur: unknown) => valeur == null || valeur === "";

/** Champs lus en rouge, mais remplis : le gestionnaire les confirme, ou les corrige, avant « À valider ». */
export function champsAConfirmer(avis: AvisAVerifier): ChampRequisAvis[] {
  return CHAMPS_REQUIS_AVIS.filter((champ) => avis.confiances?.[champ] === "non_lu" && !estVide(avis[champ]));
}

/** Deux valeurs d'un champ requis : un instant se compare à la milliseconde, quel que soit son format. */
function memeValeur(champ: ChampRequisAvis, a: unknown, b: unknown) {
  if (champ === "infraction_le" && typeof a === "string" && typeof b === "string") {
    return new Date(a).getTime() === new Date(b).getTime();
  }
  return (a ?? null) === (b ?? null);
}

/**
 * Niveaux après un enregistrement : un champ dont la valeur change perd son niveau, comme un champ rouge confirmé.
 * Le gestionnaire en a alors répondu. Les autres champs gardent le niveau de la lecture.
 */
export function confiancesApres(
  confiances: Confiances,
  avant: Partial<Record<ChampRequisAvis, unknown>>,
  apres: DonneesAvis,
  confirmes: readonly ChampRequisAvis[] = [],
): Confiances {
  return Object.fromEntries(
    Object.entries(confiances).filter(([cle, niveau]) => {
      const champ = cle as ChampRequisAvis;
      const confirme = niveau === "non_lu" && confirmes.includes(champ);
      return !confirme && memeValeur(champ, avant[champ], apres[champ]);
    }),
  );
}

/** « 12 345 678 90 », « 1234-567-890 » → « 1234567890 ». Renvoie `null` hors de 10 chiffres. */
export function normaliserNumeroAvis(brut: string): string | null {
  const numero = brut.replace(SEPARATEURS, "");
  return /^\d{10}$/.test(numero) ? numero : null;
}

/** 999 999,99 € au plus : bien au-delà de toute amende forfaitaire, et loin des limites d'un entier en base. */
const MONTANT = /^(\d{1,6})(?:[.,](\d{1,2}))?$/;

/**
 * « 135 », « 135,00 », « 135.5 », « 1 234,50 € » → le montant en centimes.
 * Renvoie `null` si la forme ne convient pas, ou si le montant n'est pas strictement positif.
 */
export function lireMontant(brut: string): number | null {
  const morceaux = MONTANT.exec(brut.replace(/[\s€]+/g, ""));
  if (!morceaux) return null;
  const centimes = Number(morceaux[1]) * 100 + Number((morceaux[2] ?? "").padEnd(2, "0"));
  return centimes > 0 ? centimes : null;
}

/** Champ libre : rogné, vide → `null`. Les règles se vérifient ensemble, une fois tous les champs lus. */
const libre = z
  .string()
  .trim()
  .nullish()
  .transform((valeur) => valeur || null);

const objetAvis = z.object(Object.fromEntries(CHAMPS_AVIS.map((champ) => [champ, libre])) as Record<
  ChampAvis,
  typeof libre
>);

type SignalerAvis = Signaler<ChampAvis>;

function lireJour(brut: string, champ: ChampAvis, signaler: SignalerAvis): string | null {
  const lue = lireDate(brut);
  if ("iso" in lue) return lue.iso;
  signaler(champ, lue.erreur);
  return null;
}

function lireTexte(brut: string | null, champ: ChampAvis, signaler: SignalerAvis): string | null {
  if (brut && brut.length > LONGUEUR_MAX_TEXTE_AVIS) signaler(champ, MESSAGES_AVIS.tropLong(LONGUEUR_MAX_TEXTE_AVIS));
  return brut;
}

/** Date et heure de l'infraction : elles vont ensemble. `null` si elles sont vides ou fautives (déjà signalé). */
function lireInfraction(saisie: { infraction_date: string | null; infraction_heure: string | null }, signaler: SignalerAvis) {
  const jour = saisie.infraction_date && lireJour(saisie.infraction_date, "infraction_date", signaler);
  const heure = saisie.infraction_heure && normaliserHeure(saisie.infraction_heure);
  if (saisie.infraction_heure && !heure) signaler("infraction_heure", MESSAGES_AVIS.heureMalFormee);
  if (saisie.infraction_date && !saisie.infraction_heure) signaler("infraction_heure", MESSAGES_AVIS.infractionSansHeure);
  if (saisie.infraction_heure && !saisie.infraction_date) signaler("infraction_date", MESSAGES_AVIS.infractionSansDate);
  if (!jour || !heure) return null;
  const instant = instantParis(jour, heure);
  if (!instant) signaler("infraction_heure", MESSAGES_AVIS.heureInexistante);
  return instant;
}

/**
 * Une saisie partielle s'enregistre : un champ vide donne `null`, mais tout champ rempli doit être valide.
 * La date d'envoi n'est pas dans le futur, et ne précède pas le jour (à Paris) de l'infraction.
 */
export const schemaAvis = objetAvis.transform(
  transformer((saisie: z.output<typeof objetAvis>, signaler: SignalerAvis): DonneesAvis => {
    const numero = saisie.numero && normaliserNumeroAvis(saisie.numero);
    if (saisie.numero && !numero) signaler("numero", MESSAGES_AVIS.numeroMalForme);

    const plaque = saisie.plaque && normaliserPlaque(saisie.plaque);
    if (saisie.plaque && !plaque) signaler("plaque", MESSAGES_AVIS.plaqueMalFormee);

    const infraction_le = lireInfraction(saisie, signaler);
    const lieu = lireTexte(saisie.lieu, "lieu", signaler);
    const infraction = lireTexte(saisie.infraction, "infraction", signaler);

    const montant_centimes = saisie.montant ? lireMontant(saisie.montant) : null;
    if (saisie.montant && !montant_centimes) signaler("montant", MESSAGES_AVIS.montantMalForme);

    const date_envoi = saisie.date_envoi && lireJour(saisie.date_envoi, "date_envoi", signaler);
    if (date_envoi && date_envoi > aujourdhuiParis()) signaler("date_envoi", MESSAGES_AVIS.envoiFutur);
    else if (date_envoi && infraction_le && partiesParis(infraction_le).date > date_envoi) {
      signaler("date_envoi", MESSAGES_AVIS.infractionApresEnvoi);
    }

    // Lues seulement si rien n'a été signalé : chaque valeur est alors normalisée, ou vide.
    return {
      numero: numero || null,
      plaque: plaque || null,
      infraction_le,
      lieu,
      infraction,
      montant_centimes,
      date_envoi: date_envoi || null,
    };
  }),
);

/** Contrôle « dès la saisie » : les mêmes règles et les mêmes messages que l'enregistrement. */
export function verifierSaisieAvis(saisie: SaisieAvis): ErreursAvis {
  const valide = schemaAvis.safeParse(saisie);
  return valide.success ? {} : premieresErreurs<ChampAvis>(valide.error);
}

/** Champs requis encore vides, dans l'ordre de l'avis : d'un avis en base ou d'une saisie validée. */
export function champsManquantsAvis(avis: Partial<Record<ChampRequisAvis, unknown>>): ChampRequisAvis[] {
  return CHAMPS_REQUIS_AVIS.filter((champ) => estVide(avis[champ]));
}

/**
 * « À valider » quand rien ne manque et qu'aucun champ rouge n'attend sa confirmation, sinon « À traiter » :
 * dans les deux sens, recalculé à chaque enregistrement.
 */
export function statutDerive(avis: AvisAVerifier): Extract<StatutAvis, "a_traiter" | "a_valider"> {
  return champsManquantsAvis(avis).length || champsAConfirmer(avis).length ? "a_traiter" : "a_valider";
}

export const schemaIdAvis = z.uuid();

// Fichier déposé

export const TAILLE_MAX_FICHIER = 10 * 1024 * 1024;

export type FormatFichier = "pdf" | "jpeg" | "png" | "heic";
/** Ce qui est stocké : le HEIC est converti en JPEG dans le navigateur, avant l'envoi. */
export type FormatStocke = Exclude<FormatFichier, "heic">;

export const TYPES_STOCKES: Record<FormatStocke, string> = {
  pdf: "application/pdf",
  jpeg: "image/jpeg",
  png: "image/png",
};

export const EXTENSIONS_STOCKEES: Record<FormatStocke, string> = { pdf: "pdf", jpeg: "jpg", png: "png" };

/** Ce que propose le sélecteur de fichier : les types et les extensions, pour les systèmes qui ignorent l'un ou l'autre. */
export const FICHIERS_ACCEPTES =
  "application/pdf,image/jpeg,image/png,image/heic,image/heif,.pdf,.jpg,.jpeg,.png,.heic,.heif";

const PAR_TYPE: Record<string, FormatFichier> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/heic": "heic",
  "image/heif": "heic",
};

const PAR_EXTENSION: Record<string, FormatFichier> = {
  pdf: "pdf",
  jpg: "jpeg",
  jpeg: "jpeg",
  png: "png",
  heic: "heic",
  heif: "heic",
};

/** Types que donne un système qui ne reconnaît pas le fichier : seule l'extension renseigne alors. */
const TYPES_INCONNUS = ["", "application/octet-stream"];

/**
 * Le format d'un fichier déposé, d'après son type, sinon son extension : Chrome ou Windows laissent
 * parfois le type d'un HEIC vide. Renvoie `null` pour un format non accepté.
 */
export function typeFichier({ type, name }: { type: string; name: string }): FormatFichier | null {
  const parType = PAR_TYPE[type.toLowerCase()];
  if (parType || !TYPES_INCONNUS.includes(type.toLowerCase())) return parType ?? null;
  const extension = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "";
  return PAR_EXTENSION[extension] ?? null;
}

/**
 * Contrôle d'un dépôt avant l'envoi : un seul fichier, d'un format accepté, de 10 Mo au plus.
 * Sans fichier (sélection annulée), l'appelant ne fait rien.
 */
export function verifierDepot(
  fichiers: readonly { type: string; name: string; size: number }[],
): { ok: true; format: FormatFichier } | { ok: false; erreur: string } {
  if (fichiers.length !== 1) return { ok: false, erreur: MESSAGES_AVIS.unSeulFichier };
  const [fichier] = fichiers;
  const format = typeFichier(fichier);
  if (!format) return { ok: false, erreur: MESSAGES_AVIS.formatRefuse };
  if (fichier.size > TAILLE_MAX_FICHIER) return { ok: false, erreur: MESSAGES_AVIS.fichierTropLourd };
  return { ok: true, format };
}
