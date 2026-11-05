import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { toutLire } from "@/lib/supabase/lecture";
import { COLONNES_AFFECTATION } from "./affectations";
import { COLONNES_CONDUCTEUR } from "./conducteurs";
import { MESSAGES } from "./regles";
import {
  COLONNES_RECAPITULATIF,
  MESSAGES_RECAPITULATIF,
  ciblesDe,
  designationLigne,
  estImpossible,
  lignesImpossibles,
  revaliderRecapitulatif,
  type AffectationInstantane,
  type Cibles,
  type ConducteurInstantane,
  type Instantane,
  type LigneRecapitulatif,
  type RecapitulatifConversation,
  type VehiculeInstantane,
} from "./regles-recapitulatif";
import { COLONNES_VEHICULE, rattacherAvis } from "./vehicules";

// Le récapitulatif de modifications (phase 29), côté serveur, sous la session du gestionnaire (RLS) : la flotte lue pour
// préparer ou revérifier les lignes, puis « Confirmer » et « Annuler ». Le récapitulatif lui-même est enregistré par le
// serveur de l'agent (src/lib/agent/recapitulatifs.ts). Ni « Confirmer » ni « Annuler » ne passent par l'agent : ils ne
// comptent pas comme des demandes. Un récapitulatif qui a une ligne rouge (phase 30) ne s'applique pas : « Modifier »
// le fait refaire.

export type ResultatRecapitulatifAction =
  | { ok: true; recapitulatif: RecapitulatifConversation }
  /** `recapitulatif` : son état du moment, quand il n'attend plus « Confirmer ». */
  | { ok: false; erreur: string; recapitulatif?: RecapitulatifConversation };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Les erreurs de la base qu'une écriture concurrente explique : la flotte relue donne le motif des écrans. */
const CONTRAINTES = new Set(["23P01", "23505", "23503", "23514"]);

type Reponse<T> = { data: T | null; error: { code: string; message: string } | null };

function lignes<T>({ data, error }: Reponse<T[]>, quoi: string): T[] {
  if (error) throw new Error(`${quoi} : ${error.code} ${error.message}`);
  return data ?? [];
}

/**
 * La flotte du moment, sous la session du gestionnaire : tous les véhicules et conducteurs, archivés compris (les
 * unicités), et les affectations des éléments concernés (les chevauchements, les affectations ouvertes).
 */
export async function lireInstantane(supabase: SupabaseClient, cibles: Cibles): Promise<Instantane> {
  const valides = (ids: readonly string[]) => ids.filter((id) => UUID.test(id));
  const visees = valides(cibles.affectations);
  const [vehicules, conducteurs, affectationsVisees] = await Promise.all([
    toutLire<VehiculeInstantane>(
      (debut, fin) =>
        supabase
          .from("vehicule")
          .select(COLONNES_VEHICULE)
          .order("id")
          .range(debut, fin)
          .overrideTypes<VehiculeInstantane[], { merge: false }>(),
      "véhicules",
    ),
    toutLire<ConducteurInstantane>(
      (debut, fin) =>
        supabase
          .from("conducteur")
          .select(COLONNES_CONDUCTEUR)
          .order("id")
          .range(debut, fin)
          .overrideTypes<ConducteurInstantane[], { merge: false }>(),
      "conducteurs",
    ),
    visees.length
      ? supabase
          .from("affectation")
          .select(COLONNES_AFFECTATION)
          .in("id", visees)
          .overrideTypes<AffectationInstantane[], { merge: false }>()
          .then((reponse) => lignes(reponse, "affectations visées"))
      : Promise.resolve([] as AffectationInstantane[]),
  ]);

  const vehiculesConcernes = new Set([...valides(cibles.vehicules), ...affectationsVisees.map((a) => a.vehicule_id)]);
  const conducteursConcernes = new Set([...valides(cibles.conducteurs), ...affectationsVisees.map((a) => a.conducteur_id)]);
  const filtres = [
    vehiculesConcernes.size && `vehicule_id.in.(${[...vehiculesConcernes].join(",")})`,
    conducteursConcernes.size && `conducteur_id.in.(${[...conducteursConcernes].join(",")})`,
  ].filter(Boolean);
  const affectations = filtres.length
    ? await toutLire<AffectationInstantane>(
        (debut, fin) =>
          supabase
            .from("affectation")
            .select(COLONNES_AFFECTATION)
            .or(filtres.join(","))
            .order("id")
            .range(debut, fin)
            .overrideTypes<AffectationInstantane[], { merge: false }>(),
        "affectations",
      )
    : [];
  const parId = new Map([...affectationsVisees, ...affectations].map((a) => [a.id, a]));
  return { vehicules, conducteurs, affectations: [...parId.values()] };
}

type Lecture = typeof lireInstantane;

/** Le message de refus des lignes revérifiées sur la flotte du moment, ou `null` si toutes passent. */
async function refusDesLignes(supabase: SupabaseClient, lignesRecap: readonly LigneRecapitulatif[], lire: Lecture) {
  const resultat = revaliderRecapitulatif(await lire(supabase, ciblesDe(lignesRecap)), lignesRecap);
  return resultat.ok ? null : MESSAGES_RECAPITULATIF.rienApplique(resultat.motifs);
}

function lireRecapitulatif(supabase: SupabaseClient, id: string) {
  return supabase.from("recapitulatif").select(COLONNES_RECAPITULATIF).eq("id", id).maybeSingle<RecapitulatifConversation>();
}

/** La ligne en cause, que `appliquer_recapitulatif` donne dans le détail de son erreur. */
function ligneEnCause(error: PostgrestError): number | null {
  try {
    const { ligne } = JSON.parse(error.details ?? "") as { ligne?: unknown };
    return typeof ligne === "number" ? ligne : null;
  } catch {
    return null;
  }
}

/** L'erreur de l'application, en message pour le gestionnaire. */
async function traduire(
  supabase: SupabaseClient,
  recapitulatif: RecapitulatifConversation,
  error: PostgrestError,
  lire: Lecture,
): Promise<ResultatRecapitulatifAction> {
  const ligne = ligneEnCause(error);
  if (error.code === "P0001" && error.message === "recapitulatif_pro") return { ok: false, erreur: MESSAGES_RECAPITULATIF.pro };
  if (error.code === "P0001" && error.message === "recapitulatif_plus_applicable") {
    const relu = await lireRecapitulatif(supabase, recapitulatif.id);
    return { ok: false, erreur: MESSAGES_RECAPITULATIF.plusApplicable, ...(relu.data && { recapitulatif: relu.data }) };
  }
  if (error.code === "P0001" && error.message === "recapitulatif_ligne_impossible") {
    const rouges = lignesImpossibles(recapitulatif.lignes);
    if (rouges.length) return { ok: false, erreur: MESSAGES_RECAPITULATIF.rienApplique(rouges) };
  }
  if (error.code === "P0001" && error.message === "recapitulatif_ligne_perimee" && ligne) {
    const motif = MESSAGES_RECAPITULATIF.aChange(designationLigne(recapitulatif.lignes[ligne - 1]));
    return { ok: false, erreur: MESSAGES_RECAPITULATIF.rienApplique([{ ligne, motif }]) };
  }
  // Une écriture concurrente (un écran, entre la revérification et l'application) : la flotte relue nomme le conflit.
  if (CONTRAINTES.has(error.code)) {
    const refus = await refusDesLignes(supabase, recapitulatif.lignes, lire);
    if (refus) return { ok: false, erreur: refus };
  }
  console.error("récapitulatif", error.code, error.message, error.details);
  return {
    ok: false,
    erreur: ligne
      ? MESSAGES_RECAPITULATIF.rienApplique([{ ligne, motif: MESSAGES.enregistrementImpossible }])
      : MESSAGES_RECAPITULATIF.echec,
  };
}

/**
 * Comme les écrans, un véhicule créé, ou dont la plaque change, reçoit les avis sans véhicule qui portent sa plaque. Au
 * mieux, après l'application : un rattachement manqué laisse l'avis « Véhicule inconnu », qui se rattache depuis l'avis.
 */
async function rattacherApres(
  supabase: SupabaseClient,
  lignesRecap: readonly LigneRecapitulatif[],
  crees: Record<string, string>,
) {
  const vehicules = lignesRecap.flatMap((l, rang) => {
    if (estImpossible(l)) return [];
    if (l.operation === "creer_vehicule" && crees[String(rang + 1)]) return [{ id: crees[String(rang + 1)], plaque: l.apres.plaque }];
    if (l.operation === "modifier_vehicule" && l.apres.plaque) return [{ id: l.cible, plaque: l.apres.plaque }];
    return [];
  });
  for (const vehicule of vehicules) {
    const erreur = await rattacherAvis(supabase, vehicule);
    if (erreur) console.error("récapitulatif", "rattachement des avis", erreur.code, erreur.message);
  }
}

/**
 * « Confirmer » : le plan et le récapitulatif sont relus, chaque ligne est revérifiée sur la flotte du moment, puis la
 * base les applique toutes, ou aucune. `lire` lit la flotte (injecté par les tests pour simuler une écriture concurrente).
 */
export async function confirmerRecapitulatif(
  supabase: SupabaseClient,
  id: string,
  { lire = lireInstantane }: { lire?: Lecture } = {},
): Promise<ResultatRecapitulatifAction> {
  if (!UUID.test(id)) return { ok: false, erreur: MESSAGES_RECAPITULATIF.plusApplicable };
  const [entreprise, lu] = await Promise.all([
    supabase.from("entreprise").select("plan").maybeSingle<{ plan: string }>(),
    lireRecapitulatif(supabase, id),
  ]);
  const erreurLecture = entreprise.error ?? lu.error;
  if (erreurLecture) {
    console.error("récapitulatif", erreurLecture.code, erreurLecture.message);
    return { ok: false, erreur: MESSAGES_RECAPITULATIF.echec };
  }
  if (entreprise.data?.plan !== "pro") return { ok: false, erreur: MESSAGES_RECAPITULATIF.pro };
  const recapitulatif = lu.data;
  if (!recapitulatif) return { ok: false, erreur: MESSAGES_RECAPITULATIF.plusApplicable };
  if (recapitulatif.statut !== "propose") return { ok: false, erreur: MESSAGES_RECAPITULATIF.plusApplicable, recapitulatif };
  // Une ligne rouge bloque « Confirmer » : le bouton est désactivé, et un appel direct est refusé ici.
  const rouges = lignesImpossibles(recapitulatif.lignes);
  if (rouges.length) return { ok: false, erreur: MESSAGES_RECAPITULATIF.rienApplique(rouges) };

  const refus = await refusDesLignes(supabase, recapitulatif.lignes, lire);
  if (refus) return { ok: false, erreur: refus };

  const { data, error } = await supabase.rpc("appliquer_recapitulatif", { p_id: id });
  if (error) return traduire(supabase, recapitulatif, error, lire);
  const { applique_le, crees } = data as { applique_le: string; crees: Record<string, string> };
  await rattacherApres(supabase, recapitulatif.lignes, crees);
  return { ok: true, recapitulatif: { ...recapitulatif, statut: "applique", applique_le, crees } };
}

/** « Annuler » : un récapitulatif en attente est abandonné, sans rien modifier. */
export async function annulerRecapitulatif(supabase: SupabaseClient, id: string): Promise<ResultatRecapitulatifAction> {
  if (!UUID.test(id)) return { ok: false, erreur: MESSAGES_RECAPITULATIF.plusApplicable };
  const { data, error } = await supabase
    .from("recapitulatif")
    .update({ statut: "annule" })
    .eq("id", id)
    .eq("statut", "propose")
    .select(COLONNES_RECAPITULATIF)
    .maybeSingle<RecapitulatifConversation>();
  if (error) {
    console.error("récapitulatif", error.code, error.message);
    return { ok: false, erreur: MESSAGES_RECAPITULATIF.echec };
  }
  if (data) return { ok: true, recapitulatif: data };
  const relu = await lireRecapitulatif(supabase, id);
  return { ok: false, erreur: MESSAGES_RECAPITULATIF.plusApplicable, ...(relu.data && { recapitulatif: relu.data }) };
}
