import { manquantsRecap } from "@/lib/avis/recap";
import {
  LIBELLES_CHAMP_AVIS,
  MESSAGES_AVIS,
  champsAConfirmer,
  champsManquantsAvis,
  estOuvert,
  type ChampRequisAvis,
  type Confiances,
  type StatutAvis,
} from "@/lib/avis/regles";
import type { FicheEntreprise } from "@/lib/entreprise/fiche";
import { LIBELLES_CHAMP } from "@/lib/entreprise/regles";
import type { Conducteur } from "@/lib/flotte/conducteurs";
import { LIBELLES_CHAMP_CONDUCTEUR, nomComplet, type ChampConducteur } from "@/lib/flotte/regles";

// Les avis bloqués (phase 26) : « Quels avis sont bloqués, et pourquoi ? ». Un avis est bloqué quand il est ouvert et que
// le gestionnaire ne peut pas le mener jusqu'au récap ANTAI sans régler autre chose. Un avis qui n'attend que « Valider
// ce conducteur » ou « J'ai désigné sur l'ANTAI » n'est pas bloqué. Sans dépendance serveur : les règles sont celles de
// l'avis et du récap (recap.ts, regles.ts), l'outil lister_avis ne fait que leur passer les données lues.

export type Blocage = { motif: string; action: string };

export const BLOCAGES = {
  verrouille: { motif: MESSAGES_AVIS.verrouille, action: "Attendre le 1er du mois, ou passer en Pro." },
  vehiculeLectureSeule: {
    motif: MESSAGES_AVIS.vehiculeLectureSeule,
    action: "Rendre le véhicule actif depuis sa fiche, ou passer en Pro.",
  },
  champsAVerifier: (champs: readonly ChampRequisAvis[]): Blocage => ({
    motif: `Champs à vérifier : ${champs.map((champ) => LIBELLES_CHAMP_AVIS[champ]).join(", ")}.`,
    action: "Ouvrir l'avis pour compléter ou confirmer ces champs.",
  }),
  vehiculeInconnu: (plaque: string): Blocage => ({
    motif: `Véhicule inconnu : aucun véhicule de la flotte ne porte la plaque ${plaque}.`,
    action: "Créer le véhicule depuis l'avis, ou classer l'avis.",
  }),
  aucuneAffectation: {
    motif: `${MESSAGES_AVIS.aucuneAffectation} : le planning ne dit pas qui conduisait au moment de l'infraction.`,
    action: "Choisir le conducteur sur l'avis, puis enregistrer l'affectation manquante.",
  },
  conducteurArchive: (nom: string, plaque: string): Blocage => ({
    motif: MESSAGES_AVIS.conducteurArchivePropose(nom, plaque),
    action: "Réactiver sa fiche, ou choisir un autre conducteur sur l'avis.",
  }),
  ficheConducteur: (nom: string, champs: readonly ChampConducteur[]): Blocage => ({
    motif: `Fiche de ${nom} incomplète : ${champs.map((champ) => LIBELLES_CHAMP_CONDUCTEUR[champ]).join(", ")}.`,
    action: "Compléter sa fiche : le récap ANTAI la reprend.",
  }),
  ficheEntreprise: (champs: readonly (keyof typeof LIBELLES_CHAMP)[]): Blocage => ({
    motif: `Fiche entreprise incomplète : ${champs.map((champ) => LIBELLES_CHAMP[champ]).join(", ")}.`,
    action: "Compléter la fiche entreprise : le récap ANTAI la reprend.",
  }),
} as const;

type AvisBlocages = Partial<Record<ChampRequisAvis, unknown>> & {
  statut: StatutAvis;
  plaque: string | null;
  vehicule_id: string | null;
  conducteur_id: string | null;
  verrouille: boolean;
  vehicule_lecture_seule: boolean;
  confiances?: Confiances;
};

/** Un conducteur et sa fiche : le récap ANTAI reprend ses champs requis. */
export type ConducteurBlocages = Pick<Conducteur, "prenom" | "nom" | "archive_le"> &
  Partial<Record<ChampConducteur, unknown>>;

/**
 * Les blocages d'un avis, du premier à régler au dernier ; vide s'il n'est pas bloqué ou n'est plus ouvert.
 * `conducteurValide` est celui de l'avis ; `conducteurPropose`, celui de l'affectation qui couvre l'infraction, ou
 * `null` sans affectation. La fiche du conducteur qui sera désigné et celle de l'entreprise doivent être complètes.
 */
export function blocagesAvis({
  avis,
  conducteurValide,
  conducteurPropose,
  entreprise,
}: {
  avis: AvisBlocages;
  conducteurValide: ConducteurBlocages | null;
  conducteurPropose: ConducteurBlocages | null;
  entreprise: FicheEntreprise;
}): Blocage[] {
  if (!estOuvert(avis.statut)) return [];
  if (avis.verrouille) return [BLOCAGES.verrouille];
  if (avis.vehicule_lecture_seule) return [BLOCAGES.vehiculeLectureSeule];

  const blocages: Blocage[] = [];
  const inconnu = avis.plaque && !avis.vehicule_id ? BLOCAGES.vehiculeInconnu(avis.plaque) : null;

  if (avis.statut === "a_traiter") {
    const champs = [...new Set([...champsManquantsAvis(avis), ...champsAConfirmer(avis)])];
    if (champs.length) blocages.push(BLOCAGES.champsAVerifier(champs));
    if (inconnu) blocages.push(inconnu);
    return blocages;
  }

  if (inconnu || !avis.vehicule_id) {
    if (inconnu) blocages.push(inconnu);
  } else {
    const conducteur = avis.conducteur_id ? conducteurValide : conducteurPropose;
    if (!conducteur) {
      if (!avis.conducteur_id) blocages.push(BLOCAGES.aucuneAffectation);
    } else if (conducteur.archive_le) {
      blocages.push(BLOCAGES.conducteurArchive(nomComplet(conducteur), avis.plaque ?? ""));
    } else {
      const { conducteur: manquants } = manquantsRecap({ conducteur, entreprise });
      if (manquants.length) blocages.push(BLOCAGES.ficheConducteur(nomComplet(conducteur), manquants));
    }
  }

  const { entreprise: manquantsEntreprise } = manquantsRecap({ conducteur: {}, entreprise });
  if (manquantsEntreprise.length) blocages.push(BLOCAGES.ficheEntreprise(manquantsEntreprise));
  return blocages;
}
