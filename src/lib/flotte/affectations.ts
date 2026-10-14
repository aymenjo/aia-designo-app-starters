import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { premieresErreurs } from "@/lib/saisie";
import type { Conducteur } from "./conducteurs";
import {
  MESSAGES,
  nomAbrege,
  schemaAffectation,
  schemaCloture,
  schemaIdAffectation,
  schemaIdConducteur,
  schemaIdVehicule,
  type ChampAffectation,
  type ChampCloture,
  type DonneesAffectation,
  type ErreursAffectation,
  type SaisieAffectation,
  type SaisieCloture,
} from "./regles";
import type { Vehicule } from "./vehicules";

// Écritures des affectations, sous la session du gestionnaire (RLS).
// Les écrans, l'import CSV et l'agent passent tous par ici.

export type Affectation = {
  id: string;
  vehicule_id: string;
  conducteur_id: string;
  debut: string;
  fin: string | null;
};

export const COLONNES_AFFECTATION = "id, vehicule_id, conducteur_id, debut, fin";

type ConducteurAffecte = Pick<Conducteur, "id" | "prenom" | "nom" | "archive_le">;

/** Les véhicules et conducteurs actifs, proposés par les formulaires d'affectation. */
export type ChoixAffectation = {
  vehicules: Pick<Vehicule, "id" | "plaque" | "modele" | "type">[];
  conducteurs: Pick<Conducteur, "id" | "prenom" | "nom">[];
};

/** Une affectation avec son véhicule et son conducteur, archivés compris : planning, fiches, refus. */
export type AffectationDetaillee = Affectation & { vehicule: Vehicule; conducteur: ConducteurAffecte };

// Véhicule et conducteur embarqués par leur clé étrangère nommée (voir la migration).
export const COLONNES_AFFECTATION_DETAILLEE = `${COLONNES_AFFECTATION},
  vehicule:vehicule!affectation_vehicule_fk(id, plaque, modele, type, archive_le),
  conducteur:conducteur!affectation_conducteur_fk(id, prenom, nom, archive_le)`;

export type ResultatAffectation = { ok: true; affectation: Affectation } | { ok: false; erreurs: ErreursAffectation };

type Refus = Extract<ResultatAffectation, { ok: false }>;
type Reponse = { data: Affectation | null; error: PostgrestError | null };
/** Une saisie valide, avec la plaque du véhicule visé pour nommer un éventuel conflit. */
type Prete = { donnees: DonneesAffectation; plaque: string };

const CHEVAUCHEMENT = "23P01";
const CLE_ETRANGERE = "23503";
const VERIFICATION = "23514";
const ECHEC: Refus = { ok: false, erreurs: { general: MESSAGES.enregistrementImpossible } };
const INTROUVABLE: Refus = { ok: false, erreurs: { general: MESSAGES.affectationIntrouvable } };
const ARCHIVEE: Refus = { ok: false, erreurs: { general: MESSAGES.affectationArchivee } };
/** Un id qui n'en est pas un ne se lit pas : le schéma signalera le champ. */
const AUCUNE = { data: null, error: null };

function echec(error: PostgrestError): Refus {
  console.error("affectation", error.code, error.message);
  return ECHEC;
}

/**
 * La première affectation qui chevauche le créneau, pour la nommer. La contrainte fait foi, même en concurrence :
 * son détail ne donne aucune valeur (la RLS les masque), d'où cette relecture.
 */
async function conflit(supabase: SupabaseClient, { donnees, plaque }: Prete, exclue?: string): Promise<string> {
  let requete = supabase
    .from("affectation")
    .select("debut, fin, conducteur:conducteur!affectation_conducteur_fk(prenom, nom)")
    .eq("vehicule_id", donnees.vehicule_id)
    .or(`fin.is.null,fin.gt."${donnees.debut}"`);
  if (donnees.fin) requete = requete.lt("debut", donnees.fin);
  if (exclue) requete = requete.neq("id", exclue);
  const { data } = await requete
    .order("debut")
    .limit(1)
    .maybeSingle<Pick<Affectation, "debut" | "fin"> & { conducteur: Pick<Conducteur, "prenom" | "nom"> }>();
  return data
    ? MESSAGES.conflitAffectation(nomAbrege(data.conducteur), plaque, data.debut, data.fin)
    : MESSAGES.conflitAffectationInconnu;
}

async function resultat(
  supabase: SupabaseClient,
  { data, error }: Reponse,
  prete?: Prete,
  exclue?: string,
): Promise<ResultatAffectation> {
  if (error) {
    if (error.code === CHEVAUCHEMENT && prete) {
      return { ok: false, erreurs: { general: await conflit(supabase, prete, exclue) } };
    }
    if (error.code === CLE_ETRANGERE && error.message.includes("affectation_vehicule_fk")) {
      return { ok: false, erreurs: { vehicule_id: MESSAGES.vehiculeIntrouvable } };
    }
    if (error.code === CLE_ETRANGERE && error.message.includes("affectation_conducteur_fk")) {
      return { ok: false, erreurs: { conducteur_id: MESSAGES.conducteurIntrouvable } };
    }
    if (error.code === VERIFICATION) return { ok: false, erreurs: { fin_date: MESSAGES.finAvantDebut } };
    return echec(error);
  }
  return data ? { ok: true, affectation: data } : INTROUVABLE;
}

/** Les règles sur le type du véhicule visé, puis le refus d'un véhicule ou d'un conducteur archivé ou introuvable. */
async function preparer(
  supabase: SupabaseClient,
  saisie: SaisieAffectation,
): Promise<{ ok: true; prete: Prete } | Refus> {
  const { vehicule_id, conducteur_id } = saisie;
  const [vehicule, conducteur] = await Promise.all([
    schemaIdVehicule.safeParse(vehicule_id).success
      ? supabase
          .from("vehicule")
          .select("plaque, type, archive_le")
          .eq("id", vehicule_id)
          .maybeSingle<Pick<Vehicule, "plaque" | "type" | "archive_le">>()
      : AUCUNE,
    schemaIdConducteur.safeParse(conducteur_id).success
      ? supabase
          .from("conducteur")
          .select("prenom, nom, archive_le")
          .eq("id", conducteur_id)
          .maybeSingle<Pick<Conducteur, "prenom" | "nom" | "archive_le">>()
      : AUCUNE,
  ]);
  const erreurLecture = vehicule.error ?? conducteur.error;
  if (erreurLecture) return echec(erreurLecture);

  const valide = schemaAffectation(vehicule.data?.type).safeParse(saisie);
  const erreurs: ErreursAffectation = valide.success ? {} : premieresErreurs<ChampAffectation>(valide.error);
  if (!erreurs.vehicule_id) {
    if (!vehicule.data) erreurs.vehicule_id = MESSAGES.vehiculeIntrouvable;
    else if (vehicule.data.archive_le) erreurs.vehicule_id = MESSAGES.vehiculeArchiveAffectation(vehicule.data.plaque);
  }
  if (!erreurs.conducteur_id) {
    if (!conducteur.data) erreurs.conducteur_id = MESSAGES.conducteurIntrouvable;
    else if (conducteur.data.archive_le) {
      erreurs.conducteur_id = MESSAGES.conducteurArchiveAffectation(`${conducteur.data.prenom} ${conducteur.data.nom}`);
    }
  }
  if (!valide.success || !vehicule.data || Object.keys(erreurs).length) return { ok: false, erreurs };
  return { ok: true, prete: { donnees: valide.data, plaque: vehicule.data.plaque } };
}

function lireAffectation(supabase: SupabaseClient, id: string) {
  return supabase
    .from("affectation")
    .select(COLONNES_AFFECTATION_DETAILLEE)
    .eq("id", id)
    .maybeSingle<AffectationDetaillee>();
}

/** L'affectation à modifier ou à clôturer : elle reste en lecture seule tant que son véhicule ou son conducteur est archivé. */
async function modifiable(
  supabase: SupabaseClient,
  id: string,
): Promise<{ ok: true; actuelle: AffectationDetaillee } | Refus> {
  if (!schemaIdAffectation.safeParse(id).success) return INTROUVABLE;
  const { data, error } = await lireAffectation(supabase, id);
  if (error) return echec(error);
  if (!data) return INTROUVABLE;
  if (data.vehicule.archive_le || data.conducteur.archive_le) return ARCHIVEE;
  return { ok: true, actuelle: data };
}

export async function creerAffectation(
  supabase: SupabaseClient,
  saisie: SaisieAffectation,
): Promise<ResultatAffectation> {
  const preparation = await preparer(supabase, saisie);
  if (!preparation.ok) return preparation;
  const { prete } = preparation;

  const reponse = await supabase
    .from("affectation")
    .insert(prete.donnees)
    .select(COLONNES_AFFECTATION)
    .single<Affectation>();
  return resultat(supabase, reponse, prete);
}

/** Véhicule, conducteur, début et fin, avec les mêmes règles qu'à la création. Le conflit l'exclut elle-même. */
export async function modifierAffectation(
  supabase: SupabaseClient,
  id: string,
  saisie: SaisieAffectation,
): Promise<ResultatAffectation> {
  const lue = await modifiable(supabase, id);
  if (!lue.ok) return lue;
  const preparation = await preparer(supabase, saisie);
  if (!preparation.ok) return preparation;
  const { prete } = preparation;

  const reponse = await supabase
    .from("affectation")
    .update(prete.donnees)
    .eq("id", id)
    .select(COLONNES_AFFECTATION)
    .maybeSingle<Affectation>();
  return resultat(supabase, reponse, prete, id);
}

/** Fixe la fin d'une affectation ouverte. Une affectation déjà clôturée se modifie, elle ne se reclôture pas. */
export async function cloturerAffectation(
  supabase: SupabaseClient,
  id: string,
  saisie: SaisieCloture,
): Promise<ResultatAffectation> {
  const lue = await modifiable(supabase, id);
  if (!lue.ok) return lue;
  const { actuelle } = lue;
  if (actuelle.fin) return { ok: false, erreurs: { general: MESSAGES.affectationDejaCloturee } };
  const valide = schemaCloture(actuelle.debut).safeParse(saisie);
  if (!valide.success) return { ok: false, erreurs: premieresErreurs<ChampCloture>(valide.error) };

  const reponse = await supabase
    .from("affectation")
    .update({ fin: valide.data })
    .eq("id", id)
    .is("fin", null)
    .select(COLONNES_AFFECTATION)
    .maybeSingle<Affectation>();
  if (!reponse.error && !reponse.data) return { ok: false, erreurs: { general: MESSAGES.affectationDejaCloturee } };
  return resultat(supabase, reponse);
}

/**
 * La première affectation ouverte (sans fin) d'un véhicule ou d'un conducteur. Elle bloque l'archivage,
 * et le passage d'un véhicule en pool.
 */
export function affectationOuverte(
  supabase: SupabaseClient,
  filtre: { vehicule_id: string } | { conducteur_id: string },
) {
  const [colonne, id] =
    "vehicule_id" in filtre ? ["vehicule_id", filtre.vehicule_id] : ["conducteur_id", filtre.conducteur_id];
  return supabase
    .from("affectation")
    .select(COLONNES_AFFECTATION_DETAILLEE)
    .eq(colonne, id)
    .is("fin", null)
    .order("debut")
    .limit(1)
    .maybeSingle<AffectationDetaillee>();
}

/** « Clôturez d'abord l'affectation de Karim B. sur AB-123-CD. » */
export function messageAffectationEnCours({ conducteur, vehicule }: AffectationDetaillee) {
  return MESSAGES.affectationEnCours(nomAbrege(conducteur), vehicule.plaque);
}

/**
 * Les affectations d'un véhicule ou d'un conducteur, archivés compris, les plus récentes d'abord.
 * Avec une période : seulement celles qui la touchent (une fin vide court jusqu'à l'infini).
 */
export function lireAffectations(
  supabase: SupabaseClient,
  filtre: { vehicule_id?: string; conducteur_id?: string } = {},
  periode?: { debut: string; fin: string },
) {
  let requete = supabase.from("affectation").select(COLONNES_AFFECTATION_DETAILLEE);
  if (filtre.vehicule_id) requete = requete.eq("vehicule_id", filtre.vehicule_id);
  if (filtre.conducteur_id) requete = requete.eq("conducteur_id", filtre.conducteur_id);
  if (periode) requete = requete.lt("debut", periode.fin).or(`fin.is.null,fin.gt."${periode.debut}"`);
  return requete.order("debut", { ascending: false }).overrideTypes<AffectationDetaillee[], { merge: false }>();
}

/** Les véhicules et conducteurs actifs, pour les formulaires d'affectation d'une fiche. */
export async function lireChoixAffectation(supabase: SupabaseClient): Promise<ChoixAffectation> {
  const [vehicules, conducteurs] = await Promise.all([
    supabase
      .from("vehicule")
      .select("id, plaque, modele, type")
      .is("archive_le", null)
      .order("plaque")
      .overrideTypes<ChoixAffectation["vehicules"], { merge: false }>(),
    supabase
      .from("conducteur")
      .select("id, prenom, nom")
      .is("archive_le", null)
      .order("nom")
      .order("prenom")
      .overrideTypes<ChoixAffectation["conducteurs"], { merge: false }>(),
  ]);
  if (vehicules.error) throw vehicules.error;
  if (conducteurs.error) throw conducteurs.error;
  return { vehicules: vehicules.data ?? [], conducteurs: conducteurs.data ?? [] };
}
