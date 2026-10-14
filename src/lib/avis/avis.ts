import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { depuisIso, partiesParis } from "@/lib/dates";
import type { Vehicule } from "@/lib/flotte/vehicules";
import { formaterMontantSaisie } from "@/lib/format";
import { premieresErreurs } from "@/lib/saisie";
import type { LectureNettoyee } from "./lecture";
import {
  CHAMPS_AVIS,
  CHAMP_REQUIS_DE,
  EXTENSIONS_STOCKEES,
  MESSAGES_AVIS,
  TAILLE_MAX_FICHIER,
  TYPES_STOCKES,
  confiancesApres,
  estOuvert,
  valeursRefuseesApres,
  schemaAvis,
  schemaIdAvis,
  statutDerive,
  type ChampAvis,
  type ChampRequisAvis,
  type Confiances,
  type DonneesAvis,
  type ErreursAvis,
  type FormatStocke,
  type SaisieAvis,
  type StatutAvis,
  type ValeursRefusees,
} from "./regles";

// Écritures des avis, sous la session du gestionnaire (RLS).
// L'écran de saisie, la lecture IA (phase 9) et la relève Gmail (phase 23) passent tous par ici.

export const BUCKET_AVIS = "avis";

export type Avis = {
  id: string;
  numero: string | null;
  plaque: string | null;
  vehicule_id: string | null;
  infraction_le: string | null;
  lieu: string | null;
  infraction: string | null;
  montant_centimes: number | null;
  date_envoi: string | null;
  echeance: string | null;
  statut: StatutAvis;
  source: "depot" | "gmail";
  fichier: string;
  fichier_type: string;
  fichier_nom: string | null;
  depose_le: string;
  /** Vide : jamais lu par l'IA (sans clé d'API, ou déposé avant la phase 9). */
  lecture_ia: "en_cours" | "lue" | "echec" | null;
  confiances: Confiances;
  valeurs_refusees: ValeursRefusees;
};

export const COLONNES_AVIS =
  "id, numero, plaque, vehicule_id, infraction_le, lieu, infraction, montant_centimes, date_envoi, echeance, statut, source, fichier, fichier_type, fichier_nom, depose_le, lecture_ia, confiances, valeurs_refusees";

/** Un avis avec le véhicule qui porte sa plaque, archivé compris. */
export type AvisDetaille = Avis & { vehicule: Pick<Vehicule, "id" | "plaque" | "modele" | "archive_le"> | null };

// Véhicule embarqué par sa clé étrangère nommée (voir la migration).
export const COLONNES_AVIS_DETAILLE = `${COLONNES_AVIS},
  vehicule:vehicule!avis_vehicule_fk(id, plaque, modele, archive_le)`;

/** Valeurs du formulaire : dates JJ/MM/AAAA, heure HH:MM, montant « 135,00 », et un champ vide est une chaîne vide. */
export type ValeursAvis = Record<ChampAvis, string>;

export function versValeurs(avis: Avis): ValeursAvis {
  const infraction = avis.infraction_le ? partiesParis(avis.infraction_le) : null;
  return {
    numero: avis.numero ?? "",
    plaque: avis.plaque ?? "",
    infraction_date: infraction ? depuisIso(infraction.date) : "",
    infraction_heure: infraction?.heure ?? "",
    lieu: avis.lieu ?? "",
    infraction: avis.infraction ?? "",
    montant: avis.montant_centimes ? formaterMontantSaisie(avis.montant_centimes) : "",
    date_envoi: avis.date_envoi ? depuisIso(avis.date_envoi) : "",
  };
}

export type ResultatAvis =
  | { ok: true; avis: AvisDetaille }
  | {
      ok: false;
      erreurs: ErreursAvis;
      /** L'avis qui porte déjà ce n° : le message d'erreur y mène. */
      avisExistantId?: string;
      /** Le dépôt doublait cet avis : il n'existe plus, fichier compris. */
      depotAbandonne?: true;
    };
export type ResultatDepot = { ok: true; id: string } | { ok: false; erreur: string };

const VIOLATION_UNICITE = "23505";
const ECHEC: ResultatAvis = { ok: false, erreurs: { general: MESSAGES_AVIS.enregistrementImpossible } };
const INTROUVABLE: ResultatAvis = { ok: false, erreurs: { general: MESSAGES_AVIS.avisIntrouvable } };

function echec(error: PostgrestError | Error): typeof ECHEC {
  console.error("avis", "code" in error ? error.code : "", error.message);
  return ECHEC;
}

/** Le chemin que le navigateur a choisi dans le bucket : {entreprise_id}/{uuid}.{pdf|jpg|png}. */
const CHEMIN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|png)$/;

/** Le chemin d'un nouveau fichier, rangé dans le dossier de l'entreprise. */
export function cheminFichier(entrepriseId: string, format: FormatStocke) {
  return `${entrepriseId}/${crypto.randomUUID()}.${EXTENSIONS_STOCKEES[format]}`;
}

/**
 * Crée l'avis « À traiter » d'un fichier que le navigateur vient d'envoyer au bucket. Le type et la taille
 * sont relus dans le bucket, sans faire confiance au client. Rejouer le même dépôt renvoie le même avis.
 */
export async function creerAvis(
  supabase: SupabaseClient,
  { chemin, nom }: { chemin: string; nom: string },
): Promise<ResultatDepot> {
  const extension = CHEMIN.exec(chemin)?.[1];
  if (!extension) return { ok: false, erreur: MESSAGES_AVIS.fichierIntrouvable };

  const { data: fichier, error: erreurFichier } = await supabase.storage.from(BUCKET_AVIS).info(chemin);
  if (erreurFichier || !fichier) return { ok: false, erreur: MESSAGES_AVIS.fichierIntrouvable };
  const format = (Object.keys(TYPES_STOCKES) as FormatStocke[]).find(
    (cle) => TYPES_STOCKES[cle] === fichier.contentType && EXTENSIONS_STOCKEES[cle] === extension,
  );
  if (!format) return { ok: false, erreur: MESSAGES_AVIS.formatRefuse };
  if ((fichier.size ?? 0) > TAILLE_MAX_FICHIER) return { ok: false, erreur: MESSAGES_AVIS.fichierTropLourd };

  const { data, error } = await supabase
    .from("avis")
    .insert({ fichier: chemin, fichier_type: TYPES_STOCKES[format], fichier_nom: nom.trim().slice(0, 255) || null })
    .select("id")
    .single<{ id: string }>();
  if (error?.code === VIOLATION_UNICITE) {
    const existant = await supabase.from("avis").select("id").eq("fichier", chemin).maybeSingle<{ id: string }>();
    if (existant.data) return { ok: true, id: existant.data.id };
  }
  if (error || !data) {
    if (error) echec(error);
    return { ok: false, erreur: MESSAGES_AVIS.enregistrementImpossible };
  }
  return { ok: true, id: data.id };
}

export function lireAvis(supabase: SupabaseClient, id: string) {
  return supabase.from("avis").select(COLONNES_AVIS_DETAILLE).eq("id", id).maybeSingle<AvisDetaille>();
}

/** Tous les avis de l'entreprise : l'ordre du suivi est celui de `trierPourSuivi` (liste.ts). */
export function listerAvis(supabase: SupabaseClient) {
  return supabase.from("avis").select(COLONNES_AVIS).overrideTypes<Avis[], { merge: false }>();
}

/**
 * Abandonne un dépôt pas encore identifié (sans n°, « À traiter ») quand `numero` est déjà celui d'un avis de
 * l'entreprise : sa ligne et son fichier sont supprimés, un second avis n'est jamais créé. La base vérifie tout
 * (voir la migration) : un avis identifié, ou sans doublon, n'est jamais supprimé. Renvoie `true` si le dépôt
 * a été abandonné. Repris par la lecture IA (phase 9) et la relève Gmail (phase 23).
 */
export async function abandonnerDepotEnDouble(supabase: SupabaseClient, id: string, numero: string): Promise<boolean> {
  const { data: fichier, error } = await supabase.rpc("abandonner_depot_en_double", { p_avis: id, p_numero: numero });
  if (error) {
    echec(error);
    return false;
  }
  if (typeof fichier !== "string") return false;
  // Un fichier resté orphelin ne gêne rien : la suppression de compte (phase 20) vide le dossier.
  const { error: erreurFichier } = await supabase.storage.from(BUCKET_AVIS).remove([fichier]);
  if (erreurFichier) console.error("avis", "fichier abandonné", erreurFichier.message);
  return true;
}

/**
 * Le n° est déjà celui d'un autre avis de l'entreprise : la contrainte d'unicité fait foi, même en concurrence.
 * Un dépôt pas encore identifié est abandonné ; un avis identifié garde son n°. Dans les deux cas, le refus mène à l'existant.
 */
async function numeroDejaPris(supabase: SupabaseClient, id: string, numero: string): Promise<ResultatAvis> {
  const { data, error } = await supabase
    .from("avis")
    .select("id")
    .eq("numero", numero)
    .neq("id", id)
    .maybeSingle<{ id: string }>();
  if (error) return echec(error);
  if (!data) return ECHEC;
  const refus = { ok: false, erreurs: { numero: MESSAGES_AVIS.avisExistant }, avisExistantId: data.id } as const;
  return (await abandonnerDepotEnDouble(supabase, id, numero)) ? { ...refus, depotAbandonne: true } : refus;
}

function lireActuel(supabase: SupabaseClient, id: string) {
  return supabase.from("avis").select(COLONNES_AVIS).eq("id", id).maybeSingle<Avis>();
}

/** Le véhicule de l'entreprise qui porte cette plaque, archivé compris. */
function vehiculeDe(supabase: SupabaseClient, plaque: string | null) {
  return plaque
    ? supabase.from("vehicule").select("id").eq("plaque", plaque).maybeSingle<{ id: string }>()
    : { data: null, error: null };
}

/**
 * Écrit des données validées, avec les niveaux de confiance qui restent, et les valeurs refusées des champs encore
 * rouges. Le statut d'un avis ouvert est dérivé :
 * « À valider » quand rien ne manque et qu'aucun champ rouge n'attend sa confirmation, sinon « À traiter », dans les
 * deux sens. Un avis désigné ou classé garde son statut. Un n° déjà pris par un autre avis de l'entreprise est refusé.
 */
async function ecrire(
  supabase: SupabaseClient,
  actuel: Pick<Avis, "id" | "statut">,
  donnees: DonneesAvis,
  { confiances, refusees }: { confiances: Confiances; refusees: ValeursRefusees },
  vehiculeId: string | null,
  extra: Partial<Pick<Avis, "lecture_ia">> = {},
): Promise<ResultatAvis> {
  const { data, error } = await supabase
    .from("avis")
    .update({
      ...donnees,
      ...extra,
      confiances,
      valeurs_refusees: valeursRefuseesApres(refusees, confiances),
      vehicule_id: vehiculeId,
      ...(estOuvert(actuel.statut) && { statut: statutDerive({ ...donnees, confiances }) }),
    })
    .eq("id", actuel.id)
    .select(COLONNES_AVIS_DETAILLE)
    .maybeSingle<AvisDetaille>();
  if (error?.code === VIOLATION_UNICITE && error.message.includes("avis_numero_unique") && donnees.numero) {
    return numeroDejaPris(supabase, actuel.id, donnees.numero);
  }
  if (error) return echec(error);
  return data ? { ok: true, avis: data } : INTROUVABLE;
}

/**
 * Enregistre une saisie, même partielle. L'avis est rattaché au véhicule qui porte sa plaque, archivé compris.
 * Un champ modifié perd le niveau de sa lecture, comme un champ rouge que le gestionnaire confirme (`confirmes`).
 */
export async function modifierAvis(
  supabase: SupabaseClient,
  id: string,
  saisie: SaisieAvis,
  confirmes: readonly ChampRequisAvis[] = [],
): Promise<ResultatAvis> {
  if (!schemaIdAvis.safeParse(id).success) return INTROUVABLE;
  const valide = schemaAvis.safeParse(saisie);
  if (!valide.success) return { ok: false, erreurs: premieresErreurs<ChampAvis>(valide.error) };
  const donnees = valide.data;

  const [actuel, vehicule] = await Promise.all([lireActuel(supabase, id), vehiculeDe(supabase, donnees.plaque)]);
  const erreurLecture = actuel.error ?? vehicule.error;
  if (erreurLecture) return echec(erreurLecture);
  if (!actuel.data) return INTROUVABLE;

  const confiances = confiancesApres(actuel.data.confiances, actuel.data, donnees, confirmes);
  const lecture = { confiances, refusees: actuel.data.valeurs_refusees };
  return ecrire(supabase, actuel.data, donnees, lecture, vehicule.data?.id ?? null);
}

/**
 * Enregistre la lecture IA d'un avis : seuls les champs encore vides sont remplis, avec leur niveau et, s'il y a
 * lieu, la valeur refusée. La fusion se fait sur la saisie, pour que toutes les règles s'appliquent. Un n° lu déjà
 * pris abandonne le dépôt, comme à la main.
 */
export async function appliquerLecture(
  supabase: SupabaseClient,
  id: string,
  lue: LectureNettoyee,
): Promise<ResultatAvis> {
  const actuel = await lireActuel(supabase, id);
  if (actuel.error) return echec(actuel.error);
  if (!actuel.data) return INTROUVABLE;

  const valeurs = versValeurs(actuel.data);
  const saisie: SaisieAvis = {};
  const confiances: Confiances = { ...actuel.data.confiances };
  const refusees: ValeursRefusees = { ...actuel.data.valeurs_refusees };
  for (const champ of CHAMPS_AVIS) {
    const requis = CHAMP_REQUIS_DE[champ];
    const vide = actuel.data[requis] == null;
    saisie[champ] = vide ? (lue.saisie[champ] ?? null) : valeurs[champ];
    if (!vide) continue;
    if (lue.confiances[requis]) confiances[requis] = lue.confiances[requis];
    if (lue.refusees[requis]) refusees[requis] = lue.refusees[requis];
  }
  const valide = schemaAvis.safeParse(saisie);
  if (!valide.success) return { ok: false, erreurs: premieresErreurs<ChampAvis>(valide.error) };

  const vehicule = await vehiculeDe(supabase, valide.data.plaque);
  if (vehicule.error) return echec(vehicule.error);
  const lecture = { confiances, refusees };
  return ecrire(supabase, actuel.data, valide.data, lecture, vehicule.data?.id ?? null, { lecture_ia: "lue" });
}

/** Une URL signée d'une heure : le bucket est privé. `null` si le fichier ne peut pas être servi. */
export async function urlFichier(supabase: SupabaseClient, chemin: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET_AVIS).createSignedUrl(chemin, 3600);
  if (error) console.error("avis", "url signée", error.message);
  return data?.signedUrl ?? null;
}
