import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { estOuvert, type StatutAvis } from "@/lib/avis/regles";
import { premieresErreurs } from "@/lib/saisie";
import { affectationOuverte, messageAffectationEnCours } from "./affectations";
import {
  ERREUR_LIMITE_VEHICULES,
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
  /** Le passage en lecture seule, au retour en Free (phase 19) : vide quand le véhicule est actif. */
  lecture_seule_le: string | null;
};

export const COLONNES_VEHICULE = "id, plaque, modele, type, archive_le, lecture_seule_le";

export type ResultatVehicule =
  | { ok: true; vehicule: Vehicule }
  | {
      ok: false;
      erreurs: ErreursVehicule;
      vehiculeArchiveId?: string;
      /** La limite Free est atteinte : le refus invite à passer en Pro. */
      invitationPro?: true;
    };

type Reponse = { data: Vehicule | null; error: PostgrestError | null };

const VIOLATION_UNICITE = "23505";
const CLE_ETRANGERE = "23503";
const INTROUVABLE: ResultatVehicule = { ok: false, erreurs: { general: MESSAGES.vehiculeIntrouvable } };

/** En Free, la base refuse un véhicule qui deviendrait le 4e actif (voir la migration du plan Free). */
function limiteAtteinte(error: PostgrestError | null, message: string): ResultatVehicule | null {
  if (error?.code !== "P0001" || error.message !== ERREUR_LIMITE_VEHICULES) return null;
  return { ok: false, erreurs: { general: message }, invitationPro: true };
}

/** Retrouve le véhicule qui porte déjà la plaque : la contrainte d'unicité fait foi, même en concurrence. */
async function plaqueDejaPrise(supabase: SupabaseClient, plaque: string): Promise<ResultatVehicule> {
  const { data } = await supabase.from("vehicule").select("id, archive_le").eq("plaque", plaque).maybeSingle();
  if (data?.archive_le) {
    return { ok: false, erreurs: { plaque: MESSAGES.plaqueArchivee(plaque) }, vehiculeArchiveId: data.id };
  }
  return { ok: false, erreurs: { plaque: MESSAGES.plaqueDejaPresente(plaque) } };
}

async function resultat(supabase: SupabaseClient, { data, error }: Reponse, plaque?: string): Promise<ResultatVehicule> {
  if (error) {
    if (error.code === VIOLATION_UNICITE && plaque) return plaqueDejaPrise(supabase, plaque);
    const limite = limiteAtteinte(error, MESSAGES.limiteVehicules);
    if (limite) return limite;
    console.error("vehicule", error.code, error.message);
    return { ok: false, erreurs: { general: MESSAGES.enregistrementImpossible } } as const;
  }
  return data ? ({ ok: true, vehicule: data } as const) : INTROUVABLE;
}

function lireVehicule(supabase: SupabaseClient, id: string) {
  return supabase.from("vehicule").select(COLONNES_VEHICULE).eq("id", id).maybeSingle<Vehicule>();
}

/**
 * Rattache au véhicule les avis qui portent sa plaque et n'ont pas de véhicule (« Véhicule inconnu »), quel que soit
 * leur statut. Comme une correction de plaque (`validationPerimee`), le rattachement efface le conducteur validé d'un
 * avis ouvert : il est à valider de nouveau. Un avis désigné ou classé garde le sien.
 */
export async function rattacherAvis(
  supabase: SupabaseClient,
  { id, plaque }: Pick<Vehicule, "id" | "plaque">,
): Promise<PostgrestError | null> {
  const { data, error } = await supabase
    .from("avis")
    .update({ vehicule_id: id })
    .eq("plaque", plaque)
    .is("vehicule_id", null)
    .select("id, statut, conducteur_id")
    .overrideTypes<{ id: string; statut: StatutAvis; conducteur_id: string | null }[], { merge: false }>();
  if (error) return error;

  const aRevalider = data.filter(({ statut, conducteur_id }) => estOuvert(statut) && conducteur_id).map(({ id }) => id);
  if (!aRevalider.length) return null;
  return (await supabase.from("avis").update({ conducteur_id: null }).in("id", aRevalider)).error;
}

/** Un rattachement manqué n'annule pas l'écriture du véhicule : l'avis reste « Véhicule inconnu », et se rattache depuis l'avis. */
async function rattacherApres(supabase: SupabaseClient, reponse: ResultatVehicule) {
  if (!reponse.ok) return;
  const erreur = await rattacherAvis(supabase, reponse.vehicule);
  if (erreur) console.error("vehicule", "rattachement des avis", erreur.code, erreur.message);
}

/**
 * Le véhicule créé reçoit les avis qui portent sa plaque. L'import CSV s'en passe (`rattacher: false`) : il rattache
 * une fois la ligne entièrement écrite, pour pouvoir supprimer un véhicule dont l'affectation échoue.
 */
export async function creerVehicule(
  supabase: SupabaseClient,
  saisie: SaisieVehicule,
  { rattacher = true }: { rattacher?: boolean } = {},
): Promise<ResultatVehicule> {
  const valide = schemaVehicule.safeParse(saisie);
  if (!valide.success) return { ok: false, erreurs: premieresErreurs<ChampVehicule>(valide.error) };

  const reponse = await supabase
    .from("vehicule")
    .insert(valide.data)
    .select(COLONNES_VEHICULE)
    .single<Vehicule>();
  const cree = await resultat(supabase, reponse, valide.data.plaque);
  if (rattacher) await rattacherApres(supabase, cree);
  return cree;
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

  // Un véhicule en lecture seule (retour en Free) ne se modifie plus : il s'archive, ou se rend actif.
  const reponse = await supabase
    .from("vehicule")
    .update(valide.data)
    .eq("id", id)
    .is("lecture_seule_le", null)
    .select(COLONNES_VEHICULE)
    .maybeSingle<Vehicule>();
  if (!reponse.error && !reponse.data) {
    const lu = await lireVehicule(supabase, id);
    if (lu.data?.lecture_seule_le) return { ok: false, erreurs: { general: MESSAGES.vehiculeLectureSeule } };
  }
  const modifie = await resultat(supabase, reponse, valide.data.plaque);
  // Sa plaque a pu changer : les avis qui portent la nouvelle le rejoignent.
  await rattacherApres(supabase, modifie);
  return modifie;
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

/** La limite Free s'applique comme à l'ajout : réactivé, le véhicule redevient actif. */
export async function reactiverVehicule(supabase: SupabaseClient, id: string): Promise<ResultatVehicule> {
  if (!schemaIdVehicule.safeParse(id).success) return INTROUVABLE;

  const reponse = await supabase
    .from("vehicule")
    .update({ archive_le: null })
    .eq("id", id)
    .select(COLONNES_VEHICULE)
    .maybeSingle<Vehicule>();
  return limiteAtteinte(reponse.error, MESSAGES.limiteVehiculesReactivation) ?? resultat(supabase, reponse);
}

export type ResultatActivation =
  | { ok: true; rendus: number }
  | { ok: false; erreur: string; invitationPro?: true };

/**
 * « Garder ces 3 véhicules » et « Rendre actif » (phase 19) : les véhicules en lecture seule demandés redeviennent actifs,
 * et leurs avis bloqués se débloquent. En Free, la base refuse tout si l'un d'eux dépasserait 3 véhicules actifs.
 * `rendus` vaut 0 quand la sélection est périmée : véhicules déjà actifs, archivés entre-temps, ou d'une autre entreprise.
 */
export async function rendreActifs(supabase: SupabaseClient, ids: readonly string[]): Promise<ResultatActivation> {
  const valides = ids.filter((id) => schemaIdVehicule.safeParse(id).success);
  if (!valides.length) return { ok: true, rendus: 0 };

  const { data, error } = await supabase.rpc("rendre_vehicules_actifs", { p_vehicules: valides });
  const limite = limiteAtteinte(error, MESSAGES.limiteVehiculesActivation);
  if (limite && !limite.ok) return { ok: false, erreur: limite.erreurs.general!, invitationPro: true };
  if (error) {
    console.error("vehicule", "activation", error.code, error.message);
    return { ok: false, erreur: MESSAGES.enregistrementImpossible };
  }
  return { ok: true, rendus: data as number };
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
