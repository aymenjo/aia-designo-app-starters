import { aujourdhuiParis, depuisIso, instantParis, partiesParis, versIso } from "@/lib/dates";
import { formaterDateHeure } from "@/lib/format";
import { schemaIdConducteur, schemaIdVehicule } from "./regles";

// Le planning : une période (semaine ou mois) découpée en jours de Paris, et la place de chaque affectation.

export const VUES = ["semaine", "mois"] as const;
export type Vue = (typeof VUES)[number];

export type Periode = {
  vue: Vue;
  /** Bornes en instants ISO : 00:00 à Paris le premier jour, et 00:00 le lendemain du dernier. */
  debut: string;
  fin: string;
  /** Les jours de la période, en ISO. */
  jours: string[];
  /** Un jour de la période précédente et de la suivante, pour la navigation. */
  precedente: string;
  suivante: string;
  /** « Semaine du 12/10 au 18/10/2026 », « Octobre 2026 ». */
  libelle: string;
};

const JOUR_MS = 86_400_000;

/** Les dates du calendrier se calculent en UTC : une date n'a pas de fuseau. */
const versMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const depuisMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function decalerJours(iso: string, jours: number): string {
  return depuisMs(versMs(iso) + jours * JOUR_MS);
}

function ecartJours(de: string, a: string): number {
  return Math.round((versMs(a) - versMs(de)) / JOUR_MS);
}

const MOIS = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });

function joursDepuis(premier: string, nombre: number): string[] {
  return Array.from({ length: nombre }, (_, i) => decalerJours(premier, i));
}

/** La semaine (du lundi au dimanche) ou le mois qui contient `dateIso`. */
export function periode(vue: Vue, dateIso: string): Periode {
  let jours: string[];
  let precedente: string;
  let suivante: string;
  let libelle: string;

  if (vue === "semaine") {
    // getUTCDay : 0 = dimanche. Le lundi est 0 à 6 jours avant.
    const lundi = decalerJours(dateIso, -((new Date(versMs(dateIso)).getUTCDay() + 6) % 7));
    jours = joursDepuis(lundi, 7);
    precedente = decalerJours(lundi, -7);
    suivante = decalerJours(lundi, 7);
    const [premier, dernier] = [depuisIso(jours[0]), depuisIso(jours[6])];
    const memeAnnee = premier.slice(6) === dernier.slice(6);
    libelle = `Semaine du ${memeAnnee ? premier.slice(0, 5) : premier} au ${dernier}`;
  } else {
    const [annee, mois] = dateIso.split("-").map(Number);
    const nombre = new Date(Date.UTC(annee, mois, 0)).getUTCDate();
    jours = joursDepuis(depuisMs(Date.UTC(annee, mois - 1, 1)), nombre);
    precedente = depuisMs(Date.UTC(annee, mois - 2, 1));
    suivante = depuisMs(Date.UTC(annee, mois, 1));
    const nom = MOIS.format(Date.UTC(annee, mois - 1, 1));
    libelle = nom.charAt(0).toUpperCase() + nom.slice(1);
  }

  // 00:00 existe toujours à Paris : les changements d'heure ont lieu à 02:00 et 03:00.
  const debut = instantParis(jours[0], "00:00")!;
  const fin = instantParis(decalerJours(jours[jours.length - 1], 1), "00:00")!;
  return { vue, debut, fin, jours, precedente, suivante, libelle };
}

/** La place d'un instant dans la période, en %, d'après l'heure murale de Paris : les jours gardent tous la même largeur. */
function rang(instant: string, { jours }: Periode): number {
  const { date, heure } = partiesParis(instant);
  const [heures, minutes] = heure.split(":").map(Number);
  return ((ecartJours(jours[0], date) + (heures * 60 + minutes) / 1440) / jours.length) * 100;
}

export type Position = { gauche: number; largeur: number; coupeeAGauche: boolean; coupeeADroite: boolean };

/**
 * La barre d'une affectation dans la période, en % de sa largeur. Coupée à gauche si elle commence avant,
 * à droite si elle finit après ou n'a pas de fin. Le jour du retour à l'heure d'hiver, une affectation
 * qui ne dure que dans l'heure répétée aurait une largeur négative : elle est ramenée à 0.
 */
export function positionner({ debut, fin }: { debut: string; fin: string | null }, p: Periode): Position {
  const coupeeAGauche = Date.parse(debut) < Date.parse(p.debut);
  const coupeeADroite = !fin || Date.parse(fin) > Date.parse(p.fin);
  const gauche = coupeeAGauche ? 0 : rang(debut, p);
  const droite = fin && !coupeeADroite ? rang(fin, p) : 100;
  return { gauche, largeur: Math.max(0, droite - gauche), coupeeAGauche, coupeeADroite };
}

export type ParametresPlanning = { vue: Vue; date: string; conducteur?: string; vehicule?: string };

const premier = (valeur: string | string[] | undefined) => (Array.isArray(valeur) ? valeur[0] : valeur);

/**
 * Les paramètres de `/flotte/planning`. Un paramètre répété donne sa première valeur ; un id ou une date
 * invalide est ignoré. C'est aussi le format des liens de l'agent : `?vehicule=:id&date=AAAA-MM-JJ`.
 */
export function lireParametresPlanning(
  parametres: Record<string, string | string[] | undefined>,
  aujourdhui = aujourdhuiParis(),
): ParametresPlanning {
  const date = premier(parametres.date);
  const conducteur = premier(parametres.conducteur);
  const vehicule = premier(parametres.vehicule);
  return {
    vue: premier(parametres.vue) === "mois" ? "mois" : "semaine",
    date: date && versIso(depuisIso(date)) === date ? date : aujourdhui,
    conducteur: schemaIdConducteur.safeParse(conducteur).success ? conducteur : undefined,
    vehicule: schemaIdVehicule.safeParse(vehicule).success ? vehicule : undefined,
  };
}

/** Le lien du planning, sans les paramètres par défaut. */
export function lienPlanning({ vue, date, conducteur, vehicule }: Partial<ParametresPlanning>) {
  const parametres = new URLSearchParams();
  if (vue === "mois") parametres.set("vue", vue);
  if (date) parametres.set("date", date);
  if (conducteur) parametres.set("conducteur", conducteur);
  if (vehicule) parametres.set("vehicule", vehicule);
  const requete = parametres.toString();
  return requete ? `/flotte/planning?${requete}` : "/flotte/planning";
}

/** « du 03/03/2026 08:00 au 03/03/2026 18:00 », ou « depuis le 03/03/2026 08:00 · sans fin ». */
export function libelleCreneau(debut: string, fin: string | null) {
  return fin
    ? `du ${formaterDateHeure(debut)} au ${formaterDateHeure(fin)}`
    : `depuis le ${formaterDateHeure(debut)} · sans fin`;
}
