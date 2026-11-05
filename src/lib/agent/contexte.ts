import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { affectationCouvrante } from "@/lib/flotte/affectations";
import { nomComplet } from "@/lib/flotte/regles";
import { TYPES_ELEMENT, cleElement, type TypeElement } from "./citations";
import {
  libelleContexte,
  type ContexteDemande,
  type Nommer,
  type RefContexte,
  type ReferencesDerivees,
} from "./regles";

// Le contexte de l'écran (phase 28) : l'élément ouvert quand le gestionnaire envoie sa demande, lu sous sa session (RLS),
// archivés compris. Un élément d'une autre entreprise, ou inconnu, ne donne aucun contexte. Les références dérivées
// (« ce véhicule » sur un avis, « ce conducteur » sur un véhicule) ne sont données que s'il n'y a qu'un candidat.

/** L'élément envoyé par le panneau avec la demande : son type et son id. */
export const schemaRefContexte = z.object({ type: z.enum(TYPES_ELEMENT), id: z.uuid() }).strict();

type Reponse<T> = { data: T | null; error: { code: string; message: string } | null };

function ligne<T>({ data, error }: Reponse<T>, quoi: string): T | null {
  if (error) throw new Error(`${quoi} : ${error.code} ${error.message}`);
  return data;
}

type Personne = { id: string; prenom: string; nom: string };

type AvisContexte = {
  id: string;
  numero: string | null;
  plaque: string | null;
  infraction_le: string | null;
  depose_le: string;
  statut: string;
  vehicule_id: string | null;
  conducteur_id: string | null;
  vehicule: { id: string; plaque: string } | null;
  conducteur: Personne | null;
};

export type ContexteLu = {
  contexte: ContexteDemande;
  derives: ReferencesDerivees;
  /** Les noms déjà lus, par clé d'élément (« vehicule:<id> ») : les étapes les reprennent sans relire. */
  noms: Map<string, string | null>;
};

const personne = (p: Personne) => ({ id: p.id, libelle: nomComplet(p) });

async function lireAvis(supabase: SupabaseClient, id: string): Promise<ContexteLu | null> {
  const avis = ligne(
    await supabase
      .from("avis")
      .select(
        `id, numero, plaque, infraction_le, depose_le, statut, vehicule_id, conducteur_id,
        vehicule:vehicule!avis_vehicule_fk(id, plaque),
        conducteur:conducteur!avis_conducteur_fk(id, prenom, nom)`,
      )
      .eq("id", id)
      .maybeSingle<AvisContexte>(),
    "avis du contexte",
  );
  if (!avis) return null;

  const derives: ReferencesDerivees = {};
  if (avis.vehicule) derives.vehicule = { id: avis.vehicule.id, libelle: avis.vehicule.plaque };
  if (avis.conducteur) {
    derives.conducteur = { ...personne(avis.conducteur), role: "son conducteur validé" };
  } else if (avis.statut === "a_valider" && avis.vehicule_id && avis.infraction_le) {
    // Le conducteur proposé, comme sur l'écran de l'avis et dans lister_avis : celui de l'affectation qui couvre
    // l'infraction.
    const couvrante = ligne(await affectationCouvrante(supabase, avis.vehicule_id, avis.infraction_le), "affectation");
    if (couvrante) derives.conducteur = { ...personne(couvrante.conducteur), role: "le conducteur proposé pour cet avis" };
  }

  const contexte: ContexteDemande = { type: "avis", id: avis.id, libelle: libelleContexte({ type: "avis", ...avis }) };
  const noms = new Map<string, string | null>([[cleElement("avis", avis.id), avis.numero]]);
  if (derives.vehicule) noms.set(cleElement("vehicule", derives.vehicule.id), derives.vehicule.libelle);
  if (derives.conducteur) noms.set(cleElement("conducteur", derives.conducteur.id), derives.conducteur.libelle);
  return { contexte, derives, noms };
}

async function lireVehicule(supabase: SupabaseClient, id: string, maintenant: Date): Promise<ContexteLu | null> {
  const vehicule = ligne(
    await supabase.from("vehicule").select("id, plaque").eq("id", id).maybeSingle<{ id: string; plaque: string }>(),
    "véhicule du contexte",
  );
  if (!vehicule) return null;

  // L'affectation en cours : une seule au plus, la base interdisant tout chevauchement sur un véhicule.
  const instant = maintenant.toISOString();
  const encours = ligne(
    await supabase
      .from("affectation")
      .select("conducteur:conducteur!affectation_conducteur_fk(id, prenom, nom)")
      .eq("vehicule_id", vehicule.id)
      .lte("debut", instant)
      .or(`fin.is.null,fin.gt."${instant}"`)
      .overrideTypes<{ conducteur: Personne }[], { merge: false }>(),
    "affectation en cours du contexte",
  );

  const derives: ReferencesDerivees = {};
  if (encours?.length === 1) {
    derives.conducteur = { ...personne(encours[0].conducteur), role: "qui conduit ce véhicule en ce moment" };
  }
  const contexte: ContexteDemande = { type: "vehicule", id: vehicule.id, libelle: libelleContexte({ type: "vehicule", ...vehicule }) };
  const noms = new Map<string, string | null>([[cleElement("vehicule", vehicule.id), vehicule.plaque]]);
  if (derives.conducteur) noms.set(cleElement("conducteur", derives.conducteur.id), derives.conducteur.libelle);
  return { contexte, derives, noms };
}

async function lireConducteur(supabase: SupabaseClient, id: string): Promise<ContexteLu | null> {
  const conducteur = ligne(
    await supabase.from("conducteur").select("id, prenom, nom").eq("id", id).maybeSingle<Personne>(),
    "conducteur du contexte",
  );
  if (!conducteur) return null;
  const contexte: ContexteDemande = {
    type: "conducteur",
    id: conducteur.id,
    libelle: libelleContexte({ type: "conducteur", ...conducteur }),
  };
  return { contexte, derives: {}, noms: new Map([[cleElement("conducteur", conducteur.id), contexte.libelle]]) };
}

/**
 * L'élément de l'écran, lu sous la session du gestionnaire : son libellé (« Sur : … »), ce que désignent « ce véhicule »
 * et « ce conducteur », et les noms déjà lus. `null` si l'élément est introuvable, ou la référence mal formée.
 */
export async function lireContexte(
  supabase: SupabaseClient,
  ref: RefContexte,
  maintenant = new Date(),
): Promise<ContexteLu | null> {
  const valide = schemaRefContexte.safeParse(ref);
  if (!valide.success) return null;
  const { type, id } = valide.data;
  if (type === "avis") return lireAvis(supabase, id);
  if (type === "vehicule") return lireVehicule(supabase, id, maintenant);
  return lireConducteur(supabase, id);
}

/** Le nom d'un élément, lu sous la session du gestionnaire : `null` s'il est introuvable ou sans n°. */
async function lireNom(supabase: SupabaseClient, type: TypeElement, id: string): Promise<string | null> {
  if (type === "avis") {
    const avis = ligne(await supabase.from("avis").select("numero").eq("id", id).maybeSingle<{ numero: string | null }>(), "avis");
    return avis?.numero ?? null;
  }
  if (type === "vehicule") {
    const vehicule = ligne(await supabase.from("vehicule").select("plaque").eq("id", id).maybeSingle<{ plaque: string }>(), "véhicule");
    return vehicule?.plaque ?? null;
  }
  const conducteur = ligne(
    await supabase.from("conducteur").select("prenom, nom").eq("id", id).maybeSingle<{ prenom: string; nom: string }>(),
    "conducteur",
  );
  return conducteur ? nomComplet(conducteur) : null;
}

/**
 * Le `nommer` des étapes : la plaque, le nom ou le n° d'un élément, une requête par id. Le cache est propre à la
 * demande, pré-rempli avec les noms du contexte ; un élément introuvable, ou une lecture en échec, donne `null`.
 */
export function nommerElement(supabase: SupabaseClient, cache = new Map<string, string | null>()): Nommer {
  return async (type, id) => {
    const cle = cleElement(type, id);
    if (cache.has(cle)) return cache.get(cle)!;
    try {
      const nom = await lireNom(supabase, type, id);
      cache.set(cle, nom);
      return nom;
    } catch (erreur) {
      console.error("étape de la demande", erreur instanceof Error ? erreur.message : erreur);
      return null;
    }
  };
}
