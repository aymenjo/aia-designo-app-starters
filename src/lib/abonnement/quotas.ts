import type { SupabaseClient } from "@supabase/supabase-js";
import { ajouterMois, aujourdhuiParis, instantParis } from "@/lib/dates";
import { LIMITES_FREE, type Plan } from "./plans";

// Le plan Free côté app (phase 17) : le compteur d'usage, la remise à zéro du mois et l'historique limité. Les quotas
// eux-mêmes vivent en base, dans des triggers (migration du plan Free) : le client écrit aussi directement par l'API.
// `aujourdhui` est injecté, comme pour les alertes.

/**
 * Ce que compte le plan Free : les véhicules actifs (ni archivés, ni en lecture seule), et les avis comptés dans le
 * quota du mois (verrouillés exclus). Plus les véhicules en lecture seule non archivés, ceux du retour en Free (phase 19).
 */
export type Usage = { vehicules: number; avisCeMois: number; enLectureSeule: number };

/** « 2026-10-18 » → « 2026-10-01 » : le mois dont le quota compte les avis déposés ce jour-là, à Paris. */
export function moisQuota(aujourdhui = aujourdhuiParis()): string {
  return `${aujourdhui.slice(0, 7)}-01`;
}

/** « 2026-10-18 » → « 2026-11-01 » : la remise à zéro du quota d'avis, qui déverrouille les avis verrouillés. */
export function prochainDeverrouillage(aujourdhui = aujourdhuiParis()): string {
  return ajouterMois(moisQuota(aujourdhui), 1);
}

/** L'usage de l'entreprise du gestionnaire (RLS), en trois comptes sans lire les lignes. */
export async function lireUsage(supabase: SupabaseClient, aujourdhui = aujourdhuiParis()): Promise<Usage> {
  const nonArchives = () => supabase.from("vehicule").select("id", { count: "exact", head: true }).is("archive_le", null);
  const [vehicules, enLectureSeule, avis] = await Promise.all([
    nonArchives().is("lecture_seule_le", null),
    nonArchives().not("lecture_seule_le", "is", null),
    supabase.from("avis").select("id", { count: "exact", head: true }).eq("mois_quota", moisQuota(aujourdhui)),
  ]);
  for (const { error } of [vehicules, enLectureSeule, avis]) if (error) throw error;
  return { vehicules: vehicules.count ?? 0, avisCeMois: avis.count ?? 0, enLectureSeule: enLectureSeule.count ?? 0 };
}

/**
 * Le choix des véhicules actifs est à faire (`/flotte/vehicules-actifs`) : en Free, aucun véhicule actif, et au moins un
 * en lecture seule. C'est le retour en Free avec plus de 3 véhicules, qui les a tous passés en lecture seule. Un véhicule
 * archivé, même en lecture seule, ne compte pas : il n'y a rien à choisir.
 */
export function choixVehiculesRequis({ plan, vehicules, enLectureSeule }: Usage & { plan: Plan }): boolean {
  return plan === "free" && vehicules === 0 && enLectureSeule > 0;
}

/**
 * Le début de l'historique visible : `null` en Pro, où tout est visible. En Free, minuit à Paris il y a 3 mois : un avis
 * désigné ou classé avant est masqué. La date de clôture fait foi, et non celle du dépôt : un vieil avis ouvert qu'on
 * désigne aujourd'hui reste visible.
 */
export function debutHistorique(plan: Plan, aujourdhui = aujourdhuiParis()): string | null {
  if (plan === "pro") return null;
  // Minuit existe toujours à Paris : le changement d'heure a lieu à 02:00 ou 03:00.
  return instantParis(ajouterMois(aujourdhui, -LIMITES_FREE.historiqueMois), "00:00")!;
}

/** Masqué par l'historique Free : désigné ou classé avant `debut`. Un avis ouvert n'est jamais masqué. */
export function masqueParHistorique(
  avis: { designe_le: string | null; classe_le: string | null },
  debut: string | null,
): boolean {
  const cloture = avis.designe_le ?? avis.classe_le;
  return Boolean(debut && cloture) && Date.parse(cloture!) < Date.parse(debut!);
}

/**
 * La tâche quotidienne (`/api/cron/deverrouillage`) : les avis verrouillés des mois passés entrent dans le quota du mois,
 * dans la limite de ses places (voir la migration). `supabase` porte la clé secrète. Renvoie le nombre d'avis déverrouillés.
 */
export async function deverrouillerAvis({
  supabase,
  aujourdhui = aujourdhuiParis(),
}: {
  supabase: SupabaseClient;
  aujourdhui?: string;
}): Promise<number> {
  const { data, error } = await supabase.rpc("deverrouiller_avis_du_mois", { p_aujourdhui: aujourdhui });
  if (error) throw new Error(`déverrouillage : ${error.code} ${error.message}`);
  return data as number;
}
