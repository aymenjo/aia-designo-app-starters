import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { depuisIso, partiesParis } from "@/lib/dates";
import { COLONNES_FICHE, type FicheEntreprise } from "@/lib/entreprise/fiche";
import {
  affectationCouvrante,
  affectationsVoisines,
  creerAffectation,
  type AffectationDetaillee,
} from "@/lib/flotte/affectations";
import { COLONNES_CONDUCTEUR, type Conducteur } from "@/lib/flotte/conducteurs";
import { creneauManquant } from "@/lib/flotte/planning";
import { nomComplet, saisieAffectation, schemaIdConducteur, type SaisieVehicule } from "@/lib/flotte/regles";
import {
  COLONNES_VEHICULE,
  creerVehicule,
  rattacherAvis,
  type ResultatVehicule,
  type Vehicule,
} from "@/lib/flotte/vehicules";
import { formaterMontantSaisie } from "@/lib/format";
import { premieresErreurs } from "@/lib/saisie";
import type { LectureNettoyee } from "./lecture";
import { refusDesignation } from "./recap";
import {
  CHAMPS_AVIS,
  CHAMP_REQUIS_DE,
  EXTENSIONS_STOCKEES,
  MESSAGES_AVIS,
  TAILLE_MAX_FICHIER,
  TYPES_STOCKES,
  confiancesApres,
  estOuvert,
  refusAffectationManquante,
  refusClassement,
  refusReouverture,
  refusValidationConducteur,
  refusVehiculeDepuisAvis,
  validationPerimee,
  valeursRefuseesApres,
  schemaAvis,
  schemaClassement,
  schemaIdAvis,
  statutDerive,
  type ChampAvis,
  type ChampClassement,
  type ChampRequisAvis,
  type Confiances,
  type DonneesAvis,
  type ErreursAvis,
  type ErreursClassement,
  type FormatStocke,
  type MotifClassement,
  type SaisieAvis,
  type SaisieClassement,
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
  /** Le conducteur validé par « Valider ce conducteur » : vide tant que le gestionnaire n'a pas validé. */
  conducteur_id: string | null;
  /** Le clic sur « J'ai désigné sur l'ANTAI » : rempli si et seulement si l'avis est désigné (voir la migration). */
  designe_le: string | null;
  /** Le clic sur « Classer », et son motif : remplis si et seulement si l'avis est classé (voir la migration). */
  classe_le: string | null;
  motif_classement: MotifClassement | null;
  /** Le motif en toutes lettres, pour « Autre » seulement. */
  motif_libre: string | null;
  /** Plan Free : déposé au-delà du quota du mois. Ni lu, ni proposé, ni récapitulé avant son déverrouillage. */
  verrouille: boolean;
  /** Le 1er du mois dont le quota compte l'avis ; vide tant qu'il est verrouillé. */
  mois_quota: string | null;
  /** Son déverrouillage : jamais lu, il l'est à son ouverture (`aLireApresDeverrouillage`). */
  deverrouille_le: string | null;
};

export const COLONNES_AVIS =
  "id, numero, plaque, vehicule_id, infraction_le, lieu, infraction, montant_centimes, date_envoi, echeance, statut, source, fichier, fichier_type, fichier_nom, depose_le, lecture_ia, confiances, valeurs_refusees, conducteur_id, designe_le, classe_le, motif_classement, motif_libre, verrouille, mois_quota, deverrouille_le";

/** Un avis avec le véhicule qui porte sa plaque et son conducteur validé, archivés compris. */
export type AvisDetaille = Avis & {
  vehicule: Pick<Vehicule, "id" | "plaque" | "modele" | "archive_le"> | null;
  conducteur: Pick<Conducteur, "id" | "prenom" | "nom" | "archive_le"> | null;
};

// Véhicule et conducteur embarqués par leur clé étrangère nommée (voir les migrations).
export const COLONNES_AVIS_DETAILLE = `${COLONNES_AVIS},
  vehicule:vehicule!avis_vehicule_fk(id, plaque, modele, archive_le),
  conducteur:conducteur!avis_conducteur_fk(id, prenom, nom, archive_le)`;

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
/** `verrouille` : le dépôt dépasse le quota Free du mois (voir la migration du plan Free). */
export type ResultatDepot = { ok: true; id: string; verrouille: boolean } | { ok: false; erreur: string };

const VIOLATION_UNICITE = "23505";
const CLE_ETRANGERE = "23503";
// Des refus généraux, repris par les écritures qui ne renvoient pas un avis (affectation, véhicule).
const ECHEC = { ok: false, erreurs: { general: MESSAGES_AVIS.enregistrementImpossible } } as const;
const INTROUVABLE = { ok: false, erreurs: { general: MESSAGES_AVIS.avisIntrouvable } } as const;

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
 * En Free, la base compte l'avis dans le quota du mois, ou le verrouille au-delà.
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
    .select("id, verrouille")
    .single<Pick<Avis, "id" | "verrouille">>();
  if (error?.code === VIOLATION_UNICITE) {
    const existant = await supabase
      .from("avis")
      .select("id, verrouille")
      .eq("fichier", chemin)
      .maybeSingle<Pick<Avis, "id" | "verrouille">>();
    if (existant.data) return { ok: true, ...existant.data };
  }
  if (error || !data) {
    if (error) echec(error);
    return { ok: false, erreur: MESSAGES_AVIS.enregistrementImpossible };
  }
  return { ok: true, ...data };
}

export function lireAvis(supabase: SupabaseClient, id: string) {
  return supabase.from("avis").select(COLONNES_AVIS_DETAILLE).eq("id", id).maybeSingle<AvisDetaille>();
}

/** Les avis désignés ou classés avant `debut` : ceux que l'historique Free masque (`debutHistorique`). */
const CLOS_AVANT = (debut: string) => `designe_le.lt."${debut}",classe_le.lt."${debut}"`;

/**
 * Les avis de l'entreprise, sauf ceux que masque l'historique Free : ceux désignés ou classés avant `debut`. Un avis
 * ouvert est toujours lu. `debut` vide (Pro) : tous. L'ordre du suivi est celui de `trierPourSuivi` (liste.ts).
 */
export function listerAvis(supabase: SupabaseClient, debut: string | null = null) {
  const requete = supabase.from("avis").select(COLONNES_AVIS);
  // Une date de désignation ne va qu'avec le statut « Désigné », celle d'un classement avec « Classé » (voir les migrations).
  const visibles = debut
    ? requete.or(`statut.in.(a_traiter,a_valider),designe_le.gte."${debut}",classe_le.gte."${debut}"`)
    : requete;
  return visibles.overrideTypes<Avis[], { merge: false }>();
}

/** Le nombre d'avis que masque l'historique Free, sans les lire. */
export function compterAvisMasques(supabase: SupabaseClient, debut: string) {
  return supabase.from("avis").select("id", { count: "exact", head: true }).or(CLOS_AVANT(debut));
}

/** Un avis et le nom de son conducteur validé, archivé compris. */
export type AvisAvecConducteur = Avis & { conducteur: Pick<Conducteur, "prenom" | "nom"> | null };

/** Tous les avis de l'entreprise, avec le nom de leur conducteur validé : les prochaines échéances du tableau de bord. */
export function listerAvisAvecConducteur(supabase: SupabaseClient) {
  return supabase
    .from("avis")
    .select(`${COLONNES_AVIS}, conducteur:conducteur!avis_conducteur_fk(prenom, nom)`)
    .overrideTypes<AvisAvecConducteur[], { merge: false }>();
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
 * Sur un avis ouvert, changer de véhicule ou d'instant d'infraction efface le conducteur validé : il est à revalider.
 */
async function ecrire(
  supabase: SupabaseClient,
  actuel: Pick<Avis, "id" | "statut" | "vehicule_id" | "infraction_le">,
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
      ...(estOuvert(actuel.statut) &&
        validationPerimee(actuel, { vehicule_id: vehiculeId, infraction_le: donnees.infraction_le }) && {
          conducteur_id: null,
        }),
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

export type ResultatValidation =
  | { ok: true; avis: AvisDetaille }
  | { ok: false; erreurs: { conducteur_id?: string; general?: string } };

/**
 * « Valider ce conducteur » : le seul geste qui écrit le conducteur d'un avis, jamais d'office. Seulement sur un avis
 * « À valider » rattaché à un véhicule, et pour un conducteur actif de l'entreprise. Le conducteur validé se change
 * tant que l'avis n'est pas désigné.
 */
export async function validerConducteur(
  supabase: SupabaseClient,
  id: string,
  conducteurId: string,
): Promise<ResultatValidation> {
  if (!schemaIdAvis.safeParse(id).success) return INTROUVABLE;
  if (!conducteurId) return { ok: false, erreurs: { conducteur_id: MESSAGES_AVIS.conducteurVide } };
  if (!schemaIdConducteur.safeParse(conducteurId).success) {
    return { ok: false, erreurs: { conducteur_id: MESSAGES_AVIS.conducteurIntrouvable } };
  }

  const [actuel, conducteur] = await Promise.all([
    lireActuel(supabase, id),
    supabase
      .from("conducteur")
      .select("prenom, nom, archive_le")
      .eq("id", conducteurId)
      .maybeSingle<Pick<Conducteur, "prenom" | "nom" | "archive_le">>(),
  ]);
  const erreurLecture = actuel.error ?? conducteur.error;
  if (erreurLecture) return echec(erreurLecture);
  if (!actuel.data) return INTROUVABLE;
  const refus = refusValidationConducteur(actuel.data);
  if (refus) return { ok: false, erreurs: { general: refus } };
  // La RLS masque le conducteur d'une autre entreprise : il est introuvable.
  if (!conducteur.data) return { ok: false, erreurs: { conducteur_id: MESSAGES_AVIS.conducteurIntrouvable } };
  if (conducteur.data.archive_le) {
    return { ok: false, erreurs: { conducteur_id: MESSAGES_AVIS.conducteurArchiveValidation(nomComplet(conducteur.data)) } };
  }

  // L'avis a pu être désigné, classé ou corrigé entre-temps : l'écriture ne vaut que s'il peut encore l'être.
  const { data, error } = await supabase
    .from("avis")
    .update({ conducteur_id: conducteurId })
    .eq("id", id)
    .eq("statut", "a_valider")
    .eq("verrouille", false)
    .not("vehicule_id", "is", null)
    .select(COLONNES_AVIS_DETAILLE)
    .maybeSingle<AvisDetaille>();
  if (error?.code === CLE_ETRANGERE && error.message.includes("avis_conducteur_fk")) {
    return { ok: false, erreurs: { conducteur_id: MESSAGES_AVIS.conducteurIntrouvable } };
  }
  if (error) return echec(error);
  if (data) return { ok: true, avis: data };

  const relu = await lireActuel(supabase, id);
  if (relu.error) return echec(relu.error);
  if (!relu.data) return INTROUVABLE;
  return { ok: false, erreurs: { general: refusValidationConducteur(relu.data) ?? MESSAGES_AVIS.enregistrementImpossible } };
}

export type ResultatAffectationManquante = { ok: true } | { ok: false; erreurs: { general?: string } };

/** Les lectures, injectables pour éprouver une écriture concurrente. */
export const LECTURES: {
  affectationCouvrante: (
    ...args: Parameters<typeof affectationCouvrante>
  ) => PromiseLike<{ data: AffectationDetaillee | null; error: PostgrestError | null }>;
  affectationsVoisines: typeof affectationsVoisines;
} = { affectationCouvrante, affectationsVoisines };

/**
 * « Enregistrer l'affectation » : sans affectation qui couvre l'infraction, celle du conducteur validé sur le véhicule
 * de l'avis, le jour de l'infraction (`creneauManquant`). Elle passe par `creerAffectation`, donc par les règles des
 * écrans : un véhicule ou un conducteur archivé est refusé, et une écriture concurrente se heurte à la contrainte
 * d'exclusion, qui nomme le conflit.
 */
export async function enregistrerAffectationManquante(
  supabase: SupabaseClient,
  id: string,
  lectures = LECTURES,
): Promise<ResultatAffectationManquante> {
  if (!schemaIdAvis.safeParse(id).success) return INTROUVABLE;
  const actuel = await lireActuel(supabase, id);
  if (actuel.error) return echec(actuel.error);
  if (!actuel.data) return INTROUVABLE;
  const refus = refusAffectationManquante(actuel.data);
  const { vehicule_id, conducteur_id, infraction_le } = actuel.data;
  // Sans refus, les trois sont remplis.
  if (refus || !vehicule_id || !conducteur_id || !infraction_le) {
    return { ok: false, erreurs: { general: refus ?? ECHEC.erreurs.general } };
  }

  const [couvrante, voisines] = await Promise.all([
    lectures.affectationCouvrante(supabase, vehicule_id, infraction_le),
    lectures.affectationsVoisines(supabase, vehicule_id, infraction_le),
  ]);
  if (couvrante.error) return echec(couvrante.error);
  if (voisines.error) return echec(voisines.error);
  const creneau = couvrante.data ? null : creneauManquant(infraction_le, voisines.data.avant, voisines.data.apres);
  if (!creneau) return { ok: false, erreurs: { general: MESSAGES_AVIS.affectationDejaCouverte } };

  const creee = await creerAffectation(supabase, saisieAffectation({ vehicule_id, conducteur_id, ...creneau }));
  if (creee.ok) return { ok: true };
  return { ok: false, erreurs: { general: Object.values(creee.erreurs).find(Boolean) ?? ECHEC.erreurs.general } };
}

/**
 * « Créer le véhicule » depuis un avis « Véhicule inconnu » : la plaque est toujours celle de l'avis, seuls le modèle
 * et le type se saisissent. Le véhicule créé reçoit l'avis, et les autres avis sans véhicule qui portent sa plaque.
 * Un véhicule qui porte déjà la plaque, archivé compris, reçoit l'avis sans rien créer.
 */
export async function creerVehiculeDepuisAvis(
  supabase: SupabaseClient,
  id: string,
  saisie: SaisieVehicule,
): Promise<ResultatVehicule> {
  if (!schemaIdAvis.safeParse(id).success) return INTROUVABLE;
  const actuel = await lireActuel(supabase, id);
  if (actuel.error) return echec(actuel.error);
  if (!actuel.data) return INTROUVABLE;
  const refus = refusVehiculeDepuisAvis(actuel.data);
  if (refus) return { ok: false, erreurs: { general: refus } };
  const plaque = actuel.data.plaque!;

  const existant = await supabase.from("vehicule").select(COLONNES_VEHICULE).eq("plaque", plaque).maybeSingle<Vehicule>();
  if (existant.error) return echec(existant.error);
  if (!existant.data) return creerVehicule(supabase, { ...saisie, plaque });
  const erreur = await rattacherAvis(supabase, existant.data);
  return erreur ? echec(erreur) : { ok: true, vehicule: existant.data };
}

/** Un avis avec la fiche entière de son conducteur validé, archivé compris : ce que reprend le récap ANTAI. */
export type AvisRecap = Avis & { conducteur: Conducteur | null };

const COLONNES_AVIS_RECAP = `${COLONNES_AVIS}, conducteur:conducteur!avis_conducteur_fk(${COLONNES_CONDUCTEUR})`;

export function lireAvisRecap(supabase: SupabaseClient, id: string) {
  return supabase.from("avis").select(COLONNES_AVIS_RECAP).eq("id", id).maybeSingle<AvisRecap>();
}

export type ResultatDesignation = { ok: true; avis: Avis } | { ok: false; erreurs: { general?: string } };

/**
 * « J'ai désigné sur l'ANTAI » : le seul geste qui passe un avis en « Désigné », avec la date du clic. Seulement
 * depuis un récap ouvert (avis « À valider », conducteur validé actif) et une fois les fiches du conducteur et de
 * l'entreprise complètes : celles que le gestionnaire vient de recopier.
 */
export async function marquerDesigne(supabase: SupabaseClient, id: string): Promise<ResultatDesignation> {
  if (!schemaIdAvis.safeParse(id).success) return INTROUVABLE;

  const lireDossier = () =>
    Promise.all([
      lireAvisRecap(supabase, id),
      supabase.from("entreprise").select(COLONNES_FICHE).single<FicheEntreprise>(),
    ]);
  const [actuel, entreprise] = await lireDossier();
  const erreurLecture = actuel.error ?? entreprise.error;
  if (erreurLecture) return echec(erreurLecture);
  if (!actuel.data || !entreprise.data) return INTROUVABLE;
  const refus = refusDesignation({ avis: actuel.data, conducteur: actuel.data.conducteur, entreprise: entreprise.data });
  if (refus) return { ok: false, erreurs: { general: refus } };

  // L'avis a pu être désigné, classé ou corrigé entre-temps : l'écriture ne vaut que pour le conducteur relu.
  const { data, error } = await supabase
    .from("avis")
    .update({ statut: "designe", designe_le: new Date().toISOString() })
    .eq("id", id)
    .eq("statut", "a_valider")
    .eq("verrouille", false)
    .eq("conducteur_id", actuel.data.conducteur_id!)
    .select(COLONNES_AVIS)
    .maybeSingle<Avis>();
  if (error) return echec(error);
  if (data) return { ok: true, avis: data };

  const [relu, entrepriseRelue] = await lireDossier();
  const erreurRelecture = relu.error ?? entrepriseRelue.error;
  if (erreurRelecture) return echec(erreurRelecture);
  if (!relu.data || !entrepriseRelue.data) return INTROUVABLE;
  const motif = refusDesignation({ avis: relu.data, conducteur: relu.data.conducteur, entreprise: entrepriseRelue.data });
  return { ok: false, erreurs: { general: motif ?? MESSAGES_AVIS.enregistrementImpossible } };
}

export type ResultatClassement = { ok: true; avis: Avis } | { ok: false; erreurs: ErreursClassement };

/**
 * « Classer » : l'avis sort du suivi, avec un motif, depuis tout statut. Il n'a plus d'échéance ni d'alerte. Un avis
 * désigné perd sa date de désignation ; le conducteur validé est gardé, pour le cas où l'avis serait rouvert.
 */
export async function classerAvis(
  supabase: SupabaseClient,
  id: string,
  saisie: SaisieClassement,
): Promise<ResultatClassement> {
  if (!schemaIdAvis.safeParse(id).success) return INTROUVABLE;
  const valide = schemaClassement.safeParse(saisie);
  if (!valide.success) return { ok: false, erreurs: premieresErreurs<ChampClassement>(valide.error) };

  // Un avis classé entre-temps garde son premier classement.
  const { data, error } = await supabase
    .from("avis")
    .update({ ...valide.data, statut: "classe", classe_le: new Date().toISOString(), designe_le: null })
    .eq("id", id)
    .neq("statut", "classe")
    .select(COLONNES_AVIS)
    .maybeSingle<Avis>();
  if (error) return echec(error);
  if (data) return { ok: true, avis: data };

  const relu = await lireActuel(supabase, id);
  if (relu.error) return echec(relu.error);
  if (!relu.data) return INTROUVABLE;
  return { ok: false, erreurs: { general: refusClassement(relu.data) ?? MESSAGES_AVIS.enregistrementImpossible } };
}

export type ResultatReouverture = { ok: true; avis: Avis } | { ok: false; erreurs: { general?: string } };

/**
 * « Rouvrir l'avis » : un avis désigné ou classé par erreur revient dans le suivi, avec son échéance et ses alertes.
 * Son statut est dérivé de ses champs, comme à l'enregistrement : « À valider », ou « À traiter » s'il en manque.
 * La date de désignation et le classement sont effacés. Le conducteur validé est gardé, et redevient modifiable.
 * Les euros évités ne sont jamais stockés : ils se recalculent d'eux-mêmes.
 */
export async function rouvrirAvis(supabase: SupabaseClient, id: string): Promise<ResultatReouverture> {
  if (!schemaIdAvis.safeParse(id).success) return INTROUVABLE;
  const actuel = await lireActuel(supabase, id);
  if (actuel.error) return echec(actuel.error);
  if (!actuel.data) return INTROUVABLE;
  const refus = refusReouverture(actuel.data);
  if (refus) return { ok: false, erreurs: { general: refus } };

  // L'avis a pu être rouvert, ou classé, entre-temps : l'écriture ne vaut que pour le statut relu.
  const { data, error } = await supabase
    .from("avis")
    .update({
      statut: statutDerive(actuel.data),
      designe_le: null,
      classe_le: null,
      motif_classement: null,
      motif_libre: null,
    })
    .eq("id", id)
    .eq("statut", actuel.data.statut)
    .select(COLONNES_AVIS)
    .maybeSingle<Avis>();
  if (error) return echec(error);
  if (data) return { ok: true, avis: data };

  const relu = await lireActuel(supabase, id);
  if (relu.error) return echec(relu.error);
  if (!relu.data) return INTROUVABLE;
  return { ok: false, erreurs: { general: refusReouverture(relu.data) ?? MESSAGES_AVIS.enregistrementImpossible } };
}

/** Une URL signée d'une heure : le bucket est privé. `null` si le fichier ne peut pas être servi. */
export async function urlFichier(supabase: SupabaseClient, chemin: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET_AVIS).createSignedUrl(chemin, 3600);
  if (error) console.error("avis", "url signée", error.message);
  return data?.signedUrl ?? null;
}
