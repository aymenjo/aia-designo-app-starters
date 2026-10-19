import type { Avis } from "./avis";
import { estOuvert, type StatutAvis } from "./regles";

// Liste des avis : son filtre par statut, ses liens et l'ordre du suivi.

/** Les statuts proposés par le filtre. */
export const FILTRES_STATUT = ["a_traiter", "a_valider", "designe", "classe"] as const satisfies readonly StatutAvis[];
export type FiltreAvis = { statut?: (typeof FILTRES_STATUT)[number] };

const premier = (valeur: string | string[] | undefined) => (Array.isArray(valeur) ? valeur[0] : valeur);

/** Le filtre de `/avis`. Un paramètre répété donne sa première valeur ; un statut inconnu est ignoré. */
export function lireFiltreAvis(parametres: Record<string, string | string[] | undefined>): FiltreAvis {
  const statut = premier(parametres.statut);
  return { statut: FILTRES_STATUT.find((filtre) => filtre === statut) };
}

/** Le lien de la liste, sans filtre par défaut. */
export function lienAvis({ statut }: FiltreAvis) {
  return statut ? `/avis?statut=${statut}` : "/avis";
}

type Triable = Pick<Avis, "statut" | "echeance" | "depose_le">;

/**
 * L'ordre du suivi : d'abord les avis ouverts, puis les désignés et les classés. Dans chaque groupe, les avis
 * sans échéance (date d'envoi pas encore saisie) passent en tête, car leur délai court déjà sans qu'on le voie ;
 * les autres suivent par échéance croissante. À égalité, le premier déposé passe d'abord.
 */
export function trierPourSuivi<T extends Triable>(avis: readonly T[]): T[] {
  return avis.toSorted(
    (a, b) =>
      Number(!estOuvert(a.statut)) - Number(!estOuvert(b.statut)) ||
      Number(a.echeance !== null) - Number(b.echeance !== null) ||
      (a.echeance ?? "").localeCompare(b.echeance ?? "") ||
      Date.parse(a.depose_le) - Date.parse(b.depose_le),
  );
}
