import { depuisIso, partiesParis } from "@/lib/dates";

// Formats fr-FR de l'application, à l'heure de Paris quel que soit le fuseau du serveur.

const FORMAT_DATE = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/** « 2026-10-11T22:30:00Z » → « 12/10/2026 » (JJ/MM/AAAA, heure de Paris). */
export function formaterDate(date: Date | string) {
  return FORMAT_DATE.format(new Date(date));
}

/** « 2026-03-03T07:00:00Z » → « 03/03/2026 08:00 » (heure de Paris, sur 24 h). */
export function formaterDateHeure(instant: Date | string) {
  const { date, heure } = partiesParis(instant);
  return `${depuisIso(date)} ${heure}`;
}

/** « 2026-03-03T07:00:00Z » → « 03/03 08:00 » : le format court du message de conflit. */
export function formaterJourHeure(instant: Date | string) {
  const { date, heure } = partiesParis(instant);
  return `${depuisIso(date).slice(0, 5)} ${heure}`;
}
