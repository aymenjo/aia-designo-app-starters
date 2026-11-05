import { aujourdhuiParis, partiesParis } from "@/lib/dates";
import type { Avis } from "./avis";
import { AMENDE_NON_DESIGNATION_CENTIMES, designeATemps, joursRestants, niveauEcheance } from "./echeance";
import { trierPourSuivi } from "./liste";
import { estOuvert } from "./regles";

// Les chiffres du tableau de bord (phase 15), sans dépendance serveur : `aujourdhui` est injecté, comme pour les alertes.
// Les euros évités ne sont jamais stockés : un avis rouvert perd sa date de désignation, et le total se recalcule.

type AvisSynthese = Pick<Avis, "statut" | "echeance" | "designe_le">;
type AvisSuivi = Pick<Avis, "statut" | "echeance" | "depose_le">;

/** « 2026-10-31T23:30:00Z » → « 2026-11 » : le mois qu'il est à Paris à cet instant. */
export function moisParis(instant: string): string {
  return partiesParis(instant).date.slice(0, 7);
}

export type SyntheseTableauDeBord = {
  /** Les avis ouverts : « À traiter » et « À valider ». */
  aTraiter: { total: number; a_traiter: number; a_valider: number };
  /** Les avis ouverts à J-15 ou moins, échéance dépassée comprise ; J-2 à J-0 sont urgentes. */
  echeancesProches: { total: number; urgentes: number; depassees: number };
  /** Les avis désignés, et ceux désignés ce mois-ci, à l'heure de Paris. */
  designes: { total: number; ceMois: number };
  /** 675 € par avis désigné à temps, en centimes : ce mois-ci (mois de la désignation) et en cumul. */
  eurosEvites: { ceMois: number; cumul: number };
};

/** Les 4 tuiles du tableau de bord. */
export function syntheseTableauDeBord(
  avis: readonly AvisSynthese[],
  aujourdhui = aujourdhuiParis(),
): SyntheseTableauDeBord {
  const ouverts = avis.filter((un) => estOuvert(un.statut));
  // Les niveaux de la pastille d'échéance : proche dès J-15, comme la première alerte.
  const proches = ouverts
    .flatMap((un) => (un.echeance ? [niveauEcheance(joursRestants(un.echeance, aujourdhui))] : []))
    .filter((niveau) => niveau !== "calme");
  const designes = avis.filter((un) => un.statut === "designe");
  const aTemps = designes.filter(designeATemps);
  const duMois = (un: AvisSynthese) => un.designe_le !== null && moisParis(un.designe_le) === aujourdhui.slice(0, 7);

  return {
    aTraiter: {
      total: ouverts.length,
      a_traiter: ouverts.filter((un) => un.statut === "a_traiter").length,
      a_valider: ouverts.filter((un) => un.statut === "a_valider").length,
    },
    echeancesProches: {
      total: proches.length,
      urgentes: proches.filter((niveau) => niveau === "urgent").length,
      depassees: proches.filter((niveau) => niveau === "depassee").length,
    },
    designes: { total: designes.length, ceMois: designes.filter(duMois).length },
    eurosEvites: {
      ceMois: aTemps.filter(duMois).length * AMENDE_NON_DESIGNATION_CENTIMES,
      cumul: aTemps.length * AMENDE_NON_DESIGNATION_CENTIMES,
    },
  };
}

/** Les `n` prochaines échéances : les avis ouverts qui en ont une, dans l'ordre du suivi. */
export function prochainesEcheances<T extends AvisSuivi>(avis: readonly T[], n = 5): T[] {
  return trierPourSuivi(avis.filter((un) => estOuvert(un.statut) && un.echeance !== null)).slice(0, n);
}

/** Les avis ouverts sans échéance : leur date d'envoi n'est pas saisie, et leur délai court sans qu'on le voie. */
export function sansEcheance(avis: readonly Pick<Avis, "statut" | "echeance">[]): number {
  return avis.filter((un) => estOuvert(un.statut) && un.echeance === null).length;
}
