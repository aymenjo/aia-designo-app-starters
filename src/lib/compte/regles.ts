// La confirmation de la suppression de compte (phase 20) et ses messages, définis une seule fois : l'action les vérifie,
// et l'écran les reprend pour activer le bouton. Sans appel réseau.

export const MESSAGES_COMPTE = {
  saisie: (attendu: string) => `Saisissez exactement « ${attendu} » pour confirmer.`,
  indisponible: "La suppression n'a pas pu aboutir. Réessayez dans un instant.",
  supprime: "Votre compte a été supprimé, avec toutes les données de votre entreprise.",
} as const;

/** Ce que le gestionnaire recopie pour confirmer : la raison sociale, ou son email si la fiche n'en a pas. */
export type TexteConfirmation = { texte: string; parEmail: boolean };

export function texteConfirmation({
  raisonSociale,
  email,
}: {
  raisonSociale: string | null;
  email: string;
}): TexteConfirmation {
  const raison = raisonSociale?.trim() ?? "";
  return raison ? { texte: raison, parEmail: false } : { texte: email.trim().toLowerCase(), parEmail: true };
}

/**
 * La saisie confirme la suppression : exactement le texte attendu, aux espaces près autour. La raison sociale se recopie
 * à la casse près ; l'email, en minuscules ou non, comme à la connexion. Une saisie vide ne confirme jamais rien.
 */
export function confirmationCorrecte(saisie: string, { texte, parEmail }: TexteConfirmation): boolean {
  const recopie = parEmail ? saisie.trim().toLowerCase() : saisie.trim();
  return recopie !== "" && recopie === texte;
}
