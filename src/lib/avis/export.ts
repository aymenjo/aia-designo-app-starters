import type { SupabaseClient } from "@supabase/supabase-js";
import { texteForce, type Cellule } from "@/lib/csv";
import { depuisIso, partiesParis } from "@/lib/dates";
import { nomComplet } from "@/lib/flotte/regles";
import { formaterDate, formaterMontantSaisie } from "@/lib/format";
import { COLONNES_AVIS_AVEC_CONDUCTEUR, type AvisAvecConducteur } from "./avis";
import { LIBELLES_MOTIF_CLASSEMENT, LIBELLES_STATUT } from "./regles";

// L'export CSV des avis (phase 24, Pro) : tout l'historique, pour la comptabilité ou l'archive. Aucune donnée
// personnelle du conducteur hors son nom.

export const MESSAGES_EXPORT = {
  fonctionPro: "L'export CSV est une fonction Pro.",
} as const;

type Colonne = { entete: string; valeur: (avis: AvisAvecConducteur) => Cellule };

/** Une date du calendrier (date d'envoi, échéance) : JJ/MM/AAAA. */
const jour = (iso: string | null) => (iso ? depuisIso(iso) : null);
/** Le jour d'un geste (désignation, classement, dépôt), à l'heure de Paris : JJ/MM/AAAA. */
const jourDuGeste = (instant: string | null) => (instant ? formaterDate(instant) : null);

/**
 * Les colonnes du fichier, dans leur ordre. Excel en français reconnaît les dates, les heures et les montants
 * (« 135,00 ») ; le n° d'avis est forcé en texte, pour garder ses zéros de tête. Un champ vide donne une cellule vide.
 */
export const COLONNES_EXPORT: readonly Colonne[] = [
  { entete: "N° d'avis", valeur: (avis) => (avis.numero ? texteForce(avis.numero) : null) },
  { entete: "Plaque", valeur: (avis) => avis.plaque },
  {
    entete: "Date de l'infraction",
    valeur: (avis) => (avis.infraction_le ? depuisIso(partiesParis(avis.infraction_le).date) : null),
  },
  { entete: "Heure", valeur: (avis) => (avis.infraction_le ? partiesParis(avis.infraction_le).heure : null) },
  { entete: "Lieu", valeur: (avis) => avis.lieu },
  { entete: "Infraction", valeur: (avis) => avis.infraction },
  {
    entete: "Montant (€)",
    valeur: (avis) => (avis.montant_centimes ? formaterMontantSaisie(avis.montant_centimes) : null),
  },
  { entete: "Date d'envoi", valeur: (avis) => jour(avis.date_envoi) },
  { entete: "Échéance", valeur: (avis) => jour(avis.echeance) },
  { entete: "Statut", valeur: (avis) => LIBELLES_STATUT[avis.statut] },
  {
    entete: "Motif de classement",
    valeur: (avis) =>
      avis.motif_classement ? (avis.motif_libre ?? LIBELLES_MOTIF_CLASSEMENT[avis.motif_classement]) : null,
  },
  // Le conducteur validé d'un avis à valider, ou classé depuis, n'a pas été désigné.
  {
    entete: "Conducteur désigné",
    valeur: (avis) => (avis.statut === "designe" && avis.conducteur ? nomComplet(avis.conducteur) : null),
  },
  { entete: "Date de désignation", valeur: (avis) => jourDuGeste(avis.designe_le) },
  { entete: "Date de classement", valeur: (avis) => jourDuGeste(avis.classe_le) },
  { entete: "Déposé le", valeur: (avis) => jourDuGeste(avis.depose_le) },
];

/** La ligne d'en-têtes, puis une ligne par avis : ce qu'écrit `ecrireCsv`. */
export function lignesExport(avis: readonly AvisAvecConducteur[]): Cellule[][] {
  return [
    COLONNES_EXPORT.map(({ entete }) => entete),
    ...avis.map((un) => COLONNES_EXPORT.map(({ valeur }) => valeur(un))),
  ];
}

// Le `max_rows` de PostgREST (1 000) tronquerait l'historique sans prévenir : les avis sont lus page par page.
const PAGE = 1000;

/**
 * Tous les avis de l'entreprise (RLS), avec le nom de leur conducteur validé, du dernier déposé au premier. L'id
 * départage les avis déposés au même instant, pour que les pages ne se chevauchent pas.
 */
export async function listerAvisPourExport(supabase: SupabaseClient): Promise<AvisAvecConducteur[]> {
  const avis: AvisAvecConducteur[] = [];
  for (let debut = 0; ; debut += PAGE) {
    const { data, error } = await supabase
      .from("avis")
      .select(COLONNES_AVIS_AVEC_CONDUCTEUR)
      .order("depose_le", { ascending: false })
      .order("id")
      .range(debut, debut + PAGE - 1)
      .overrideTypes<AvisAvecConducteur[], { merge: false }>();
    if (error) throw error;
    avis.push(...data);
    if (data.length < PAGE) return avis;
  }
}

/** « designo-avis-2026-10-29.csv » : le jour de l'export, à Paris. */
export function nomFichierExport(aujourdhui: string) {
  return `designo-avis-${aujourdhui}.csv`;
}
