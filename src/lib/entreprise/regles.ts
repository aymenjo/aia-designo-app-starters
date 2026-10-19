import { z } from "zod";
import { MESSAGES_SAISIE, SEPARATEURS, normalise, normaliserCodePostal, premieresErreurs, texte } from "@/lib/saisie";

// Règles de la fiche entreprise et leurs messages, définis une seule fois.
// Reprises par l'écran, le récap ANTAI (phase 11) et le passage en Pro (phase 18).

export const CHAMPS_ENTREPRISE = [
  "raison_sociale",
  "siren",
  "tva",
  "representant_prenom",
  "representant_nom",
  "representant_fonction",
  "siege_adresse",
  "siege_complement",
  "siege_code_postal",
  "siege_ville",
] as const;
export type ChampEntreprise = (typeof CHAMPS_ENTREPRISE)[number];

/** Champs à remplir pour une fiche complète : la seule liste, lue par le badge, le récap et le passage en Pro. */
export const CHAMPS_REQUIS: readonly ChampEntreprise[] = CHAMPS_ENTREPRISE.filter(
  (champ) => champ !== "siege_complement",
);

/** Libellés hors contexte, pour la liste des champs manquants. */
export const LIBELLES_CHAMP: Record<ChampEntreprise, string> = {
  raison_sociale: "Raison sociale",
  siren: "SIREN",
  tva: "N° de TVA",
  representant_prenom: "Prénom du représentant légal",
  representant_nom: "Nom du représentant légal",
  representant_fonction: "Fonction du représentant légal",
  siege_adresse: "Adresse du siège",
  siege_complement: "Complément d'adresse du siège",
  siege_code_postal: "Code postal du siège",
  siege_ville: "Ville du siège",
};

export const LONGUEURS_MAX = {
  raison_sociale: 120,
  representant_prenom: 80,
  representant_nom: 80,
  representant_fonction: 80,
  siege_adresse: 120,
  siege_complement: 120,
  siege_ville: 80,
} as const;

export const FONCTIONS_SUGGEREES = ["Gérant", "Président", "Directeur général"] as const;

// Espace insécable avant les deux-points : ils ne passent jamais seuls en début de ligne.
export const MESSAGES = {
  ...MESSAGES_SAISIE,
  sirenMalForme: "SIREN mal formé : attendu 9 chiffres.",
  sirenInvalide: "SIREN invalide : l'un des 9 chiffres est sans doute erroné.",
  tvaMalFormee: "N° de TVA mal formé : attendu FR suivi de 11 chiffres.",
  tvaInvalide: "N° de TVA invalide : la clé (les 2 chiffres après FR) ne correspond pas.",
  tvaIncoherente: (attendue: string) => `Ce n° de TVA ne correspond pas au SIREN. Attendu : ${attendue}.`,
} as const;

/** « 404 833 048 » → « 404833048 ». Renvoie `null` si ce ne sont pas exactement 9 chiffres. */
export function normaliserSiren(brut: string): string | null {
  const siren = brut.replace(SEPARATEURS, "");
  return /^\d{9}$/.test(siren) ? siren : null;
}

/** Clé de Luhn du SIREN, comme l'INSEE. 000000000 la vérifie, mais n'est attribué à personne. */
export function sirenValide(siren: string): boolean {
  if (!/^\d{9}$/.test(siren) || siren === "000000000") return false;
  let somme = 0;
  for (let rang = 0; rang < 9; rang++) {
    let chiffre = Number(siren[8 - rang]);
    if (rang % 2 === 1) {
      chiffre *= 2;
      if (chiffre > 9) chiffre -= 9;
    }
    somme += chiffre;
  }
  return somme % 10 === 0;
}

/** N° de TVA intracommunautaire d'un SIREN : FR, la clé (12 + 3 × (SIREN mod 97)) mod 97, puis le SIREN. */
export function tvaDepuisSiren(siren: string): string {
  const cle = (12 + 3 * (Number(siren) % 97)) % 97;
  return `FR${String(cle).padStart(2, "0")}${siren}`;
}

/** « fr 83 404 833 048 » → « FR83404833048 ». Renvoie `null` si ce n'est pas FR suivi de 11 chiffres. */
export function normaliserTva(brut: string): string | null {
  const tva = brut.replace(SEPARATEURS, "").toUpperCase();
  return /^FR\d{11}$/.test(tva) ? tva : null;
}

const objetEntreprise = z.object({
  raison_sociale: texte(LONGUEURS_MAX.raison_sociale),
  siren: normalise(normaliserSiren, MESSAGES.sirenMalForme).refine((siren) => !siren || sirenValide(siren), {
    error: MESSAGES.sirenInvalide,
  }),
  tva: normalise(normaliserTva, MESSAGES.tvaMalFormee),
  representant_prenom: texte(LONGUEURS_MAX.representant_prenom),
  representant_nom: texte(LONGUEURS_MAX.representant_nom),
  representant_fonction: texte(LONGUEURS_MAX.representant_fonction),
  siege_adresse: texte(LONGUEURS_MAX.siege_adresse),
  siege_complement: texte(LONGUEURS_MAX.siege_complement),
  siege_code_postal: normalise(normaliserCodePostal, MESSAGES.codePostalMalForme),
  siege_ville: texte(LONGUEURS_MAX.siege_ville),
});

type Fiche = z.output<typeof objetEntreprise>;

/** La TVA se vérifie une fois le SIREN et la TVA bien formés, même si un autre champ est en erreur. */
const sirenEtTvaBienFormes = ({ issues }: { issues: readonly { path?: readonly PropertyKey[] }[] }) =>
  issues.every((issue) => issue.path?.[0] !== "siren" && issue.path?.[0] !== "tva");

/**
 * Une fiche incomplète s'enregistre, mais tout champ rempli doit être valide.
 * La TVA doit porter le SIREN saisi ; sans SIREN, sa clé doit au moins être juste.
 */
export const schemaEntreprise = objetEntreprise
  .refine((fiche) => !fiche.siren || !fiche.tva || fiche.tva === tvaDepuisSiren(fiche.siren), {
    path: ["tva"],
    when: sirenEtTvaBienFormes,
    error: (issue) => MESSAGES.tvaIncoherente(tvaDepuisSiren((issue.input as Fiche).siren!)),
  })
  .refine((fiche) => !fiche.tva || fiche.tva === tvaDepuisSiren(fiche.tva.slice(4)), {
    path: ["tva"],
    when: sirenEtTvaBienFormes,
    error: MESSAGES.tvaInvalide,
  });

/** Saisie brute, telle qu'elle vient du formulaire. */
export type SaisieEntreprise = Partial<Record<ChampEntreprise, string | null>>;
export type ErreursEntreprise = Partial<Record<ChampEntreprise | "general", string>>;

/** Contrôle « dès la saisie » : les mêmes règles et les mêmes messages que l'enregistrement. */
export function verifierSaisie(saisie: SaisieEntreprise): ErreursEntreprise {
  const valide = schemaEntreprise.safeParse(saisie);
  return valide.success ? {} : premieresErreurs<ChampEntreprise>(valide.error);
}

/** Champs requis encore vides, dans l'ordre de la fiche. */
export function champsManquants(fiche: SaisieEntreprise): ChampEntreprise[] {
  return CHAMPS_REQUIS.filter((champ) => !fiche[champ]?.trim());
}

export function ficheComplete(fiche: SaisieEntreprise): boolean {
  return champsManquants(fiche).length === 0;
}
