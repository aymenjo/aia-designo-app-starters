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

// Une date du calendrier n'a pas de fuseau : on la lit à minuit UTC, et on l'affiche en UTC.
const FORMAT_JOUR_LONG = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "UTC",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

/** « 2026-10-17 » → « Samedi 17 octobre 2026 », « Vendredi 1er janvier 2027 » : la date du jour, en tête du tableau de bord. */
export function formaterJourLong(iso: string) {
  const jour = FORMAT_JOUR_LONG.format(new Date(`${iso}T00:00:00Z`)).replace(/ 1 /, " 1er ");
  return jour.charAt(0).toUpperCase() + jour.slice(1);
}

/** « 2026-03-03T07:00:00Z » → « 03/03/2026 08:00 » (heure de Paris, sur 24 h). */
export function formaterDateHeure(instant: Date | string) {
  const { date, heure } = partiesParis(instant);
  return `${depuisIso(date)} ${heure}`;
}

/** « 2026-03-03T07:00:00Z » → « 03/03/2026 à 08:00 » : la date d'un geste, dans une phrase (« Désigné le … »). */
export function formaterDateAHeure(instant: Date | string) {
  const { date, heure } = partiesParis(instant);
  return `${depuisIso(date)} à ${heure}`;
}

/** « 2026-03-03T07:00:00Z » → « 03/03 08:00 » : le format court du message de conflit. */
export function formaterJourHeure(instant: Date | string) {
  const { date, heure } = partiesParis(instant);
  return `${depuisIso(date).slice(0, 5)} ${heure}`;
}

// Espace fine insécable pour les milliers, espace insécable avant € : « 24 975,00 € ».
const FORMAT_MONTANT = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
const FORMAT_EUROS = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const FORMAT_MONTANT_SAISIE = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: false,
});

/** 13500 → « 135,00 € ». */
export function formaterMontant(centimes: number) {
  return FORMAT_MONTANT.format(centimes / 100);
}

/** 67500 → « 675 € », 2497500 → « 24 975 € » : un montant rond, sans centimes (tarifs, euros évités). */
export function formaterEuros(centimes: number) {
  return FORMAT_EUROS.format(centimes / 100);
}

/** 13500 → « 135,00 » : la valeur d'un champ de saisie, sans symbole ni séparateur de milliers. */
export function formaterMontantSaisie(centimes: number) {
  return FORMAT_MONTANT_SAISIE.format(centimes / 100);
}
