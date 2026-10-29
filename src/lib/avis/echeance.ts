import { ajouterJours, aujourdhuiParis, ecartJours, partiesParis } from "@/lib/dates";
import { estOuvert, type StatutAvis } from "./regles";

// Échéance de désignation : la date d'envoi plus 45 jours (la base la calcule aussi, colonne `echeance`).
// Sans dépendance serveur : le formulaire de l'avis la recalcule à chaque frappe.

export const DELAI_DESIGNATION_JOURS = 45;

/** L'amende forfaitaire pour non-désignation : 675 €, évités par chaque avis désigné à temps. */
export const AMENDE_NON_DESIGNATION_CENTIMES = 67_500;

/**
 * Désigné à temps : le clic sur « J'ai désigné sur l'ANTAI » tombe au plus tard le jour de l'échéance, à l'heure
 * de Paris. Seul un tel avis évite les 675 € ; un avis rouvert perd sa date de désignation, donc n'en évite plus.
 */
export function designeATemps({
  statut,
  echeance,
  designe_le,
}: {
  statut: StatutAvis;
  echeance: string | null;
  designe_le: string | null;
}): boolean {
  return statut === "designe" && echeance !== null && designe_le !== null && partiesParis(designe_le).date <= echeance;
}

/** « 2026-10-14 » → « 2026-11-28 ». */
export function calculerEcheance(dateEnvoiIso: string): string {
  return ajouterJours(dateEnvoiIso, DELAI_DESIGNATION_JOURS);
}

/** Jours avant l'échéance, à l'heure de Paris : 0 le jour même, négatif une fois dépassée. */
export function joursRestants(echeanceIso: string, aujourdhui = aujourdhuiParis()): number {
  return ecartJours(aujourdhui, echeanceIso);
}

/** Les jours où partent les alertes email (phase 14), et qui découpent les niveaux de l'échéance. */
export const SEUILS_ALERTE = [15, 7, 2] as const;
export type SeuilAlerte = (typeof SEUILS_ALERTE)[number];

/**
 * Le seuil d'alerte qu'atteint l'échéance ce jour-là, à l'heure de Paris, ou `null`. Seul le jour exact compte :
 * un seuil déjà passé n'est jamais rattrapé, c'est le suivant qui s'applique.
 */
export function seuilDuJour(echeanceIso: string, aujourdhui = aujourdhuiParis()): SeuilAlerte | null {
  const jours = joursRestants(echeanceIso, aujourdhui);
  return SEUILS_ALERTE.find((seuil) => seuil === jours) ?? null;
}

/** Les échéances qui atteignent un seuil ce jour-là : celles que la tâche des alertes cherche en base. */
export function echeancesDuJour(aujourdhui = aujourdhuiParis()): string[] {
  return SEUILS_ALERTE.map((seuil) => ajouterJours(aujourdhui, seuil));
}

export type NiveauEcheance = "calme" | "a_regarder" | "urgent" | "depassee";

/** Les seuils des alertes (J-15, J-7, J-2) : calme à J-16 et plus, à regarder de J-15 à J-3, urgent de J-2 à J-0. */
export function niveauEcheance(jours: number): NiveauEcheance {
  if (jours < 0) return "depassee";
  if (jours <= 2) return "urgent";
  if (jours <= 15) return "a_regarder";
  return "calme";
}

/**
 * Badge « Échéance dépassée » : un avis ouvert dont l'échéance est passée, J-0 ne l'étant pas encore.
 * Le statut ne change pas, et un avis désigné ou classé n'est plus concerné.
 */
export function echeanceDepassee(
  { statut, echeance }: { statut: StatutAvis; echeance: string | null },
  aujourdhui = aujourdhuiParis(),
): boolean {
  return estOuvert(statut) && echeance !== null && joursRestants(echeance, aujourdhui) < 0;
}
