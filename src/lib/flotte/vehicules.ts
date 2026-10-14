import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { premieresErreurs } from "@/lib/saisie";
import { affectationOuverte, messageAffectationEnCours } from "./affectations";
import {
  MESSAGES,
  nomAbrege,
  schemaIdVehicule,
  schemaVehicule,
  type ChampVehicule,
  type ErreursVehicule,
  type SaisieVehicule,
  type TypeVehicule,
} from "./regles";

// Écritures des véhicules, sous la session du gestionnaire (RLS).
// Les écrans, l'import CSV et l'agent passent tous par ici.

export type Vehicule = {
  id: string;
  plaque: string;
  modele: string | null;
  type: TypeVehicule;
  archive_le: string | null;
};

export const COLONNES_VEHICULE = "id, plaque, modele, type, archive_le";

export type ResultatVehicule =
  | { ok: true; vehicule: Vehicule }
  | { ok: false; erreurs: ErreursVehicule; vehiculeArchiveId?: string };

type Reponse = { data: Vehicule | null; error: PostgrestError | null };

const VIOLATION_UNICITE = "23505";
const CLE_ETRANGERE = "23503";
const INTROUVABLE: ResultatVehicule = { ok: false, erreurs: { general: MESSAGES.vehiculeIntrouvable } };

/** Retrouve le véhicule qui porte déjà la plaque : la contrainte d'unicité fait foi, même en concurrence. */
async function plaqueDejaPrise(supabase: SupabaseClient, plaque: string): Promise<ResultatVehicule> {
  const { data } = await supabase.from("vehicule").select("id, archive_le").eq("plaque", plaque).maybeSingle();
  if (data?.archive_le) {
    return { ok: false, erreurs: { plaque: MESSAGES.plaqueArchivee(plaque) }, vehiculeArchiveId: data.id };
  }
  return { ok: false, erreurs: { plaque: MESSAGES.plaqueDejaPresente(plaque) } };
}

async function resultat(supabase: SupabaseClient, { data, error }: Reponse, plaque?: string) {
  if (error) {
    if (error.code === VIOLATION_UNICITE && plaque) return plaqueDejaPrise(supabase, plaque);
    console.error("vehicule", error.code, error.message);
    return { ok: false, erreurs: { general: MESSAGES.enregistrementImpossible } } as const;
  }
  return data ? ({ ok: true, vehicule: data } as const) : INTROUVABLE;
}

function lireVehicule(supabase: SupabaseClient, id: string) {
  return supabase.from("vehicule").select(COLONNES_VEHICULE).eq("id", id).maybeSingle<Vehicule>();
}

export async function creerVehicule(supabase: SupabaseClient, saisie: SaisieVehicule): Promise<ResultatVehicule> {
  const valide = schemaVehicule.safeParse(saisie);
  if (!valide.success) return { ok: false, erreurs: premieresErreurs<ChampVehicule>(valide.error) };

  const reponse = await supabase
    .from("vehicule")
    .insert(valide.data)
    .select(COLONNES_VEHICULE)
    .single<Vehicule>();
  return resultat(supabase, reponse, valide.data.plaque);
}

export async function modifierVehicule(
  supabase: SupabaseClient,
  id: string,
  saisie: SaisieVehicule,
): Promise<ResultatVehicule> {
  if (!schemaIdVehicule.safeParse(id).success) return INTROUVABLE;
  const valide = schemaVehicule.safeParse(saisie);
  if (!valide.success) return { ok: false, erreurs: premieresErreurs<ChampVehicule>(valide.error) };

  // Un véhicule de pool n'a que des affectations avec une fin.
  if (valide.data.type === "pool") {
    const ouverte = await affectationOuverte(supabase, { vehicule_id: id });
    if (ouverte.error) return resultat(supabase, { data: null, error: ouverte.error });
    if (ouverte.data) {
      return { ok: false, erreurs: { type: MESSAGES.poolAvecAffectationOuverte(nomAbrege(ouverte.data.conducteur)) } };
    }
  }

  const reponse = await supabase
    .from("vehicule")
    .update(valide.data)
    .eq("id", id)
    .select(COLONNES_VEHICULE)
    .maybeSingle<Vehicule>();
  return resultat(supabase, reponse, valide.data.plaque);
}

/** Archiver deux fois garde la date du premier archivage. Une affectation ouverte doit d'abord être clôturée. */
export async function archiverVehicule(supabase: SupabaseClient, id: string): Promise<ResultatVehicule> {
  if (!schemaIdVehicule.safeParse(id).success) return INTROUVABLE;

  const ouverte = await affectationOuverte(supabase, { vehicule_id: id });
  if (ouverte.error) return resultat(supabase, { data: null, error: ouverte.error });
  if (ouverte.data) return { ok: false, erreurs: { general: messageAffectationEnCours(ouverte.data) } };

  const reponse = await supabase
    .from("vehicule")
    .update({ archive_le: new Date().toISOString() })
    .eq("id", id)
    .is("archive_le", null)
    .select(COLONNES_VEHICULE)
    .maybeSingle<Vehicule>();
  if (!reponse.error && !reponse.data) return resultat(supabase, await lireVehicule(supabase, id));
  return resultat(supabase, reponse);
}

/** La limite Free (phase 17) s'appliquera ici comme à l'ajout. */
export async function reactiverVehicule(supabase: SupabaseClient, id: string): Promise<ResultatVehicule> {
  if (!schemaIdVehicule.safeParse(id).success) return INTROUVABLE;

  const reponse = await supabase
    .from("vehicule")
    .update({ archive_le: null })
    .eq("id", id)
    .select(COLONNES_VEHICULE)
    .maybeSingle<Vehicule>();
  return resultat(supabase, reponse);
}

/** Seulement sans historique : avec des affectations (ou des avis), la base refuse, et il s'archive. */
export async function supprimerVehicule(supabase: SupabaseClient, id: string): Promise<ResultatVehicule> {
  if (!schemaIdVehicule.safeParse(id).success) return INTROUVABLE;

  const reponse = await supabase
    .from("vehicule")
    .delete()
    .eq("id", id)
    .select(COLONNES_VEHICULE)
    .maybeSingle<Vehicule>();
  if (reponse.error?.code === CLE_ETRANGERE) return { ok: false, erreurs: { general: MESSAGES.vehiculeAvecHistorique } };
  return resultat(supabase, reponse);
}
