import type { SupabaseClient } from "@supabase/supabase-js";
import { ajouterJours, ajouterMois } from "@/lib/dates";
import { bornesMois, moisDuRapport } from "./synthese";

// Les rapports mensuels archivés (phase 25) : l'écran /rapports les liste sous la session du gestionnaire (RLS), et le
// téléchargement rend le PDF figé à l'envoi. La tâche du rapport les écrit avec la clé secrète (src/lib/rapport/rapports.ts).

export const BUCKET_RAPPORTS = "rapports";

export const MESSAGES_RAPPORT = {
  fonctionPro: "Le rapport mensuel est une fonction Pro.",
  introuvable: "Rapport introuvable.",
} as const;

export type RapportMensuel = {
  /** Le 1er du mois du rapport, en ISO. */
  mois: string;
  genere_le: string;
  envoye_le: string | null;
  /** Les adresses en « À », puis en « Cc ». */
  envoye_a: string[] | null;
};

/** « 2026-10-01 » → « {entreprise_id}/2026-10.pdf » : un chemin fixe par mois, que la base vérifie aussi. */
export function cheminRapport(entrepriseId: string, mois: string) {
  return `${entrepriseId}/${mois.slice(0, 7)}.pdf`;
}

/** « 2026-10-01 » → « rapport-flotte-2026-10.pdf » : la pièce jointe et le fichier téléchargé. */
export function nomFichierRapport(mois: string) {
  return `rapport-flotte-${mois.slice(0, 7)}.pdf`;
}

/** « 2026-10 », le segment de l'adresse de téléchargement → « 2026-10-01 », ou `null` s'il ne désigne pas un mois. */
export function moisDepuisSegment(segment: string): string | null {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(segment) ? `${segment}-01` : null;
}

/** Les rapports de l'entreprise, du plus récent au plus ancien. */
export async function listerRapports(supabase: SupabaseClient): Promise<RapportMensuel[]> {
  const { data, error } = await supabase
    .from("rapport_mensuel")
    .select("mois, genere_le, envoye_le, envoye_a")
    .order("mois", { ascending: false })
    .overrideTypes<RapportMensuel[], { merge: false }>();
  if (error) throw error;
  return data;
}

export type EtatEnvoi = "envoye" | "en_attente" | "non_envoye";

/**
 * Le rapport du mois écoulé dont l'email n'est pas parti attend la tâche du lendemain, qui le retente. Un rapport plus
 * ancien ne sera plus envoyé : il reste téléchargeable.
 */
export function etatEnvoi(rapport: Pick<RapportMensuel, "mois" | "envoye_le">, aujourdhui: string): EtatEnvoi {
  if (rapport.envoye_le) return "envoye";
  return rapport.mois === moisDuRapport(aujourdhui) ? "en_attente" : "non_envoye";
}

/**
 * Le jour où part le prochain rapport. Celui du mois écoulé, s'il est dû et pas encore parti, part au passage suivant
 * de la tâche : le lendemain. Sinon, le prochain est celui du mois en cours, le 1er du mois suivant.
 */
export function prochainRapportLe({
  entrepriseCreeeLe,
  rapports,
  aujourdhui,
}: {
  entrepriseCreeeLe: string;
  rapports: readonly Pick<RapportMensuel, "mois" | "envoye_le">[];
  aujourdhui: string;
}): string {
  const mois = moisDuRapport(aujourdhui);
  const du = Date.parse(entrepriseCreeeLe) < Date.parse(bornesMois(mois).fin);
  const parti = rapports.some((rapport) => rapport.mois === mois && rapport.envoye_le);
  return du && !parti ? ajouterJours(aujourdhui, 1) : ajouterMois(mois, 2);
}
