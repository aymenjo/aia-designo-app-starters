import type { SupabaseClient } from "@supabase/supabase-js";
import { premieresErreurs } from "@/lib/saisie";
import {
  CHAMPS_DIRECTION,
  CHAMPS_ENTREPRISE,
  MESSAGES,
  schemaEntreprise,
  verifierEmailsDirection,
  type ChampDirection,
  type ChampEntreprise,
  type ErreursEntreprise,
  type SaisieEntreprise,
} from "./regles";

// Lecture et écriture de la fiche entreprise, sous la session du gestionnaire (RLS).

export type FicheEntreprise = Record<ChampEntreprise, string | null>;

export const COLONNES_FICHE = CHAMPS_ENTREPRISE.join(", ");

/** La fiche et les adresses « direction » (phase 25), saisies sur le même écran. */
export type FicheAvecDirection = FicheEntreprise & { emails_direction: string[] };

const COLONNES_FICHE_DIRECTION = `${COLONNES_FICHE}, emails_direction`;

/** Valeurs du formulaire : un champ vide y est une chaîne vide, pas `null`. */
export type ValeursEntreprise = Record<ChampEntreprise, string>;

export type ResultatFiche = { ok: true; fiche: FicheAvecDirection } | { ok: false; erreurs: ErreursEntreprise };

/** Les champs « direction » du formulaire : une adresse par champ, dans l'ordre, puis des champs vides. */
export type ValeursDirection = Record<ChampDirection, string>;

export function versValeurs(fiche: FicheEntreprise): ValeursEntreprise {
  const valeurs = {} as ValeursEntreprise;
  for (const champ of CHAMPS_ENTREPRISE) valeurs[champ] = fiche[champ] ?? "";
  return valeurs;
}

export function versValeursDirection(emails: readonly string[]): ValeursDirection {
  return Object.fromEntries(CHAMPS_DIRECTION.map((champ, rang) => [champ, emails[rang] ?? ""])) as ValeursDirection;
}

/** La fiche de l'entreprise du gestionnaire : RLS n'en laisse voir qu'une. */
export async function lireFiche(supabase: SupabaseClient): Promise<FicheAvecDirection> {
  const { data, error } = await supabase
    .from("entreprise")
    .select(COLONNES_FICHE_DIRECTION)
    .single<FicheAvecDirection>();
  if (error) throw error;
  return data;
}

/**
 * Enregistre la fiche, et les adresses « direction » si elles sont fournies : sans elles (plan Free, récap ANTAI), les
 * adresses déjà saisies restent telles quelles.
 */
export async function enregistrerFiche(
  supabase: SupabaseClient,
  saisie: SaisieEntreprise,
  direction?: readonly string[],
): Promise<ResultatFiche> {
  const valide = schemaEntreprise.safeParse(saisie);
  const adresses = direction && verifierEmailsDirection(direction);
  const erreurs = { ...(valide.success ? {} : premieresErreurs<ChampEntreprise>(valide.error)), ...adresses?.erreurs };
  if (!valide.success || Object.keys(erreurs).length) return { ok: false, erreurs };

  // PostgREST refuse une modification sans filtre : on vise l'entreprise de la session, que RLS impose de toute façon.
  const { data: session } = await supabase.auth.getClaims();
  const { data, error } = await supabase
    .from("entreprise")
    .update({ ...valide.data, ...(adresses && { emails_direction: adresses.emails }) })
    .eq("user_id", session?.claims.sub ?? "")
    .select(COLONNES_FICHE_DIRECTION)
    .single<FicheAvecDirection>();
  if (error) {
    console.error("entreprise", error.code, error.message);
    return { ok: false, erreurs: { general: MESSAGES.enregistrementImpossible } };
  }
  return { ok: true, fiche: data };
}

/**
 * Complète la fiche sans rien effacer : la saisie, même partielle, se fond dans la fiche actuelle, puis toutes les
 * règles s'appliquent, croisées comprises (la TVA porte le SIREN). Reprise par le récap ANTAI (phase 11).
 */
export async function completerFiche(supabase: SupabaseClient, saisie: SaisieEntreprise): Promise<ResultatFiche> {
  const { data, error } = await supabase.from("entreprise").select(COLONNES_FICHE).single<FicheEntreprise>();
  if (error) {
    console.error("entreprise", error.code, error.message);
    return { ok: false, erreurs: { general: MESSAGES.enregistrementImpossible } };
  }
  return enregistrerFiche(supabase, { ...versValeurs(data), ...saisie });
}
