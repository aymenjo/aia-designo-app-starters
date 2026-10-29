import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { depuisIso } from "@/lib/dates";
import { premieresErreurs } from "@/lib/saisie";
import { affectationOuverte, messageAffectationEnCours } from "./affectations";
import {
  CHAMPS_CONDUCTEUR,
  MESSAGES,
  nomComplet,
  schemaConducteur,
  schemaIdConducteur,
  type ChampConducteur,
  type Civilite,
  type ErreursConducteur,
  type SaisieConducteur,
} from "./regles";

// Écritures des conducteurs, sous la session du gestionnaire (RLS).
// Les écrans, l'import CSV et l'agent passent tous par ici.

export type Conducteur = {
  id: string;
  civilite: Civilite | null;
  prenom: string;
  nom: string;
  date_naissance: string | null;
  lieu_naissance: string | null;
  adresse: string | null;
  adresse_complement: string | null;
  code_postal: string | null;
  ville: string | null;
  permis_numero: string | null;
  permis_delivre_le: string | null;
  permis_categories: string[] | null;
  email: string | null;
  archive_le: string | null;
};

export const COLONNES_CONDUCTEUR = `id, ${CHAMPS_CONDUCTEUR.join(", ")}, archive_le`;

/** Valeurs du formulaire : dates JJ/MM/AAAA, catégories « B, C1 », et un champ vide est une chaîne vide. */
export type ValeursConducteur = Record<ChampConducteur, string>;

export function versValeurs(conducteur: Conducteur): ValeursConducteur {
  const valeurs = {} as ValeursConducteur;
  for (const champ of CHAMPS_CONDUCTEUR) {
    const valeur = conducteur[champ];
    valeurs[champ] = Array.isArray(valeur) ? valeur.join(", ") : (valeur ?? "");
  }
  for (const champ of ["date_naissance", "permis_delivre_le"] as const) {
    if (conducteur[champ]) valeurs[champ] = depuisIso(conducteur[champ]);
  }
  return valeurs;
}

export type ResultatConducteur =
  | { ok: true; conducteur: Conducteur }
  | { ok: false; erreurs: ErreursConducteur; conducteurArchiveId?: string };

type Reponse = { data: Conducteur | null; error: PostgrestError | null };
type Uniques = { permis_numero: string | null; email: string | null };

const VIOLATION_UNICITE = "23505";
const CLE_ETRANGERE = "23503";
const ECHEC: ResultatConducteur = { ok: false, erreurs: { general: MESSAGES.enregistrementImpossible } };
const INTROUVABLE: ResultatConducteur = { ok: false, erreurs: { general: MESSAGES.conducteurIntrouvable } };

/** Le champ unique que la contrainte violée protège, d'après son nom (voir la migration). */
function champEnDoublon(error: PostgrestError): keyof Uniques | null {
  if (error.message.includes("conducteur_permis_unique")) return "permis_numero";
  if (error.message.includes("conducteur_email_unique")) return "email";
  return null;
}

/** Retrouve le conducteur qui porte déjà ce permis ou cet email : la contrainte d'unicité fait foi, même en concurrence. */
async function dejaPris(supabase: SupabaseClient, champ: keyof Uniques, valeur: string): Promise<ResultatConducteur> {
  const { data } = await supabase
    .from("conducteur")
    .select("id, prenom, nom, archive_le")
    .eq(champ, valeur)
    .maybeSingle<Pick<Conducteur, "id" | "prenom" | "nom" | "archive_le">>();
  if (!data) return ECHEC;
  const nom = nomComplet(data);
  if (data.archive_le) {
    const message = champ === "email" ? MESSAGES.emailArchive(nom) : MESSAGES.permisArchive(nom);
    return { ok: false, erreurs: { [champ]: message }, conducteurArchiveId: data.id };
  }
  const message = champ === "email" ? MESSAGES.emailDejaPresent(nom) : MESSAGES.permisDejaPresent(nom);
  return { ok: false, erreurs: { [champ]: message } };
}

async function resultat(supabase: SupabaseClient, { data, error }: Reponse, uniques?: Uniques) {
  if (error) {
    const champ = error.code === VIOLATION_UNICITE ? champEnDoublon(error) : null;
    const valeur = champ && uniques?.[champ];
    if (champ && valeur) return dejaPris(supabase, champ, valeur);
    console.error("conducteur", error.code, error.message);
    return ECHEC;
  }
  return data ? ({ ok: true, conducteur: data } as const) : INTROUVABLE;
}

function lireConducteur(supabase: SupabaseClient, id: string) {
  return supabase.from("conducteur").select(COLONNES_CONDUCTEUR).eq("id", id).maybeSingle<Conducteur>();
}

export async function creerConducteur(
  supabase: SupabaseClient,
  saisie: SaisieConducteur,
): Promise<ResultatConducteur> {
  const valide = schemaConducteur.safeParse(saisie);
  if (!valide.success) return { ok: false, erreurs: premieresErreurs<ChampConducteur>(valide.error) };

  const reponse = await supabase
    .from("conducteur")
    .insert(valide.data)
    .select(COLONNES_CONDUCTEUR)
    .single<Conducteur>();
  return resultat(supabase, reponse, valide.data);
}

export async function modifierConducteur(
  supabase: SupabaseClient,
  id: string,
  saisie: SaisieConducteur,
): Promise<ResultatConducteur> {
  if (!schemaIdConducteur.safeParse(id).success) return INTROUVABLE;
  const valide = schemaConducteur.safeParse(saisie);
  if (!valide.success) return { ok: false, erreurs: premieresErreurs<ChampConducteur>(valide.error) };

  const reponse = await supabase
    .from("conducteur")
    .update(valide.data)
    .eq("id", id)
    .select(COLONNES_CONDUCTEUR)
    .maybeSingle<Conducteur>();
  return resultat(supabase, reponse, valide.data);
}

/**
 * Complète une fiche sans rien effacer : la saisie, même partielle, se fond dans la fiche actuelle, puis toutes les
 * règles s'appliquent, croisées comprises (délivrance après les 14 ans). Reprise par le récap ANTAI (phase 11).
 */
export async function completerConducteur(
  supabase: SupabaseClient,
  id: string,
  saisie: SaisieConducteur,
): Promise<ResultatConducteur> {
  if (!schemaIdConducteur.safeParse(id).success) return INTROUVABLE;
  const actuel = await lireConducteur(supabase, id);
  if (actuel.error || !actuel.data) return resultat(supabase, actuel);
  return modifierConducteur(supabase, id, { ...versValeurs(actuel.data), ...saisie });
}

/**
 * Archiver deux fois garde la date du premier archivage. Une affectation ouverte doit d'abord être clôturée ;
 * une affectation qui se termine plus tard, à une date fixée, n'empêche pas l'archivage.
 */
export async function archiverConducteur(supabase: SupabaseClient, id: string): Promise<ResultatConducteur> {
  if (!schemaIdConducteur.safeParse(id).success) return INTROUVABLE;

  const ouverte = await affectationOuverte(supabase, { conducteur_id: id });
  if (ouverte.error) return resultat(supabase, { data: null, error: ouverte.error });
  if (ouverte.data) return { ok: false, erreurs: { general: messageAffectationEnCours(ouverte.data) } };

  const reponse = await supabase
    .from("conducteur")
    .update({ archive_le: new Date().toISOString() })
    .eq("id", id)
    .is("archive_le", null)
    .select(COLONNES_CONDUCTEUR)
    .maybeSingle<Conducteur>();
  if (!reponse.error && !reponse.data) return resultat(supabase, await lireConducteur(supabase, id));
  return resultat(supabase, reponse);
}

export async function reactiverConducteur(supabase: SupabaseClient, id: string): Promise<ResultatConducteur> {
  if (!schemaIdConducteur.safeParse(id).success) return INTROUVABLE;

  const reponse = await supabase
    .from("conducteur")
    .update({ archive_le: null })
    .eq("id", id)
    .select(COLONNES_CONDUCTEUR)
    .maybeSingle<Conducteur>();
  return resultat(supabase, reponse);
}

/** Seulement sans historique : avec des affectations (ou des avis), la base refuse, et il s'archive. */
export async function supprimerConducteur(supabase: SupabaseClient, id: string): Promise<ResultatConducteur> {
  if (!schemaIdConducteur.safeParse(id).success) return INTROUVABLE;

  const reponse = await supabase
    .from("conducteur")
    .delete()
    .eq("id", id)
    .select(COLONNES_CONDUCTEUR)
    .maybeSingle<Conducteur>();
  if (reponse.error?.code === CLE_ETRANGERE) {
    return { ok: false, erreurs: { general: MESSAGES.conducteurAvecHistorique } };
  }
  return resultat(supabase, reponse);
}
