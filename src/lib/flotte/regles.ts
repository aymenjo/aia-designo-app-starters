import { z } from "zod";
import { LIMITES_FREE } from "@/lib/abonnement/plans";
import {
  ajouterAnnees,
  aujourdhuiParis,
  depuisIso,
  instantParis,
  normaliserDate,
  normaliserHeure,
  partiesParis,
  versIso,
} from "@/lib/dates";
import { formaterJourHeure } from "@/lib/format";
import {
  MESSAGES_SAISIE,
  normalise,
  normaliserCodePostal,
  premieresErreurs,
  texte,
  transformer,
  type Signaler as SignalerChamp,
} from "@/lib/saisie";

// Règles d'écriture de la flotte et leurs messages, définis une seule fois.
// Reprises par les écrans, l'import CSV (phase 6), la création depuis un avis (phase 13) et l'agent.

export const TYPES_VEHICULE = ["attitre", "pool"] as const;
export type TypeVehicule = (typeof TYPES_VEHICULE)[number];

export const LIBELLES_TYPE: Record<TypeVehicule, string> = {
  attitre: "Attitré",
  pool: "Pool",
};

export const LONGUEUR_MAX_MODELE = 80;

export const MESSAGES = {
  ...MESSAGES_SAISIE,
  plaqueVide: "Saisissez la plaque d'immatriculation.",
  plaqueMalFormee: "Plaque mal formée : attendu AB-123-CD ou 123 ABC 45.",
  plaqueDejaPresente: (plaque: string) => `La plaque ${plaque} est déjà dans votre flotte.`,
  plaqueArchivee: (plaque: string) => `${plaque} appartient à un véhicule archivé.`,
  typeVide: "Choisissez le type du véhicule : attitré ou pool.",
  modeleTropLong: `Le modèle ne doit pas dépasser ${LONGUEUR_MAX_MODELE} caractères.`,
  vehiculeIntrouvable: "Ce véhicule est introuvable.",
  // Plan Free (phase 17) : la base refuse le 4e véhicule actif (ERREUR_LIMITE_VEHICULES).
  limiteVehicules: `Plan Free : ${LIMITES_FREE.vehicules} véhicules actifs au plus. Archivez-en un, ou passez en Pro pour une flotte illimitée.`,
  limiteVehiculesReactivation: `Plan Free : ${LIMITES_FREE.vehicules} véhicules actifs au plus. Archivez-en un autre pour réactiver celui-ci, ou passez en Pro.`,

  // Conducteurs. Espace insécable avant les deux-points : ils ne passent jamais seuls en début de ligne.
  civiliteInconnue: "Choisissez la civilité : M. ou Mme.",
  prenomVide: "Saisissez le prénom.",
  nomVide: "Saisissez le nom.",
  dateMalFormee: "Date mal formée : attendu JJ/MM/AAAA.",
  dateInexistante: (date: string) => `Le ${date} n'existe pas.`,
  naissanceFuture: "La date de naissance ne peut pas être dans le futur.",
  naissanceTropAncienne: "La date de naissance ne peut pas précéder le 01/01/1900.",
  delivranceFuture: "La date de délivrance ne peut pas être dans le futur.",
  delivranceTropTot: "Le permis ne peut pas avoir été délivré avant les 14 ans du conducteur.",
  permisMalForme: "N° de permis mal formé : attendu des chiffres et des lettres, 20 au plus.",
  categorieInconnue: (categorie: string) =>
    `Catégorie inconnue : ${categorie}. Attendu, par exemple : B, C1, CE.`,
  emailMalForme: "Email mal formé : attendu nom@domaine.fr.",
  permisDejaPresent: (nom: string) => `Ce n° de permis est déjà celui de ${nom}.`,
  emailDejaPresent: (nom: string) => `Cet email est déjà celui de ${nom}.`,
  permisArchive: (nom: string) => `Ce n° de permis appartient à ${nom}, conducteur archivé.`,
  emailArchive: (nom: string) => `Cet email appartient à ${nom}, conducteur archivé.`,
  conducteurIntrouvable: "Ce conducteur est introuvable.",
  vehiculeAvecHistorique: "Ce véhicule a un historique : archivez-le plutôt.",
  conducteurAvecHistorique: "Ce conducteur a un historique : archivez-le plutôt.",

  // Affectations
  vehiculeVide: "Choisissez le véhicule.",
  conducteurVide: "Choisissez le conducteur.",
  debutVide: "Saisissez la date de début.",
  heureMalFormee: "Heure mal formée : attendu HH:MM, par exemple 08:30.",
  heureInexistante: "Cette heure n'existe pas : ce jour-là, on passe de 02:00 à 03:00 (heure d'été).",
  finVide: "Saisissez la date et l'heure de fin.",
  finSansDate: "Saisissez aussi la date de fin.",
  finSansHeure: "Saisissez aussi l'heure de fin.",
  finPoolObligatoire: "Fin obligatoire : un véhicule de pool a toujours une date et une heure de fin.",
  finAvantDebut: "La fin doit être après le début.",
  conflitAffectation: (nom: string, plaque: string, debut: string, fin: string | null) =>
    `Conflit avec : ${nom} sur ${plaque} ` +
    (fin ? `du ${formaterJourHeure(debut)} au ${formaterJourHeure(fin)}.` : `à partir du ${formaterJourHeure(debut)}.`),
  conflitAffectationInconnu: "Ce créneau chevauche une autre affectation de ce véhicule.",
  vehiculeArchiveAffectation: (plaque: string) => `${plaque} est archivé : réactivez-le pour l'affecter.`,
  conducteurArchiveAffectation: (nom: string) => `${nom} est archivé : réactivez-le pour l'affecter.`,
  affectationIntrouvable: "Cette affectation est introuvable.",
  affectationDejaCloturee: "Cette affectation est déjà clôturée.",
  affectationArchivee:
    "Le véhicule ou le conducteur de cette affectation est archivé : réactivez-le pour la modifier.",
  affectationEnCours: (nom: string, plaque: string) => `Clôturez d'abord l'affectation de ${nom} sur ${plaque}.`,
  poolAvecAffectationOuverte: (nom: string) =>
    `Clôturez d'abord l'affectation de ${nom} : un véhicule de pool n'a que des affectations avec une fin.`,
} as const;

/** Le message du trigger qui refuse un véhicule actif de trop en Free (migration du plan Free). */
export const ERREUR_LIMITE_VEHICULES = "limite_vehicules_free";

// SIV (depuis 2009) : ni I, ni O, ni U, et jamais le bloc 000.
const SIV = /^([A-HJ-NP-TV-Z]{2})(\d{3})([A-HJ-NP-TV-Z]{2})$/;
// FNI (ancien format) : 1 à 4 chiffres, 1 à 3 lettres, puis le département.
const FNI = /^(\d{1,4})([A-Z]{1,3})(0[1-9]|[1-8]\d|9[0-5]|2A|2B|97[1-6])$/;

/**
 * « ab 123 cd » → « AB-123-CD », « 123 abc 45 » → « 123-ABC-45 ».
 * Renvoie `null` si la plaque n'est ni au format SIV ni au format FNI.
 */
export function normaliserPlaque(brut: string): string | null {
  const compacte = brut.replace(/[\s-]+/g, "").toUpperCase();
  const siv = SIV.exec(compacte);
  if (siv) return siv[2] === "000" ? null : `${siv[1]}-${siv[2]}-${siv[3]}`;
  const fni = FNI.exec(compacte);
  return fni ? `${fni[1]}-${fni[2]}-${fni[3]}` : null;
}

export const schemaPlaque = z
  .string({ error: MESSAGES.plaqueVide })
  .trim()
  .min(1, { error: MESSAGES.plaqueVide })
  .transform((brut, ctx) => {
    const plaque = normaliserPlaque(brut);
    if (!plaque) {
      ctx.addIssue(MESSAGES.plaqueMalFormee);
      return z.NEVER;
    }
    return plaque;
  });

export const schemaVehicule = z.object({
  plaque: schemaPlaque,
  modele: z
    .string()
    .trim()
    .max(LONGUEUR_MAX_MODELE, { error: MESSAGES.modeleTropLong })
    .nullish()
    .transform((modele) => modele || null),
  type: z.enum(TYPES_VEHICULE, { error: MESSAGES.typeVide }),
});

export type ChampVehicule = keyof z.input<typeof schemaVehicule>;
/** Saisie brute, telle qu'elle vient d'un formulaire, d'une ligne CSV ou de l'agent. */
export type SaisieVehicule = Partial<Record<ChampVehicule, string | null>>;
export type ErreursVehicule = Partial<Record<ChampVehicule | "general", string>>;

export const schemaIdVehicule = z.uuid();

// Conducteurs

export const CIVILITES = ["m", "mme"] as const;
export type Civilite = (typeof CIVILITES)[number];

export const LIBELLES_CIVILITE: Record<Civilite, string> = { m: "M.", mme: "Mme" };

/** Les champs de la fiche conducteur, dans l'ordre de la fiche. */
export const CHAMPS_CONDUCTEUR = [
  "civilite",
  "prenom",
  "nom",
  "date_naissance",
  "lieu_naissance",
  "adresse",
  "adresse_complement",
  "code_postal",
  "ville",
  "permis_numero",
  "permis_delivre_le",
  "permis_categories",
  "email",
] as const;
export type ChampConducteur = (typeof CHAMPS_CONDUCTEUR)[number];

/**
 * Champs à remplir pour une fiche complète : la seule liste, lue par le badge, la liste des conducteurs
 * et le récap ANTAI (phase 11). L'email n'en fait pas partie.
 * Risque ANTAI : si le formulaire de désignation exige le lieu de naissance ou les catégories de permis,
 * il suffit de les ajouter ici.
 */
export const CHAMPS_REQUIS_CONDUCTEUR: readonly ChampConducteur[] = [
  "civilite",
  "prenom",
  "nom",
  "date_naissance",
  "adresse",
  "code_postal",
  "ville",
  "permis_numero",
  "permis_delivre_le",
];

/** Libellés hors contexte, pour la liste des champs manquants. */
export const LIBELLES_CHAMP_CONDUCTEUR: Record<ChampConducteur, string> = {
  civilite: "Civilité",
  prenom: "Prénom",
  nom: "Nom",
  date_naissance: "Date de naissance",
  lieu_naissance: "Lieu de naissance",
  adresse: "Adresse",
  adresse_complement: "Complément d'adresse",
  code_postal: "Code postal",
  ville: "Ville",
  permis_numero: "N° de permis",
  permis_delivre_le: "Date de délivrance du permis",
  permis_categories: "Catégories de permis",
  email: "Email",
};

export const LONGUEURS_MAX_CONDUCTEUR = {
  prenom: 80,
  nom: 80,
  lieu_naissance: 80,
  adresse: 120,
  adresse_complement: 120,
  ville: 80,
} as const;

/** Catégories du permis, dans l'ordre de la directive européenne 2006/126/CE. */
export const CATEGORIES_PERMIS = [
  "AM",
  "A1",
  "A2",
  "A",
  "B1",
  "B",
  "BE",
  "C1",
  "C1E",
  "C",
  "CE",
  "D1",
  "D1E",
  "D",
  "DE",
] as const;
export type CategoriePermis = (typeof CATEGORIES_PERMIS)[number];

const NAISSANCE_MIN = "1900-01-01";
/** Le permis le plus précoce (AM) se passe à 14 ans. */
const AGE_MIN_PERMIS = 14;

function estCivilite(brut: string): brut is Civilite {
  return (CIVILITES as readonly string[]).includes(brut);
}

/** « 12 34-56 78 9012 » → « 123456789012 ». Renvoie `null` hors de 1 à 20 lettres et chiffres. */
export function normaliserPermis(brut: string): string | null {
  const permis = brut.replace(/[\s-]+/g, "").toUpperCase();
  return /^[A-Z0-9]{1,20}$/.test(permis) ? permis : null;
}

/**
 * « b, c1 b » → B et C1, dans l'ordre officiel et sans doublon.
 * Renvoie la première catégorie inconnue si l'une d'elles n'existe pas.
 */
export function normaliserCategories(
  brut: string,
): { ok: true; categories: CategoriePermis[] } | { ok: false; inconnue: string } {
  const saisies = brut.toUpperCase().split(/[\s,;/]+/).filter(Boolean);
  const inconnue = saisies.find((categorie) => !(CATEGORIES_PERMIS as readonly string[]).includes(categorie));
  if (inconnue) return { ok: false, inconnue };
  return { ok: true, categories: CATEGORIES_PERMIS.filter((categorie) => saisies.includes(categorie)) };
}

const EMAIL = z.email();

/** « Nom@Exemple.FR » → « nom@exemple.fr ». Renvoie `null` si ce n'est pas une adresse email. */
export function normaliserEmail(brut: string): string | null {
  const email = brut.trim().toLowerCase();
  return email.length <= 254 && EMAIL.safeParse(email).success ? email : null;
}

/** Date saisie JJ/MM/AAAA → l'ISO, ou le message de la règle enfreinte. Reprise par les avis. */
export function lireDate(brut: string): { iso: string } | { erreur: string } {
  const jjmmaaaa = normaliserDate(brut);
  if (!jjmmaaaa) return { erreur: MESSAGES.dateMalFormee };
  const iso = versIso(jjmmaaaa);
  return iso ? { iso } : { erreur: MESSAGES.dateInexistante(jjmmaaaa) };
}

/** Date facultative saisie JJ/MM/AAAA : vide → `null`, sinon l'ISO, ou le message de la première règle enfreinte. */
const date = (verifier: (iso: string) => string | null) =>
  z
    .string()
    .trim()
    .nullish()
    .transform((brut, ctx) => {
      if (!brut) return null;
      const lue = lireDate(brut);
      if ("iso" in lue) {
        const erreur = verifier(lue.iso);
        if (!erreur) return lue.iso;
        ctx.addIssue(erreur);
      } else ctx.addIssue(lue.erreur);
      return z.NEVER;
    });

const requis = (max: number, vide: string) =>
  z
    .string({ error: vide })
    .trim()
    .min(1, { error: vide })
    .max(max, { error: MESSAGES.tropLong(max) });

const objetConducteur = z.object({
  civilite: normalise((brut) => (estCivilite(brut) ? brut : null), MESSAGES.civiliteInconnue),
  prenom: requis(LONGUEURS_MAX_CONDUCTEUR.prenom, MESSAGES.prenomVide),
  nom: requis(LONGUEURS_MAX_CONDUCTEUR.nom, MESSAGES.nomVide),
  date_naissance: date((iso) =>
    iso < NAISSANCE_MIN ? MESSAGES.naissanceTropAncienne : iso > aujourdhuiParis() ? MESSAGES.naissanceFuture : null,
  ),
  lieu_naissance: texte(LONGUEURS_MAX_CONDUCTEUR.lieu_naissance),
  adresse: texte(LONGUEURS_MAX_CONDUCTEUR.adresse),
  adresse_complement: texte(LONGUEURS_MAX_CONDUCTEUR.adresse_complement),
  code_postal: normalise(normaliserCodePostal, MESSAGES.codePostalMalForme),
  ville: texte(LONGUEURS_MAX_CONDUCTEUR.ville),
  permis_numero: normalise(normaliserPermis, MESSAGES.permisMalForme),
  permis_delivre_le: date((iso) => (iso > aujourdhuiParis() ? MESSAGES.delivranceFuture : null)),
  permis_categories: z
    .string()
    .nullish()
    .transform((brut, ctx) => {
      const resultat = normaliserCategories(brut ?? "");
      if (!resultat.ok) {
        ctx.addIssue(MESSAGES.categorieInconnue(resultat.inconnue));
        return z.NEVER;
      }
      return resultat.categories.length ? resultat.categories : null;
    }),
  email: normalise(normaliserEmail, MESSAGES.emailMalForme),
});

type FicheConducteur = z.output<typeof objetConducteur>;

/** La délivrance se compare à la naissance une fois les deux dates valides, même si un autre champ est en erreur. */
const datesValides = ({ issues }: { issues: readonly { path?: readonly PropertyKey[] }[] }) =>
  issues.every((issue) => issue.path?.[0] !== "date_naissance" && issue.path?.[0] !== "permis_delivre_le");

/**
 * Une fiche incomplète s'enregistre (le prénom et le nom suffisent), mais tout champ rempli doit être valide.
 * Reprise par les écrans, l'import CSV (phase 6) et l'agent.
 */
export const schemaConducteur = objetConducteur.refine(
  ({ date_naissance, permis_delivre_le }: FicheConducteur) =>
    !date_naissance || !permis_delivre_le || permis_delivre_le >= ajouterAnnees(date_naissance, AGE_MIN_PERMIS),
  { path: ["permis_delivre_le"], when: datesValides, error: MESSAGES.delivranceTropTot },
);

/** Saisie brute, telle qu'elle vient d'un formulaire, d'une ligne CSV ou de l'agent. */
export type SaisieConducteur = Partial<Record<ChampConducteur, string | null>>;
export type ErreursConducteur = Partial<Record<ChampConducteur | "general", string>>;

/** Contrôle « dès la saisie » : les mêmes règles et les mêmes messages que l'enregistrement. */
export function verifierSaisieConducteur(saisie: SaisieConducteur): ErreursConducteur {
  const valide = schemaConducteur.safeParse(saisie);
  return valide.success ? {} : premieresErreurs<ChampConducteur>(valide.error);
}

const estVide = (valeur: unknown) =>
  valeur == null || (typeof valeur === "string" ? !valeur.trim() : Array.isArray(valeur) && !valeur.length);

/**
 * Champs requis encore vides, dans l'ordre de la fiche : d'une fiche en base ou d'une saisie.
 * `requis` ne sert qu'à prouver qu'il suffit de modifier la liste pour changer le badge.
 */
export function champsManquantsConducteur(
  fiche: Partial<Record<ChampConducteur, unknown>>,
  requis: readonly ChampConducteur[] = CHAMPS_REQUIS_CONDUCTEUR,
): ChampConducteur[] {
  return CHAMPS_CONDUCTEUR.filter((champ) => requis.includes(champ) && estVide(fiche[champ]));
}

/** « Karim Benali » : prénom puis nom, comme dans la liste. */
export function nomComplet({ prenom, nom }: { prenom: string; nom: string }) {
  return `${prenom} ${nom}`;
}

export const schemaIdConducteur = z.uuid();

/** « Karim B. » : le prénom et l'initiale du nom, comme dans le message de conflit et le planning. */
export function nomAbrege({ prenom, nom }: { prenom: string; nom: string }) {
  return `${prenom} ${nom.trim().charAt(0).toUpperCase()}.`;
}

// Affectations

/** Les champs du formulaire d'affectation. Début et fin se saisissent en date + heure, à l'heure de Paris. */
export const CHAMPS_AFFECTATION = [
  "vehicule_id",
  "conducteur_id",
  "debut_date",
  "debut_heure",
  "fin_date",
  "fin_heure",
] as const;
export type ChampAffectation = (typeof CHAMPS_AFFECTATION)[number];

/** Saisie brute, telle qu'elle vient d'un formulaire, d'une ligne CSV ou de l'agent. */
export type SaisieAffectation = Partial<Record<ChampAffectation, string | null>>;
export type ErreursAffectation = Partial<Record<ChampAffectation | "general", string>>;

/** Une affectation prête à écrire : des instants ISO. Une fin vide = le conducteur garde le véhicule. */
export type DonneesAffectation = { vehicule_id: string; conducteur_id: string; debut: string; fin: string | null };

/** Champ libre : rogné, vide → `null`. Les règles se vérifient ensemble, une fois tous les champs lus. */
const libre = z
  .string()
  .trim()
  .nullish()
  .transform((valeur) => valeur || null);

type Signaler = SignalerChamp<ChampAffectation>;

function lireJour(brut: string, champ: ChampAffectation, signaler: Signaler): string | null {
  const lue = lireDate(brut);
  if ("iso" in lue) return lue.iso;
  signaler(champ, lue.erreur);
  return null;
}

function lireHeure(brut: string, champ: ChampAffectation, signaler: Signaler): string | null {
  const heure = normaliserHeure(brut);
  if (!heure) signaler(champ, MESSAGES.heureMalFormee);
  return heure;
}

function lireInstant(jour: string | null, heure: string | null, champHeure: ChampAffectation, signaler: Signaler) {
  if (!jour || !heure) return null;
  const instant = instantParis(jour, heure);
  if (!instant) signaler(champHeure, MESSAGES.heureInexistante);
  return instant;
}

/** Fin saisie : sa date et son heure vont ensemble. `null` si elle est vide ou fautive (déjà signalée). */
function lireFin(saisie: { fin_date: string | null; fin_heure: string | null }, signaler: Signaler) {
  const jour = saisie.fin_date && lireJour(saisie.fin_date, "fin_date", signaler);
  const heure = saisie.fin_heure && lireHeure(saisie.fin_heure, "fin_heure", signaler);
  if (saisie.fin_date && !saisie.fin_heure) signaler("fin_heure", MESSAGES.finSansHeure);
  if (saisie.fin_heure && !saisie.fin_date) signaler("fin_date", MESSAGES.finSansDate);
  return lireInstant(jour || null, heure || null, "fin_heure", signaler);
}

function lireId(brut: string | null, champ: ChampAffectation, vide: string, introuvable: string, signaler: Signaler) {
  if (brut && z.uuid().safeParse(brut).success) return brut;
  signaler(champ, brut ? introuvable : vide);
  return null;
}

const objetAffectation = z.object({
  vehicule_id: libre,
  conducteur_id: libre,
  debut_date: libre,
  debut_heure: libre,
  fin_date: libre,
  fin_heure: libre,
});

/**
 * Règles d'une affectation, sur le type du véhicule choisi quand il est connu : véhicule et conducteur choisis,
 * date de début requise (heure vide = 00:00), fin en date + heure, obligatoire sur un véhicule de pool, après le début.
 * Reprises par les écrans, l'import CSV (phase 6) et l'agent.
 */
export function schemaAffectation(type?: TypeVehicule) {
  return objetAffectation.transform(
    transformer((saisie: z.output<typeof objetAffectation>, signaler: Signaler): DonneesAffectation => {
      const vehicule_id = lireId(
        saisie.vehicule_id,
        "vehicule_id",
        MESSAGES.vehiculeVide,
        MESSAGES.vehiculeIntrouvable,
        signaler,
      );
      const conducteur_id = lireId(
        saisie.conducteur_id,
        "conducteur_id",
        MESSAGES.conducteurVide,
        MESSAGES.conducteurIntrouvable,
        signaler,
      );

      if (!saisie.debut_date) signaler("debut_date", MESSAGES.debutVide);
      const jour = saisie.debut_date && lireJour(saisie.debut_date, "debut_date", signaler);
      const heure = saisie.debut_heure ? lireHeure(saisie.debut_heure, "debut_heure", signaler) : "00:00";
      const debut = lireInstant(jour || null, heure, "debut_heure", signaler);

      const fin = lireFin(saisie, signaler);
      if (type === "pool" && !saisie.fin_date && !saisie.fin_heure) signaler("fin_date", MESSAGES.finPoolObligatoire);
      if (debut && fin && Date.parse(fin) <= Date.parse(debut)) signaler("fin_date", MESSAGES.finAvantDebut);

      // Lues seulement si rien n'a été signalé : chaque valeur est alors remplie.
      return { vehicule_id: vehicule_id!, conducteur_id: conducteur_id!, debut: debut!, fin };
    }),
  );
}

/**
 * L'inverse de `schemaAffectation` : une affectation prête à écrire, rendue en saisie (JJ/MM/AAAA et HH:MM à Paris).
 * Une affectation calculée, comme l'affectation manquante d'un avis, repasse ainsi par toutes les règles de la saisie.
 */
export function saisieAffectation({ vehicule_id, conducteur_id, debut, fin }: DonneesAffectation): SaisieAffectation {
  const depart = partiesParis(debut);
  const arrivee = fin ? partiesParis(fin) : null;
  return {
    vehicule_id,
    conducteur_id,
    debut_date: depuisIso(depart.date),
    debut_heure: depart.heure,
    fin_date: arrivee ? depuisIso(arrivee.date) : null,
    fin_heure: arrivee?.heure ?? null,
  };
}

/** Contrôle « dès la saisie » : les mêmes règles et les mêmes messages que l'enregistrement. */
export function verifierSaisieAffectation(saisie: SaisieAffectation, type?: TypeVehicule): ErreursAffectation {
  const valide = schemaAffectation(type).safeParse(saisie);
  return valide.success ? {} : premieresErreurs<ChampAffectation>(valide.error);
}

export type ChampCloture = Extract<ChampAffectation, "fin_date" | "fin_heure">;
export type SaisieCloture = Partial<Record<ChampCloture, string | null>>;

const objetCloture = z.object({ fin_date: libre, fin_heure: libre });

/** Clôturer une affectation ouverte : la fin est requise, en date + heure, après le début (instant ISO). */
export function schemaCloture(debut: string) {
  return objetCloture.transform(
    transformer((saisie: z.output<typeof objetCloture>, signaler: Signaler): string => {
      if (!saisie.fin_date && !saisie.fin_heure) signaler("fin_date", MESSAGES.finVide);
      const fin = lireFin(saisie, signaler);
      if (fin && Date.parse(fin) <= Date.parse(debut)) signaler("fin_date", MESSAGES.finAvantDebut);
      // Lue seulement si rien n'a été signalé : la fin est alors remplie.
      return fin!;
    }),
  );
}

/** Contrôle « dès la saisie » de la clôture, avec les messages de l'enregistrement. */
export function verifierSaisieCloture(saisie: SaisieCloture, debut: string): ErreursAffectation {
  const valide = schemaCloture(debut).safeParse(saisie);
  return valide.success ? {} : premieresErreurs<ChampCloture>(valide.error);
}

export const schemaIdAffectation = z.uuid();
