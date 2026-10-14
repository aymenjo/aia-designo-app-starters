import { ajouterJours, aujourdhuiParis, ecartJours } from "@/lib/dates";
import { estOuvert, type StatutAvis } from "./regles";

// Échéance de désignation : la date d'envoi plus 45 jours (la base la calcule aussi, colonne `echeance`).
// Sans dépendance serveur : le formulaire de l'avis la recalcule à chaque frappe.

export const DELAI_DESIGNATION_JOURS = 45;

/** L'amende forfaitaire pour non-désignation : 675 €, évités par chaque avis désigné à temps. */
export const AMENDE_NON_DESIGNATION_CENTIMES = 67_500;

/** « 2026-10-14 » → « 2026-11-28 ». */
export function calculerEcheance(dateEnvoiIso: string): string {
  return ajouterJours(dateEnvoiIso, DELAI_DESIGNATION_JOURS);
}

/** Jours avant l'échéance, à l'heure de Paris : 0 le jour même, négatif une fois dépassée. */
export function joursRestants(echeanceIso: string, aujourdhui = aujourdhuiParis()): number {
  return ecartJours(aujourdhui, echeanceIso);
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
