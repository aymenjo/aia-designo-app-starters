import type { Plan } from "@/lib/abonnement/plans";
import { depuisIso, partiesParis } from "@/lib/dates";
import type { FicheEntreprise } from "@/lib/entreprise/fiche";
import { LIBELLES_CHAMP, champsManquants, type ChampEntreprise } from "@/lib/entreprise/regles";
import type { Conducteur } from "@/lib/flotte/conducteurs";
import {
  CHAMPS_CONDUCTEUR,
  CHAMPS_REQUIS_CONDUCTEUR,
  LIBELLES_CHAMP_CONDUCTEUR,
  LIBELLES_CIVILITE,
  champsManquantsConducteur,
  nomComplet,
  type ChampConducteur,
} from "@/lib/flotte/regles";
import { LIBELLES_CHAMP_AVIS, MESSAGES_AVIS, type StatutAvis } from "./regles";

// Le récap ANTAI (phase 11) : quand il s'ouvre, et ce qu'il contient. Sans dépendance serveur : l'écriture
// (avis.ts) et l'écran lisent les mêmes règles. Les champs requis restent ceux des fiches conducteur et entreprise.

/** La cible du bouton « Désignez ou contestez votre amende » de antai.gouv.fr : la saisie du n° d'avis. */
export const URL_ANTAI = "https://www.usagers.antai.gouv.fr/demarches/saisienumero?lang=fr";

type AvisRecap = {
  statut: StatutAvis;
  vehicule_id: string | null;
  conducteur_id: string | null;
  verrouille: boolean;
  vehicule_lecture_seule: boolean;
};
type ConducteurRecap = Pick<Conducteur, "prenom" | "nom" | "archive_le">;

/**
 * Pourquoi le récap ne s'ouvre pas, ou `null` s'il s'ouvre : sur un avis « À valider », ni verrouillé ni bloqué par son
 * véhicule en lecture seule, rattaché à un véhicule, dont le conducteur validé est actif. Un avis désigné garde son
 * récap, consultable pour mémoire.
 */
export function refusRecap(avis: AvisRecap, conducteur: ConducteurRecap | null): string | null {
  if (avis.statut === "designe") return conducteur ? null : MESSAGES_AVIS.recapSansConducteur;
  if (avis.statut === "classe") return MESSAGES_AVIS.recapClasse;
  if (avis.verrouille) return MESSAGES_AVIS.verrouille;
  if (avis.vehicule_lecture_seule) return MESSAGES_AVIS.vehiculeLectureSeule;
  if (avis.statut === "a_traiter") return MESSAGES_AVIS.validationAvantVerification;
  if (!avis.vehicule_id) return MESSAGES_AVIS.validationSansVehicule;
  if (!avis.conducteur_id || !conducteur) return MESSAGES_AVIS.recapSansConducteur;
  if (conducteur.archive_le) return MESSAGES_AVIS.recapConducteurArchive(nomComplet(conducteur));
  return null;
}

export type ManquantsRecap = { conducteur: ChampConducteur[]; entreprise: ChampEntreprise[] };

/** Les champs requis encore vides des deux fiches que reprend le récap : ils se complètent sur place. */
export function manquantsRecap({
  conducteur,
  entreprise,
}: {
  conducteur: Partial<Record<ChampConducteur, unknown>>;
  entreprise: FicheEntreprise;
}): ManquantsRecap {
  return { conducteur: champsManquantsConducteur(conducteur), entreprise: champsManquants(entreprise) };
}

/**
 * Pourquoi l'avis ne peut pas passer « Désigné », ou `null` : seulement depuis un récap ouvert, une fois les deux
 * fiches complètes. La seule règle, lue par l'écriture et par l'écran.
 */
export function refusDesignation({
  avis,
  conducteur,
  entreprise,
}: {
  avis: AvisRecap;
  conducteur: Conducteur | null;
  entreprise: FicheEntreprise;
}): string | null {
  if (avis.statut === "designe") return MESSAGES_AVIS.dejaDesigne;
  const refus = refusRecap(avis, conducteur);
  if (refus || !conducteur) return refus ?? MESSAGES_AVIS.recapSansConducteur;
  const manquants = manquantsRecap({ conducteur, entreprise });
  return manquants.conducteur.length || manquants.entreprise.length ? MESSAGES_AVIS.recapIncomplet : null;
}

/**
 * Pourquoi le conducteur ne peut pas être prévenu par email, ou `null` : en Pro, et s'il a un email. La seule règle, lue
 * par l'écran (cadenas, case désactivée ou aperçu) et par l'écriture, qui relit le plan au clic.
 */
export function refusPrevenir({
  plan,
  conducteur,
}: {
  plan: Plan;
  conducteur: Pick<Conducteur, "prenom" | "nom" | "email">;
}): string | null {
  if (plan !== "pro") return MESSAGES_AVIS.emailConducteurPro;
  if (!conducteur.email) return MESSAGES_AVIS.emailConducteurManquant(nomComplet(conducteur));
  return null;
}

export type ChampRecap = { cle: string; libelle: string; valeur: string };
export type BlocRecap = { titre: "Avis" | "Entreprise" | "Conducteur"; champs: ChampRecap[] };

/** Les champs de l'entreprise, dans l'ordre du formulaire de l'ANTAI. */
const CHAMPS_ENTREPRISE_RECAP = [
  "raison_sociale",
  "siren",
  "representant_nom",
  "representant_prenom",
  "representant_fonction",
] as const satisfies readonly ChampEntreprise[];

/** La valeur d'un champ de la fiche conducteur telle qu'on la recopie : « M. », JJ/MM/AAAA, « B, C1 ». */
function valeurConducteur(conducteur: Pick<Conducteur, ChampConducteur>, champ: ChampConducteur): string {
  if (champ === "civilite") return conducteur.civilite ? LIBELLES_CIVILITE[conducteur.civilite] : "";
  if (champ === "date_naissance" || champ === "permis_delivre_le") {
    const date = conducteur[champ];
    return date ? depuisIso(date) : "";
  }
  const valeur = conducteur[champ];
  return Array.isArray(valeur) ? valeur.join(", ") : (valeur ?? "");
}

/**
 * Les 3 blocs du récap, à recopier champ par champ sur l'ANTAI. La date et l'heure de l'infraction (heure de Paris)
 * se copient à part. Le bloc Conducteur reprend les champs requis de la fiche, dans son ordre, et le complément
 * d'adresse s'il est rempli : un champ ajouté à `CHAMPS_REQUIS_CONDUCTEUR` y apparaît sans autre modification.
 */
export function contenuRecap(
  {
    avis,
    entreprise,
    conducteur,
  }: {
    avis: { numero: string | null; plaque: string | null; infraction_le: string | null };
    entreprise: FicheEntreprise;
    conducteur: Pick<Conducteur, ChampConducteur>;
  },
  requis: readonly ChampConducteur[] = CHAMPS_REQUIS_CONDUCTEUR,
): BlocRecap[] {
  const infraction = avis.infraction_le ? partiesParis(avis.infraction_le) : null;
  const champsConducteur = CHAMPS_CONDUCTEUR.filter(
    (champ) => requis.includes(champ) || (champ === "adresse_complement" && conducteur.adresse_complement),
  );

  return [
    {
      titre: "Avis",
      champs: [
        { cle: "avis.numero", libelle: LIBELLES_CHAMP_AVIS.numero, valeur: avis.numero ?? "" },
        { cle: "avis.date", libelle: "Date de l'infraction", valeur: infraction ? depuisIso(infraction.date) : "" },
        { cle: "avis.heure", libelle: "Heure de l'infraction", valeur: infraction?.heure ?? "" },
        { cle: "avis.plaque", libelle: LIBELLES_CHAMP_AVIS.plaque, valeur: avis.plaque ?? "" },
      ],
    },
    {
      titre: "Entreprise",
      champs: CHAMPS_ENTREPRISE_RECAP.map((champ) => ({
        cle: `entreprise.${champ}`,
        libelle: LIBELLES_CHAMP[champ],
        valeur: entreprise[champ] ?? "",
      })),
    },
    {
      titre: "Conducteur",
      champs: champsConducteur.map((champ) => ({
        cle: `conducteur.${champ}`,
        libelle: LIBELLES_CHAMP_CONDUCTEUR[champ],
        valeur: valeurConducteur(conducteur, champ),
      })),
    },
  ];
}
