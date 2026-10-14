import type { SupabaseClient } from "@supabase/supabase-js";
import { premieresErreurs } from "@/lib/saisie";
import {
  CHAMPS_ENTREPRISE,
  MESSAGES,
  schemaEntreprise,
  type ChampEntreprise,
  type ErreursEntreprise,
  type SaisieEntreprise,
} from "./regles";

// Lecture et écriture de la fiche entreprise, sous la session du gestionnaire (RLS).

export type FicheEntreprise = Record<ChampEntreprise, string | null>;

export const COLONNES_FICHE = CHAMPS_ENTREPRISE.join(", ");

/** Valeurs du formulaire : un champ vide y est une chaîne vide, pas `null`. */
export type ValeursEntreprise = Record<ChampEntreprise, string>;

export type ResultatFiche = { ok: true; fiche: FicheEntreprise } | { ok: false; erreurs: ErreursEntreprise };

export function versValeurs(fiche: FicheEntreprise): ValeursEntreprise {
  const valeurs = {} as ValeursEntreprise;
  for (const champ of CHAMPS_ENTREPRISE) valeurs[champ] = fiche[champ] ?? "";
  return valeurs;
}

/** La fiche de l'entreprise du gestionnaire : RLS n'en laisse voir qu'une. */
export async function lireFiche(supabase: SupabaseClient): Promise<FicheEntreprise> {
  const { data, error } = await supabase.from("entreprise").select(COLONNES_FICHE).single<FicheEntreprise>();
  if (error) throw error;
  return data;
}

export async function enregistrerFiche(supabase: SupabaseClient, saisie: SaisieEntreprise): Promise<ResultatFiche> {
  const valide = schemaEntreprise.safeParse(saisie);
  if (!valide.success) return { ok: false, erreurs: premieresErreurs<ChampEntreprise>(valide.error) };

  // PostgREST refuse une modification sans filtre : on vise l'entreprise de la session, que RLS impose de toute façon.
  const { data: session } = await supabase.auth.getClaims();
  const { data, error } = await supabase
    .from("entreprise")
    .update(valide.data)
    .eq("user_id", session?.claims.sub ?? "")
    .select(COLONNES_FICHE)
    .single<FicheEntreprise>();
  if (error) {
    console.error("entreprise", error.code, error.message);
    return { ok: false, erreurs: { general: MESSAGES.enregistrementImpossible } };
  }
  return { ok: true, fiche: data };
}
