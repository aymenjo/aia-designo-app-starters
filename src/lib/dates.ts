// Dates du calendrier (naissance, délivrance du permis, envoi d'un avis) : saisies JJ/MM/AAAA,
// stockées en ISO (AAAA-MM-JJ). Une date du calendrier n'a pas de fuseau : on ne passe jamais
// par une `Date` en heure locale, et deux dates ISO se comparent comme des chaînes.
// Les instants (début et fin d'une affectation) se lisent et se saisissent à l'heure de Paris.

const deux = (n: number) => String(n).padStart(2, "0");

/**
 * « 12031985 », « 12/3/1985 », « 12.03.1985 », « 12-03-1985 » → « 12/03/1985 ».
 * Renvoie `null` si la forme ne convient pas : une année sur 2 chiffres est ambiguë, donc refusée.
 * Ne dit pas si la date existe : c'est le rôle de `versIso`.
 */
export function normaliserDate(brut: string): string | null {
  const compacte = brut.replace(/\s+/g, "");
  const morceaux = /^(\d{2})(\d{2})(\d{4})$/.exec(compacte) ?? /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(compacte);
  if (!morceaux) return null;
  const [, jour, mois, annee] = morceaux;
  return `${jour.padStart(2, "0")}/${mois.padStart(2, "0")}/${annee}`;
}

/** « 12/03/1985 » → « 1985-03-12 ». Renvoie `null` si la date n'existe pas (31/02, 29/02/2023…). */
export function versIso(jjmmaaaa: string): string | null {
  const morceaux = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(jjmmaaaa);
  if (!morceaux) return null;
  const [jour, mois, annee] = morceaux.slice(1).map(Number);
  const date = new Date(Date.UTC(annee, mois - 1, jour));
  const existe =
    date.getUTCFullYear() === annee && date.getUTCMonth() === mois - 1 && date.getUTCDate() === jour;
  return existe ? `${morceaux[3]}-${morceaux[2]}-${morceaux[1]}` : null;
}

/** « 1985-03-12 » → « 12/03/1985 ». */
export function depuisIso(iso: string): string {
  const [annee, mois, jour] = iso.slice(0, 10).split("-");
  return `${jour}/${mois}/${annee}`;
}

const A_PARIS = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Le jour (ISO) et l'heure (HH:MM) qu'il est à Paris à cet instant, quel que soit le fuseau du serveur. */
export function partiesParis(instant: Date | string): { date: string; heure: string } {
  const parties = Object.fromEntries(A_PARIS.formatToParts(new Date(instant)).map(({ type, value }) => [type, value]));
  return { date: `${parties.year}-${parties.month}-${parties.day}`, heure: `${parties.hour}:${parties.minute}` };
}

/** Le jour qu'il est à Paris, en ISO, quel que soit le fuseau du serveur. */
export function aujourdhuiParis(maintenant = new Date()): string {
  return partiesParis(maintenant).date;
}

// Heures des affectations : saisies HH:MM à l'heure de Paris, stockées en instants (timestamptz).

/**
 * « 8 », « 8h », « 8h30 », « 0830 », « 8:30 », « 8.30 » → « 08:30 ».
 * Renvoie `null` si la forme ne convient pas, ou hors de 00:00 à 23:59.
 */
export function normaliserHeure(brut: string): string | null {
  const compacte = brut.replace(/\s+/g, "").toLowerCase();
  const morceaux = /^(\d{1,2})(?:[h:.](\d{2})?)?$/.exec(compacte) ?? /^(\d{1,2})(\d{2})$/.exec(compacte);
  if (!morceaux) return null;
  const heures = Number(morceaux[1]);
  const minutes = Number(morceaux[2] ?? 0);
  return heures <= 23 && minutes <= 59 ? `${deux(heures)}:${deux(minutes)}` : null;
}

/** Écart entre l'heure murale de Paris et UTC à cet instant (à la minute), en ms : +1 h l'hiver, +2 h l'été. */
function decalageParis(ms: number): number {
  const { date, heure } = partiesParis(new Date(ms));
  return Date.parse(`${date}T${heure}:00Z`) - ms;
}

/**
 * Le 03/03/2026 à 08:00 à Paris → « 2026-03-03T07:00:00.000Z ».
 * Renvoie `null` pour une heure qui n'existe pas (le jour du passage à l'heure d'été, entre 02:00 et 03:00).
 * Une heure qui existe deux fois (le jour du retour à l'heure d'hiver) donne la seconde, en heure d'hiver.
 */
export function instantParis(dateIso: string, heure: string): string | null {
  const murale = Date.parse(`${dateIso}T${heure}:00Z`);
  // Le décalage dépend de l'instant cherché : une première passe l'approche, la seconde le corrige.
  const approche = murale - decalageParis(murale);
  const instant = murale - decalageParis(approche);
  const relue = partiesParis(new Date(instant));
  return relue.date === dateIso && relue.heure === heure ? new Date(instant).toISOString() : null;
}

/** Comme Postgres (`date + interval 'n years'`) : le 29/02 devient le 28/02 d'une année non bissextile. */
export function ajouterAnnees(iso: string, annees: number): string {
  const [annee, mois, jour] = iso.split("-").map(Number);
  const cible = annee + annees;
  const dernierJour = new Date(Date.UTC(cible, mois, 0)).getUTCDate();
  return `${cible}-${deux(mois)}-${deux(Math.min(jour, dernierJour))}`;
}

/** Comme Postgres (`date + interval 'n months'`) : le 31/05 moins 3 mois donne le 28/02 (ou le 29/02). */
export function ajouterMois(iso: string, mois: number): string {
  const [annee, moisDepart, jour] = iso.split("-").map(Number);
  const cible = new Date(Date.UTC(annee, moisDepart - 1 + mois, 1));
  const dernierJour = new Date(Date.UTC(cible.getUTCFullYear(), cible.getUTCMonth() + 1, 0)).getUTCDate();
  return `${cible.getUTCFullYear()}-${deux(cible.getUTCMonth() + 1)}-${deux(Math.min(jour, dernierJour))}`;
}

/** « 2026-10-14 » + 45 → « 2026-11-28 ». En UTC pur : une date du calendrier n'a pas de fuseau. */
export function ajouterJours(iso: string, jours: number): string {
  const [annee, mois, jour] = iso.split("-").map(Number);
  return new Date(Date.UTC(annee, mois - 1, jour + jours)).toISOString().slice(0, 10);
}

/** Nombre de jours de `depuis` à `jusqu`au : positif si `jusqu`au est après. */
export function ecartJours(depuis: string, jusquAu: string): number {
  return Math.round((Date.parse(`${jusquAu}T00:00:00Z`) - Date.parse(`${depuis}T00:00:00Z`)) / 86_400_000);
}
