import { z } from "zod";

// Briques de saisie communes aux fiches (entreprise, conducteur) et à la flotte :
// champs facultatifs, normalisation, messages partagés.

// Espace insécable avant les deux-points : ils ne passent jamais seuls en début de ligne.
export const MESSAGES_SAISIE = {
  codePostalMalForme: "Code postal mal formé : attendu 5 chiffres.",
  tropLong: (max: number) => `Ce champ ne doit pas dépasser ${max} caractères.`,
  enregistrementImpossible: "L'enregistrement a échoué. Réessayez dans un instant.",
} as const;

// Espaces (insécables comprises), points et tirets : « 404 833 048 », « FR 83-404.833.048 ».
export const SEPARATEURS = /[\s.-]+/g;

/** « 75 001 » → « 75001 ». Renvoie `null` si ce n'est pas un code postal français à 5 chiffres. */
export function normaliserCodePostal(brut: string): string | null {
  const codePostal = brut.replace(SEPARATEURS, "");
  return /^(0[1-9]|[1-8]\d|9[0-8])\d{3}$/.test(codePostal) ? codePostal : null;
}

/** Champ texte facultatif : rogné, vide → `null`. */
export const texte = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: MESSAGES_SAISIE.tropLong(max) })
    .nullish()
    .transform((valeur) => valeur || null);

/** Champ facultatif normalisé : vide → `null`, sinon la forme normalisée ou le message d'erreur. */
export const normalise = <T extends string>(normaliser: (brut: string) => T | null, message: string) =>
  z
    .string()
    .trim()
    .nullish()
    .transform((brut, ctx) => {
      if (!brut) return null;
      const valeur = normaliser(brut);
      if (!valeur) {
        ctx.addIssue(message);
        return z.NEVER;
      }
      return valeur;
    });

/** Premier message de chaque champ en erreur. */
export function premieresErreurs<Champ extends string>(erreur: z.ZodError): Partial<Record<Champ, string>> {
  const erreurs: Partial<Record<Champ, string>> = {};
  for (const issue of erreur.issues) {
    const champ = issue.path[0] as Champ;
    erreurs[champ] ??= issue.message;
  }
  return erreurs;
}
