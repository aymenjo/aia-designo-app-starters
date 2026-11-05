import type { Avis } from "@/lib/avis/avis";
import { AMENDE_NON_DESIGNATION_CENTIMES, designeATemps } from "@/lib/avis/echeance";
import { moisParis } from "@/lib/avis/tableau-de-bord";
import { ajouterMois, instantParis, partiesParis } from "@/lib/dates";
import type { FicheEntreprise } from "@/lib/entreprise/fiche";
import { LIBELLES_CHAMP, champsManquants } from "@/lib/entreprise/regles";
import type { Conducteur } from "@/lib/flotte/conducteurs";
import { LIBELLES_CHAMP_CONDUCTEUR, champsManquantsConducteur, nomAbrege, nomComplet } from "@/lib/flotte/regles";
import type { Vehicule } from "@/lib/flotte/vehicules";

// Les chiffres du rapport mensuel (phase 25), sans dépendance serveur : le mois est injecté, et tout se calcule sur les
// avis, véhicules et conducteurs de l'entreprise, tels qu'ils sont à la génération. Chaque chiffre compte dans le mois
// de son événement, à l'heure de Paris : le dépôt pour les avis reçus, la désignation, le classement. Les euros évités
// ne sont jamais stockés, comme au tableau de bord.

/** Les éléments listés par catégorie : 3 véhicules et 3 conducteurs. */
export const TAILLE_PALMARES = 3;
/** La base des plus verbalisés : 12 mois glissants, le mois du rapport compris. */
export const MOIS_PALMARES = 12;

export type AvisRapport = Pick<
  Avis,
  | "id"
  | "numero"
  | "plaque"
  | "vehicule_id"
  | "conducteur_id"
  | "montant_centimes"
  | "statut"
  | "echeance"
  | "depose_le"
  | "designe_le"
  | "classe_le"
>;

export const COLONNES_AVIS_RAPPORT =
  "id, numero, plaque, vehicule_id, conducteur_id, montant_centimes, statut, echeance, depose_le, designe_le, classe_le";

export type VehiculeRapport = Pick<Vehicule, "id" | "plaque" | "modele">;

/** Un avis dont l'échéance est tombée dans le mois sans désignation à temps. */
export type EcheanceManquee = Pick<AvisRapport, "id" | "numero" | "plaque" | "statut"> & { echeance: string };

/** Ce que compte un véhicule ou un conducteur : ses avis sur 12 mois, dont ceux du mois, et leur montant. */
export type Compte = { douzeMois: number; mois: number; montantCentimes: number };

export type SyntheseRapport = {
  /** Le 1er du mois du rapport, en ISO. */
  mois: string;
  recus: number;
  designes: number;
  classes: number;
  echeancesManquees: EcheanceManquee[];
  /** 675 € par avis désigné à temps, en centimes : ceux désignés dans le mois, et tous jusqu'à la fin du mois. */
  eurosEvites: { mois: number; cumul: number };
  plusVerbalises: {
    vehicules: (Compte & Pick<VehiculeRapport, "plaque" | "modele">)[];
    conducteurs: (Compte & { nom: string })[];
  };
  fichesIncompletes: {
    /** Les libellés des champs manquants de la fiche entreprise : vide si elle est complète. */
    entreprise: string[];
    conducteurs: { nom: string; manquants: string[] }[];
  };
  /** Aucun avis reçu dans le mois. */
  aucunAvis: boolean;
};

/** « 2026-11-01 » → « 2026-10-01 » : le rapport produit ce jour-là, ou un jour suivant, est celui du mois écoulé. */
export function moisDuRapport(aujourdhui: string): string {
  return ajouterMois(`${aujourdhui.slice(0, 7)}-01`, -1);
}

/** Le mois à Paris, en instants : du 1er à 00:00 (compris) au 1er du mois suivant à 00:00 (exclu). */
export function bornesMois(mois: string): { debut: string; fin: string } {
  // Minuit existe toujours à Paris : les changements d'heure ont lieu à 2 h et à 3 h.
  return { debut: instantParis(mois, "00:00")!, fin: instantParis(ajouterMois(mois, 1), "00:00")! };
}

const LIBELLE_MOIS = new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", month: "long", year: "numeric" });

/** « 2026-10-01 » → « octobre 2026 ». */
export function libelleMois(mois: string): string {
  return LIBELLE_MOIS.format(new Date(`${mois}T00:00:00Z`));
}

/** Le jour qu'il était à Paris à cet instant. */
const jourParis = (instant: string) => partiesParis(instant).date;

const parNom = (a: string, b: string) => a.localeCompare(b, "fr");

/**
 * Les éléments qui ont le plus d'avis, le plus verbalisé d'abord. Départage : les avis du mois, puis le montant, puis le
 * nom. Un avis dont l'élément n'est pas fourni ne compte pas.
 */
function palmares<T>(
  avis: readonly AvisRapport[],
  cle: (un: AvisRapport) => string | null,
  elements: ReadonlyMap<string, T>,
  nom: (element: T) => string,
  mois: string,
): (Compte & { element: T })[] {
  const comptes = new Map<string, Compte>();
  for (const un of avis) {
    const id = cle(un);
    if (id === null || !elements.has(id)) continue;
    const compte = comptes.get(id) ?? { douzeMois: 0, mois: 0, montantCentimes: 0 };
    compte.douzeMois += 1;
    if (moisParis(un.depose_le) === mois.slice(0, 7)) compte.mois += 1;
    compte.montantCentimes += un.montant_centimes ?? 0;
    comptes.set(id, compte);
  }
  return Array.from(comptes, ([id, compte]) => ({ ...compte, element: elements.get(id)! }))
    .sort(
      (a, b) =>
        b.douzeMois - a.douzeMois ||
        b.mois - a.mois ||
        b.montantCentimes - a.montantCentimes ||
        parNom(nom(a.element), nom(b.element)),
    )
    .slice(0, TAILLE_PALMARES);
}

/**
 * Le rapport du mois : les avis, véhicules et conducteurs de l'entreprise, archivés compris, et sa fiche.
 * - Échéances dépassées : l'échéance tombe dans le mois, et l'avis n'est ni classé ni désigné à temps. Chacun ne compte
 *   qu'une fois, de la plus ancienne échéance à la plus récente.
 * - Plus verbalisés : les avis déposés sur 12 mois glissants, hors avis classés et plaques inconnues. Le conducteur est
 *   celui qui a été validé.
 * - Fiches incomplètes : les conducteurs actifs, et la fiche entreprise.
 */
export function syntheseRapport({
  mois,
  avis,
  vehicules,
  conducteurs,
  entreprise,
}: {
  mois: string;
  avis: readonly AvisRapport[];
  vehicules: readonly VehiculeRapport[];
  conducteurs: readonly Conducteur[];
  entreprise: FicheEntreprise;
}): SyntheseRapport {
  const cle = mois.slice(0, 7);
  const finMois = ajouterMois(mois, 1);
  const debutPalmares = ajouterMois(mois, 1 - MOIS_PALMARES);
  const duMois = (instant: string | null) => instant !== null && moisParis(instant) === cle;

  const recus = avis.filter((un) => duMois(un.depose_le)).length;
  const aTemps = avis.filter(designeATemps);

  const echeancesManquees = avis
    .filter(
      (un): un is AvisRapport & { echeance: string } =>
        un.echeance !== null &&
        un.echeance >= mois &&
        un.echeance < finMois &&
        un.statut !== "classe" &&
        !designeATemps(un),
    )
    .sort((a, b) => a.echeance.localeCompare(b.echeance) || (a.numero ?? "").localeCompare(b.numero ?? ""))
    .map(({ id, numero, plaque, statut, echeance }) => ({ id, numero, plaque, statut, echeance }));

  const base = avis.filter((un) => {
    const jour = jourParis(un.depose_le);
    return un.statut !== "classe" && un.vehicule_id !== null && jour >= debutPalmares && jour < finMois;
  });
  const parVehicule = palmares(
    base,
    (un) => un.vehicule_id,
    new Map(vehicules.map((vehicule) => [vehicule.id, vehicule])),
    (vehicule) => vehicule.plaque,
    mois,
  );
  const parConducteur = palmares(
    base,
    (un) => un.conducteur_id,
    new Map(conducteurs.map((conducteur) => [conducteur.id, conducteur])),
    nomComplet,
    mois,
  );

  const conducteursIncomplets = conducteurs
    .filter((conducteur) => !conducteur.archive_le)
    .toSorted((a, b) => parNom(a.nom, b.nom) || parNom(a.prenom, b.prenom))
    .map((conducteur) => ({
      nom: nomAbrege(conducteur),
      manquants: champsManquantsConducteur(conducteur).map((champ) => LIBELLES_CHAMP_CONDUCTEUR[champ]),
    }))
    .filter(({ manquants }) => manquants.length);

  return {
    mois,
    recus,
    designes: avis.filter((un) => duMois(un.designe_le)).length,
    classes: avis.filter((un) => duMois(un.classe_le)).length,
    echeancesManquees,
    eurosEvites: {
      mois: aTemps.filter((un) => duMois(un.designe_le)).length * AMENDE_NON_DESIGNATION_CENTIMES,
      cumul: aTemps.filter((un) => jourParis(un.designe_le!) < finMois).length * AMENDE_NON_DESIGNATION_CENTIMES,
    },
    plusVerbalises: {
      vehicules: parVehicule.map(({ element: { plaque, modele }, ...compte }) => ({ ...compte, plaque, modele })),
      conducteurs: parConducteur.map(({ element, ...compte }) => ({ ...compte, nom: nomComplet(element) })),
    },
    fichesIncompletes: {
      entreprise: champsManquants(entreprise).map((champ) => LIBELLES_CHAMP[champ]),
      conducteurs: conducteursIncomplets,
    },
    aucunAvis: recus === 0,
  };
}
