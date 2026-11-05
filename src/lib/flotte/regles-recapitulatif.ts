import { ajouterJours, depuisIso } from "@/lib/dates";
import { formaterDateAHeure, formaterDateHeure } from "@/lib/format";
import {
  messageConflit,
  premierConflit,
  refusAffectationModifiable,
  refusArchivage,
  refusCloture,
  refusConducteurAffectation,
  refusDejaArchivee,
  refusFicheArchivee,
  refusModificationVehicule,
  refusPassagePool,
  refusPlaque,
  refusUnicite,
  refusVehiculeAffectation,
} from "./controles";
import {
  CHAMPS_CONDUCTEUR,
  LIBELLES_CHAMP_CONDUCTEUR,
  LIBELLES_CIVILITE,
  LIBELLES_TYPE,
  MESSAGES,
  nomAbrege,
  normaliserPlaque,
  saisieAffectation,
  saisieConducteur,
  schemaAffectation,
  schemaCloture,
  schemaConducteur,
  schemaVehicule,
  type ChampConducteur,
  type Civilite,
  type FicheConducteur,
  type SaisieAffectation,
  type SaisieConducteur,
  type TypeVehicule,
} from "./regles";

// Le récapitulatif de modifications de l'agent (phase 29) : ce que l'agent propose, ligne par ligne, avant que le
// gestionnaire clique « Confirmer ». Pur, et importable côté client : le panneau en tire ses libellés.
//
// Chaque ligne passe par les règles des écrans : les schémas de saisie (regles.ts), puis les contrôles sur l'état de la
// flotte (controles.ts). L'état est simulé : une ligne voit la flotte telle que les lignes précédentes l'ont laissée
// (« Karim part vendredi » clôture son affectation, puis l'archivage passe). « Confirmer » refait tout sur la flotte du
// moment, puis la base applique les lignes stockées dans l'ordre, en une transaction (appliquer_recapitulatif).
//
// Phase 30 : une ligne que les règles des écrans refusent s'enregistre quand même, en rouge, avec le motif des écrans
// (`Impossible`) ; « Confirmer » reste désactivé tant qu'il en reste une. Une proposition mal formée par l'agent (un id
// inconnu, une référence invalide, deux lignes sur un même élément, une modification qui ne change rien) n'est pas une
// règle des écrans : rien ne s'enregistre, et l'agent reçoit le motif (`Invalide`).

/** Au-delà, une demande se découpe en plusieurs récapitulatifs. */
export const MAX_LIGNES_RECAPITULATIF = 20;

// Ce que l'agent envoie : les entrées de l'outil `proposer_modifications` (src/lib/agent/definition.ts), déjà vérifiées
// dans leur forme. Dates AAAA-MM-JJ, heures HH:MM, à l'heure de Paris.

/** Un élément existant par son id, ou celui que crée une ligne précédente par son numéro (1 pour la première). */
export type Ref = { id: string } | { ligne: number };

type ChampsConducteurEntree = {
  civilite?: Civilite | null;
  date_naissance?: string | null;
  lieu_naissance?: string | null;
  adresse?: string | null;
  adresse_complement?: string | null;
  code_postal?: string | null;
  ville?: string | null;
  permis_numero?: string | null;
  permis_delivre_le?: string | null;
  permis_categories?: string | null;
  email?: string | null;
};

export type EntreeModification =
  | { operation: "creer_vehicule"; plaque: string; modele?: string | null; type: TypeVehicule }
  | { operation: "modifier_vehicule"; vehicule_id: string; plaque?: string; modele?: string | null; type?: TypeVehicule }
  | { operation: "archiver_vehicule"; vehicule_id: string }
  | ({ operation: "creer_conducteur"; prenom: string; nom: string } & ChampsConducteurEntree)
  | ({ operation: "modifier_conducteur"; conducteur_id: string; prenom?: string; nom?: string } & ChampsConducteurEntree)
  | { operation: "archiver_conducteur"; conducteur_id: string }
  | {
      operation: "creer_affectation";
      vehicule: Ref;
      conducteur: Ref;
      debut_date: string;
      debut_heure?: string;
      fin_date?: string;
      fin_heure?: string;
    }
  | {
      operation: "modifier_affectation";
      affectation_id: string;
      vehicule?: Ref;
      conducteur?: Ref;
      debut_date?: string;
      debut_heure?: string;
      /** `null` : l'affectation n'a plus de fin. */
      fin_date?: string | null;
      fin_heure?: string;
    }
  | { operation: "cloturer_affectation"; affectation_id: string; fin_date: string; fin_heure?: string };

export type Operation = EntreeModification["operation"];

// La flotte lue sous la session du gestionnaire : tous les véhicules et conducteurs, archivés compris (l'unicité), et
// les affectations des éléments concernés.

export type VehiculeInstantane = {
  id: string;
  plaque: string;
  modele: string | null;
  type: TypeVehicule;
  archive_le: string | null;
  lecture_seule_le: string | null;
};

export type ConducteurInstantane = {
  [C in Exclude<ChampConducteur, "prenom" | "nom" | "civilite" | "permis_categories">]: string | null;
} & {
  id: string;
  prenom: string;
  nom: string;
  civilite: Civilite | null;
  permis_categories: string[] | null;
  archive_le: string | null;
};

export type AffectationInstantane = {
  id: string;
  vehicule_id: string;
  conducteur_id: string;
  debut: string;
  fin: string | null;
};

export type Instantane = {
  vehicules: readonly VehiculeInstantane[];
  conducteurs: readonly ConducteurInstantane[];
  affectations: readonly AffectationInstantane[];
};

// Les lignes du récapitulatif, telles qu'elles sont stockées : `avant` ne garde que les champs modifiés, tels que lus ;
// `apres`, les valeurs prêtes pour la base ; `affichage`, de quoi nommer les éléments sans relire la flotte.

export type ChampsVehicule = { plaque: string; modele: string | null; type: TypeVehicule };
export type ChampsAffectation = { vehicule_id: string; conducteur_id: string; debut: string; fin: string | null };
export type ChampsAffectationApres = { vehicule_id: Ref; conducteur_id: Ref; debut: string; fin: string | null };

/** Le véhicule et le conducteur que la ligne nomme : ceux qu'elle vise, ou ceux de l'affectation. */
export type Affichage = {
  vehicule?: { ref: Ref; plaque: string; type: TypeVehicule };
  conducteur?: { ref: Ref; nom: string };
};

/** Une ligne que les règles des écrans acceptent. */
export type LignePossible =
  | { operation: "creer_vehicule"; apres: ChampsVehicule; affichage: Affichage }
  | {
      operation: "modifier_vehicule";
      cible: string;
      avant: Partial<ChampsVehicule>;
      apres: Partial<ChampsVehicule>;
      affichage: Affichage;
    }
  | { operation: "archiver_vehicule"; cible: string; affichage: Affichage }
  | { operation: "creer_conducteur"; apres: FicheConducteur; affichage: Affichage }
  | {
      operation: "modifier_conducteur";
      cible: string;
      avant: Partial<FicheConducteur>;
      apres: Partial<FicheConducteur>;
      affichage: Affichage;
    }
  | { operation: "archiver_conducteur"; cible: string; affichage: Affichage }
  | { operation: "creer_affectation"; apres: ChampsAffectationApres; affichage: Affichage }
  | {
      operation: "modifier_affectation";
      cible: string;
      avant: Partial<ChampsAffectation>;
      apres: Partial<ChampsAffectationApres>;
      /** `apres` : le véhicule ou le conducteur qui remplace celui de l'affectation. */
      affichage: Affichage & { apres?: Affichage };
    }
  | { operation: "cloturer_affectation"; cible: string; avant: { fin: null }; apres: { fin: string }; affichage: Affichage };

/**
 * Une ligne que les règles des écrans refusent (phase 30) : enregistrée en rouge avec son motif (`refus`), sans avant ni
 * après. Elle garde sa place : les références `{ ligne: n }` et les éléments créés restent alignés. `cible` : l'élément
 * existant qu'elle vise, s'il y en a un.
 */
export type LigneImpossible = { operation: Operation; cible?: string; affichage: Affichage; refus: string };

export type LigneRecapitulatif = LignePossible | LigneImpossible;

export function estImpossible(l: LigneRecapitulatif): l is LigneImpossible {
  return "refus" in l;
}

export type Motif = { ligne: number; motif: string };

/** Le motif de chaque ligne rouge : tant qu'il y en a, « Confirmer » est désactivé. */
export function lignesImpossibles(lignes: readonly LigneRecapitulatif[]): Motif[] {
  return lignes.flatMap((l, rang) => (estImpossible(l) ? [{ ligne: rang + 1, motif: l.refus }] : []));
}

/** `lignes` : à la proposition, les lignes rouges comprises ; à « Confirmer », toutes possibles. */
export type ResultatRecapitulatif = { ok: true; lignes: LigneRecapitulatif[] } | { ok: false; motifs: Motif[] };

// Le récapitulatif tel que le panneau l'affiche.

export const STATUTS_RECAPITULATIF = ["propose", "applique", "annule", "remplace", "expire"] as const;
export type StatutRecapitulatif = (typeof STATUTS_RECAPITULATIF)[number];

export type RecapitulatifConversation = {
  id: string;
  statut: StatutRecapitulatif;
  lignes: LigneRecapitulatif[];
  /** Les éléments créés, par numéro de ligne (« 2 » → l'id) : remplis à l'application. */
  crees: Record<string, string>;
  applique_le: string | null;
};

export const COLONNES_RECAPITULATIF = "id, statut, lignes, crees, applique_le";

export const MESSAGES_RECAPITULATIF = {
  rienAModifier: "Rien à modifier : les valeurs demandées sont déjà celles-là.",
  referenceInvalide: (ligne: number, quoi: "vehicule" | "conducteur") =>
    `La ligne ${ligne} ne crée pas de ${quoi === "vehicule" ? "véhicule" : "conducteur"} avant celle-ci.`,
  dependDeLigne: (ligne: number) => `Dépend de la ligne ${ligne}, qui est impossible.`,
  uneLigneParElement: (ligne: number) => `La ligne ${ligne} modifie déjà cet élément : une seule ligne par élément.`,
  trop: `Un récapitulatif a au plus ${MAX_LIGNES_RECAPITULATIF} lignes.`,

  // Les refus de « Confirmer »
  rienApplique: (motifs: readonly Motif[]) =>
    `Rien n'a été appliqué. ${motifs.map(({ ligne, motif }) => `Ligne ${ligne} : ${motif}`).join(" ")}`,
  plusApplicable: "Ce récapitulatif n'est plus applicable : rien n'a été modifié. Demandez un nouveau récapitulatif.",
  pro: "Les modifications par Désigno sont une fonction Pro : rien n'a été appliqué.",
  aChange: (quoi: string) => `${quoi} a changé depuis le récapitulatif. Demandez un nouveau récapitulatif.`,
  echec: "L'application a échoué : rien n'a été modifié. Réessayez dans un instant.",

  // Ce que l'outil répond à l'agent
  propose:
    "Récapitulatif enregistré : il s'affiche sous ta réponse, avec « Confirmer », « Modifier » et « Annuler ». Rien n'est appliqué avant « Confirmer ». Écris une phrase courte, sans recopier les lignes, et ne dis jamais que c'est fait.",
  proposeImpossible:
    "Récapitulatif enregistré, avec des lignes impossibles : elles s'affichent en rouge avec le motif des écrans, et « Confirmer » reste désactivé tant qu'il en reste une. Si un motif vient de ton propre calcul (des dates ou des heures qui se chevauchent, des lignes dans le désordre), corrige-le en rappelant proposer_modifications avec toutes les lignes : le nouveau récapitulatif remplace celui-ci. Sinon, ne suppose rien : explique le motif en une phrase et demande au gestionnaire comment corriger ; il répondra avec « Modifier ». Ne dis jamais que c'est fait.",
  nonEnregistre:
    "Le récapitulatif n'a pas pu être enregistré : la conversation est terminée, ou le compte n'est plus en Pro. Dis au gestionnaire de faire ces modifications dans les écrans.",
  refusOutil:
    "Aucun récapitulatif n'a été enregistré : ta proposition est mal formée (un id qu'aucun outil n'a renvoyé, une référence à une ligne qui ne crée pas cet élément, deux lignes sur un même élément, une modification qui ne change rien). Corrige-la, puis rappelle proposer_modifications avec toutes les lignes. Si une modification ne change rien, dis-le au gestionnaire.",

  // Le sort du récapitulatif, sous ses lignes
  applique: (le: string) => `Appliqué le ${formaterDateAHeure(le)}`,
  annule: "Annulé : rien n'a été modifié.",
  remplace: "Remplacé : rien n'a été modifié.",
  expire: "Expiré : rien n'a été modifié.",
} as const;

// L'état simulé : la flotte après chaque ligne. Un élément créé par la ligne n reçoit un id factice, qu'aucune base
// ne donne, pour passer par les mêmes schémas qu'un élément existant.

const ID_LIGNE = /^00000000-0000-4000-8000-(\d{12})$/;

export function idLigne(ligne: number) {
  return `00000000-0000-4000-8000-${String(ligne).padStart(12, "0")}`;
}

/** L'id d'un élément de l'état simulé, rendu en référence : celui d'une ligne devient `{ ligne }`. */
function versRef(id: string): Ref {
  const ligne = ID_LIGNE.exec(id);
  return ligne ? { ligne: Number(ligne[1]) } : { id };
}

type Creation = "vehicule" | "conducteur" | "affectation" | null;

type Etat = {
  vehicules: Map<string, VehiculeInstantane>;
  conducteurs: Map<string, ConducteurInstantane>;
  affectations: Map<string, AffectationInstantane>;
  /** Ce que crée chaque ligne, qu'elle soit possible ou non. */
  creations: readonly Creation[];
  impossibles: Set<number>;
  /** L'affichage de chaque ligne déjà vue, rouge comprise : une ligne qui vise ce qu'une ligne rouge crée le reprend. */
  affichages: Map<number, Affichage>;
};

/** Une marque d'archivage dans l'état simulé : seule sa présence compte. */
const ARCHIVE_SIMULE = new Date(0).toISOString();

function etatDe(instantane: Instantane, creations: readonly Creation[]): Etat {
  return {
    vehicules: new Map(instantane.vehicules.map((v) => [v.id, { ...v }])),
    conducteurs: new Map(instantane.conducteurs.map((c) => [c.id, { ...c }])),
    affectations: new Map(instantane.affectations.map((a) => [a.id, { ...a }])),
    creations,
    impossibles: new Set(),
    affichages: new Map(),
  };
}

const CREATIONS: Record<Operation, Creation> = {
  creer_vehicule: "vehicule",
  modifier_vehicule: null,
  archiver_vehicule: null,
  creer_conducteur: "conducteur",
  modifier_conducteur: null,
  archiver_conducteur: null,
  creer_affectation: "affectation",
  modifier_affectation: null,
  cloturer_affectation: null,
};

/** L'élément qu'une ligne modifie (« vehicule:<id> ») : une seule ligne par élément. */
function elementVise(item: EntreeModification | LigneRecapitulatif): string | null {
  if ("cible" in item) return `${item.operation.split("_")[1]}:${item.cible}`;
  if ("vehicule_id" in item) return `vehicule:${item.vehicule_id}`;
  if ("conducteur_id" in item) return `conducteur:${item.conducteur_id}`;
  if ("affectation_id" in item) return `affectation:${item.affectation_id}`;
  return null;
}

/** Une règle des écrans refuse la ligne : elle s'enregistre en rouge, avec ce motif. */
class Impossible extends Error {}

/** L'agent a mal formé sa proposition : rien ne s'enregistre, et il reçoit ce motif pour la corriger. */
class Invalide extends Error {}

/** Arrête la ligne sur son motif. */
function refuser(motif: string | null | undefined): void {
  if (motif) throw new Impossible(motif);
}

function resoudre(etat: Etat, ref: Ref, quoi: "vehicule" | "conducteur", ligne: number): string {
  if ("id" in ref) {
    // Un id factice ne vient pas d'un outil : l'élément n'existe pas.
    if (ID_LIGNE.test(ref.id)) throw new Invalide(quoi === "vehicule" ? MESSAGES.vehiculeIntrouvable : MESSAGES.conducteurIntrouvable);
    return ref.id;
  }
  if (ref.ligne >= ligne || etat.creations[ref.ligne - 1] !== quoi) {
    throw new Invalide(MESSAGES_RECAPITULATIF.referenceInvalide(ref.ligne, quoi));
  }
  if (etat.impossibles.has(ref.ligne)) refuser(MESSAGES_RECAPITULATIF.dependDeLigne(ref.ligne));
  return idLigne(ref.ligne);
}

function vehiculeDe(etat: Etat, id: string): VehiculeInstantane {
  const vehicule = etat.vehicules.get(id);
  if (!vehicule) throw new Invalide(MESSAGES.vehiculeIntrouvable);
  return vehicule;
}

function conducteurDe(etat: Etat, id: string): ConducteurInstantane {
  const conducteur = etat.conducteurs.get(id);
  if (!conducteur) throw new Invalide(MESSAGES.conducteurIntrouvable);
  return conducteur;
}

function affectationDe(etat: Etat, id: string): AffectationInstantane {
  const affectation = etat.affectations.get(id);
  if (!affectation) throw new Invalide(MESSAGES.affectationIntrouvable);
  return affectation;
}

/** Un conducteur absent de la lecture (impossible sous la RLS) : nommé sans planter. */
const INCONNU = { prenom: "?", nom: "?", archive_le: null };

/** L'affectation avec son véhicule et son conducteur, pour les contrôles et les messages. */
function detaillee(etat: Etat, affectation: AffectationInstantane) {
  return {
    ...affectation,
    vehicule: etat.vehicules.get(affectation.vehicule_id) ?? { plaque: "?", archive_le: null, lecture_seule_le: null },
    conducteur: etat.conducteurs.get(affectation.conducteur_id) ?? INCONNU,
  };
}

/** La première affectation ouverte (sans fin) d'un véhicule ou d'un conducteur, comme `affectationOuverte`. */
function ouverteDe(etat: Etat, champ: "vehicule_id" | "conducteur_id", id: string) {
  const ouvertes = [...etat.affectations.values()].filter((a) => a[champ] === id && !a.fin);
  const premiere = ouvertes.toSorted((a, b) => Date.parse(a.debut) - Date.parse(b.debut))[0];
  return premiere ? detaillee(etat, premiere) : null;
}

/** Le premier message d'une saisie refusée par son schéma. */
function valider<T>(resultat: { success: true; data: T } | { success: false; error: { issues: { message: string }[] } }): T {
  if (!resultat.success) throw new Impossible(resultat.error.issues[0]?.message ?? MESSAGES.enregistrementImpossible);
  return resultat.data;
}

function memeValeur(a: unknown, b: unknown, instant = false): boolean {
  if (a == null || b == null) return a == null && b == null;
  if (instant) return Date.parse(String(a)) === Date.parse(String(b));
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a) === JSON.stringify(b);
  return a === b;
}

const INSTANTS = new Set(["debut", "fin"]);

/** Les champs qui changent, avant et après. */
function difference<T extends object>(actuel: T, donnees: T, champs: readonly (keyof T & string)[]) {
  const avant: Partial<T> = {};
  const apres: Partial<T> = {};
  for (const champ of champs) {
    if (memeValeur(actuel[champ], donnees[champ], INSTANTS.has(champ))) continue;
    avant[champ] = actuel[champ];
    apres[champ] = donnees[champ];
  }
  if (!Object.keys(apres).length) throw new Invalide(MESSAGES_RECAPITULATIF.rienAModifier);
  return { avant, apres };
}

const afficherVehicule = (etat: Etat, id: string) => {
  const { plaque, type } = vehiculeDe(etat, id);
  return { ref: versRef(id), plaque, type };
};

const afficherConducteur = (etat: Etat, id: string) => ({ ref: versRef(id), nom: nomAbrege(conducteurDe(etat, id)) });

/** AAAA-MM-JJ → JJ/MM/AAAA, la saisie des écrans. `null` et l'absence passent tels quels. */
function jour<T extends string | null | undefined>(iso: T): T | string {
  return typeof iso === "string" ? depuisIso(iso) : iso;
}

/** Un jour sans heure vaut la journée entière : la fin tombe le lendemain à 00:00. */
function finSaisie(date: string, heure: string | undefined) {
  return heure ? { fin_date: depuisIso(date), fin_heure: heure } : { fin_date: depuisIso(ajouterJours(date, 1)), fin_heure: "00:00" };
}

function saisieEntreeConducteur(entree: ChampsConducteurEntree & { prenom?: string; nom?: string }): SaisieConducteur {
  const saisie: SaisieConducteur = {};
  for (const champ of CHAMPS_CONDUCTEUR) {
    const valeur = entree[champ];
    if (valeur === undefined) continue;
    saisie[champ] = champ === "date_naissance" || champ === "permis_delivre_le" ? jour(valeur) : valeur;
  }
  return saisie;
}

const CHAMPS_VEHICULE = ["plaque", "modele", "type"] as const;
const CHAMPS_AFFECTATION_ECRITS = ["vehicule_id", "conducteur_id", "debut", "fin"] as const;

/** Une affectation prête à écrire, repassée par toutes les règles de la saisie, sur le type de son véhicule. */
function validerAffectation(etat: Etat, donnees: ChampsAffectation) {
  const type = etat.vehicules.get(donnees.vehicule_id)?.type;
  return valider(schemaAffectation(type).safeParse(saisieAffectation(donnees)));
}

/** Le refus d'un créneau qui chevauche une autre affectation du véhicule, nommée comme dans les écrans. */
function refusChevauchement(etat: Etat, donnees: ChampsAffectation, exclue?: string) {
  const autres = [...etat.affectations.values()].filter((a) => a.vehicule_id === donnees.vehicule_id && a.id !== exclue);
  const conflit = premierConflit(donnees, autres);
  return conflit ? messageConflit(detaillee(etat, conflit), vehiculeDe(etat, donnees.vehicule_id).plaque) : null;
}

/** L'unicité de la plaque, archivés compris, hors du véhicule lui-même. */
function refusPlaqueDe(etat: Etat, plaque: string, exclu?: string) {
  const existant = [...etat.vehicules.values()].find((v) => v.plaque === plaque && v.id !== exclu) ?? null;
  return refusPlaque(plaque, existant);
}

/** L'unicité du permis et de l'email, archivés compris, hors du conducteur lui-même. */
function refusUnicitesDe(etat: Etat, fiche: Pick<FicheConducteur, "permis_numero" | "email">, exclu?: string) {
  for (const champ of ["permis_numero", "email"] as const) {
    const valeur = fiche[champ];
    if (!valeur) continue;
    const existant = [...etat.conducteurs.values()].find((c) => c[champ] === valeur && c.id !== exclu) ?? null;
    const refus = refusUnicite(champ, existant);
    if (refus) return refus;
  }
  return null;
}

// Lire une entrée de l'agent : la fusionner avec l'état actuel, la passer par les schémas, et n'en garder que ce qui change.

function lireEntree(etat: Etat, entree: EntreeModification, ligne: number): LignePossible {
  switch (entree.operation) {
    case "creer_vehicule": {
      const apres = valider(schemaVehicule.safeParse({ plaque: entree.plaque, modele: entree.modele ?? null, type: entree.type }));
      return { operation: entree.operation, apres, affichage: { vehicule: { ref: { ligne }, plaque: apres.plaque, type: apres.type } } };
    }
    case "modifier_vehicule": {
      const actuel = vehiculeDe(etat, entree.vehicule_id);
      refuser(refusFicheArchivee(actuel) ?? refusModificationVehicule(actuel));
      const donnees = valider(
        schemaVehicule.safeParse({
          plaque: entree.plaque ?? actuel.plaque,
          modele: entree.modele === undefined ? actuel.modele : entree.modele,
          type: entree.type ?? actuel.type,
        }),
      );
      const { avant, apres } = difference<ChampsVehicule>(actuel, donnees, CHAMPS_VEHICULE);
      return { operation: entree.operation, cible: actuel.id, avant, apres, affichage: { vehicule: afficherVehicule(etat, actuel.id) } };
    }
    case "archiver_vehicule": {
      const actuel = vehiculeDe(etat, entree.vehicule_id);
      return { operation: entree.operation, cible: actuel.id, affichage: { vehicule: afficherVehicule(etat, actuel.id) } };
    }
    case "creer_conducteur": {
      const apres = valider(schemaConducteur.safeParse(saisieEntreeConducteur(entree)));
      return { operation: entree.operation, apres, affichage: { conducteur: { ref: { ligne }, nom: nomAbrege(apres) } } };
    }
    case "modifier_conducteur": {
      const actuel = conducteurDe(etat, entree.conducteur_id);
      refuser(refusFicheArchivee(actuel));
      const donnees = valider(schemaConducteur.safeParse({ ...saisieConducteur(actuel), ...saisieEntreeConducteur(entree) }));
      const { avant, apres } = difference<FicheConducteur>(actuel as FicheConducteur, donnees, CHAMPS_CONDUCTEUR);
      return {
        operation: entree.operation,
        cible: actuel.id,
        avant,
        apres,
        affichage: { conducteur: afficherConducteur(etat, actuel.id) },
      };
    }
    case "archiver_conducteur": {
      const actuel = conducteurDe(etat, entree.conducteur_id);
      return { operation: entree.operation, cible: actuel.id, affichage: { conducteur: afficherConducteur(etat, actuel.id) } };
    }
    case "creer_affectation": {
      const vehicule_id = resoudre(etat, entree.vehicule, "vehicule", ligne);
      const conducteur_id = resoudre(etat, entree.conducteur, "conducteur", ligne);
      const vehicule = vehiculeDe(etat, vehicule_id);
      refuser(refusVehiculeAffectation(vehicule) ?? refusConducteurAffectation(conducteurDe(etat, conducteur_id)));
      const saisie: SaisieAffectation = {
        vehicule_id,
        conducteur_id,
        debut_date: depuisIso(entree.debut_date),
        debut_heure: entree.debut_heure ?? null,
        ...(entree.fin_date ? finSaisie(entree.fin_date, entree.fin_heure) : { fin_heure: entree.fin_heure ?? null }),
      };
      const donnees = valider(schemaAffectation(vehicule.type).safeParse(saisie));
      return {
        operation: entree.operation,
        apres: { ...donnees, vehicule_id: versRef(vehicule_id), conducteur_id: versRef(conducteur_id) },
        affichage: { vehicule: afficherVehicule(etat, vehicule_id), conducteur: afficherConducteur(etat, conducteur_id) },
      };
    }
    case "modifier_affectation": {
      const actuelle = affectationDe(etat, entree.affectation_id);
      refuser(refusAffectationModifiable(detaillee(etat, actuelle)));
      const saisie = saisieAffectation(actuelle);
      if (entree.vehicule) saisie.vehicule_id = resoudre(etat, entree.vehicule, "vehicule", ligne);
      if (entree.conducteur) saisie.conducteur_id = resoudre(etat, entree.conducteur, "conducteur", ligne);
      if (entree.debut_date) Object.assign(saisie, { debut_date: depuisIso(entree.debut_date), debut_heure: entree.debut_heure ?? null });
      else if (entree.debut_heure) saisie.debut_heure = entree.debut_heure;
      if (entree.fin_date === null) Object.assign(saisie, { fin_date: null, fin_heure: null });
      else if (entree.fin_date) Object.assign(saisie, finSaisie(entree.fin_date, entree.fin_heure));
      else if (entree.fin_heure) saisie.fin_heure = entree.fin_heure;

      const vehicule = vehiculeDe(etat, saisie.vehicule_id!);
      refuser(refusVehiculeAffectation(vehicule) ?? refusConducteurAffectation(conducteurDe(etat, saisie.conducteur_id!)));
      const donnees = valider(schemaAffectation(vehicule.type).safeParse(saisie));
      const { avant, apres } = difference<ChampsAffectation>(actuelle, donnees, CHAMPS_AFFECTATION_ECRITS);
      const changes: Affichage = {};
      const apresRefs: Partial<ChampsAffectationApres> = { ...apres, vehicule_id: undefined, conducteur_id: undefined };
      if (apres.vehicule_id) {
        changes.vehicule = afficherVehicule(etat, apres.vehicule_id);
        apresRefs.vehicule_id = versRef(apres.vehicule_id);
      } else delete apresRefs.vehicule_id;
      if (apres.conducteur_id) {
        changes.conducteur = afficherConducteur(etat, apres.conducteur_id);
        apresRefs.conducteur_id = versRef(apres.conducteur_id);
      } else delete apresRefs.conducteur_id;
      return {
        operation: entree.operation,
        cible: actuelle.id,
        avant,
        apres: apresRefs,
        affichage: {
          vehicule: afficherVehicule(etat, actuelle.vehicule_id),
          conducteur: afficherConducteur(etat, actuelle.conducteur_id),
          ...(changes.vehicule || changes.conducteur ? { apres: changes } : {}),
        },
      };
    }
    case "cloturer_affectation": {
      const actuelle = affectationDe(etat, entree.affectation_id);
      refuser(refusAffectationModifiable(detaillee(etat, actuelle), { cloture: true }) ?? refusCloture(actuelle));
      const fin = valider(schemaCloture(actuelle.debut).safeParse(finSaisie(entree.fin_date, entree.fin_heure)));
      return {
        operation: entree.operation,
        cible: actuelle.id,
        avant: { fin: null },
        apres: { fin },
        affichage: {
          vehicule: afficherVehicule(etat, actuelle.vehicule_id),
          conducteur: afficherConducteur(etat, actuelle.conducteur_id),
        },
      };
    }
  }
}

/**
 * Ce que nomme une référence, pour l'affichage d'une ligne rouge : le véhicule ou le conducteur existant, ou celui que
 * crée une ligne précédente, même rouge. Une référence invalide reste `Invalide`.
 */
function afficherRef(etat: Etat, ref: Ref, quoi: "vehicule" | "conducteur", ligne: number): Affichage {
  let id: string;
  try {
    id = resoudre(etat, ref, quoi, ligne);
  } catch (erreur) {
    // La ligne visée est rouge : son affichage est gardé.
    if (!(erreur instanceof Impossible) || !("ligne" in ref)) throw erreur;
    const garde = etat.affichages.get(ref.ligne);
    return quoi === "vehicule" ? { vehicule: garde?.vehicule } : { conducteur: garde?.conducteur };
  }
  return quoi === "vehicule" ? { vehicule: afficherVehicule(etat, id) } : { conducteur: afficherConducteur(etat, id) };
}

/**
 * L'affichage d'une ligne que les règles refusent avant qu'elle soit lue : au mieux, d'après l'entrée brute (la plaque
 * en majuscules, le nom abrégé). Un élément inconnu ou une référence invalide restent `Invalide`, même derrière le motif
 * des écrans : une proposition mal formée ne s'enregistre jamais.
 */
function affichageEntree(etat: Etat, entree: EntreeModification, ligne: number): Affichage {
  switch (entree.operation) {
    case "creer_vehicule": {
      const plaque = normaliserPlaque(entree.plaque) ?? entree.plaque.trim().toUpperCase();
      return { vehicule: { ref: { ligne }, plaque, type: entree.type } };
    }
    case "modifier_vehicule":
    case "archiver_vehicule":
      return { vehicule: afficherVehicule(etat, entree.vehicule_id) };
    case "creer_conducteur":
      return { conducteur: { ref: { ligne }, nom: nomAbrege({ prenom: entree.prenom.trim(), nom: entree.nom }) } };
    case "modifier_conducteur":
    case "archiver_conducteur":
      return { conducteur: afficherConducteur(etat, entree.conducteur_id) };
    case "creer_affectation":
      return { ...afficherRef(etat, entree.vehicule, "vehicule", ligne), ...afficherRef(etat, entree.conducteur, "conducteur", ligne) };
    case "modifier_affectation":
    case "cloturer_affectation": {
      const actuelle = affectationDe(etat, entree.affectation_id);
      if (entree.operation === "modifier_affectation") {
        if (entree.vehicule) afficherRef(etat, entree.vehicule, "vehicule", ligne);
        if (entree.conducteur) afficherRef(etat, entree.conducteur, "conducteur", ligne);
      }
      return {
        vehicule: afficherVehicule(etat, actuelle.vehicule_id),
        conducteur: afficherConducteur(etat, actuelle.conducteur_id),
      };
    }
  }
}

// Vérifier une ligne sur l'état simulé : les mêmes contrôles que les écrans, et les mêmes schémas, sur la fiche entière.

/** Les valeurs de l'affectation après la ligne, références résolues. */
function affectationApres(
  etat: Etat,
  actuelle: ChampsAffectation | null,
  apres: Partial<ChampsAffectationApres>,
  ligne: number,
): ChampsAffectation {
  const { vehicule_id, conducteur_id, ...instants } = apres;
  return {
    ...(actuelle ?? {}),
    ...instants,
    ...(vehicule_id ? { vehicule_id: resoudre(etat, vehicule_id, "vehicule", ligne) } : {}),
    ...(conducteur_id ? { conducteur_id: resoudre(etat, conducteur_id, "conducteur", ligne) } : {}),
  } as ChampsAffectation;
}

function verifierLigne(etat: Etat, l: LignePossible, ligne: number): void {
  switch (l.operation) {
    case "creer_vehicule":
      return refuser(refusPlaqueDe(etat, l.apres.plaque));
    case "modifier_vehicule": {
      const actuel = vehiculeDe(etat, l.cible);
      refuser(refusFicheArchivee(actuel) ?? refusModificationVehicule(actuel));
      const donnees = valider(schemaVehicule.safeParse({ ...actuel, ...l.apres }));
      refuser(refusPlaqueDe(etat, donnees.plaque, actuel.id));
      return refuser(refusPassagePool(donnees.type, ouverteDe(etat, "vehicule_id", actuel.id)));
    }
    case "archiver_vehicule": {
      const actuel = vehiculeDe(etat, l.cible);
      return refuser(refusDejaArchivee(actuel) ?? refusArchivage(ouverteDe(etat, "vehicule_id", actuel.id)));
    }
    case "creer_conducteur":
      return refuser(refusUnicitesDe(etat, l.apres));
    case "modifier_conducteur": {
      const actuel = conducteurDe(etat, l.cible);
      refuser(refusFicheArchivee(actuel));
      const donnees = valider(schemaConducteur.safeParse(saisieConducteur({ ...actuel, ...l.apres })));
      return refuser(refusUnicitesDe(etat, donnees, actuel.id));
    }
    case "archiver_conducteur": {
      const actuel = conducteurDe(etat, l.cible);
      return refuser(refusDejaArchivee(actuel) ?? refusArchivage(ouverteDe(etat, "conducteur_id", actuel.id)));
    }
    case "creer_affectation": {
      const donnees = affectationApres(etat, null, l.apres, ligne);
      refuser(refusVehiculeAffectation(vehiculeDe(etat, donnees.vehicule_id)));
      refuser(refusConducteurAffectation(conducteurDe(etat, donnees.conducteur_id)));
      validerAffectation(etat, donnees);
      return refuser(refusChevauchement(etat, donnees));
    }
    case "modifier_affectation": {
      const actuelle = affectationDe(etat, l.cible);
      refuser(refusAffectationModifiable(detaillee(etat, actuelle)));
      const donnees = affectationApres(etat, actuelle, l.apres, ligne);
      refuser(refusVehiculeAffectation(vehiculeDe(etat, donnees.vehicule_id)));
      refuser(refusConducteurAffectation(conducteurDe(etat, donnees.conducteur_id)));
      validerAffectation(etat, donnees);
      return refuser(refusChevauchement(etat, donnees, actuelle.id));
    }
    case "cloturer_affectation": {
      const actuelle = affectationDe(etat, l.cible);
      refuser(refusAffectationModifiable(detaillee(etat, actuelle), { cloture: true }) ?? refusCloture(actuelle));
      valider(schemaCloture(actuelle.debut).safeParse(saisieAffectation({ ...actuelle, fin: l.apres.fin })));
      return;
    }
  }
}

/** La ligne écrite dans l'état simulé : les lignes suivantes la voient. */
function appliquerLigne(etat: Etat, l: LignePossible, ligne: number): void {
  switch (l.operation) {
    case "creer_vehicule": {
      const id = idLigne(ligne);
      etat.vehicules.set(id, { id, ...l.apres, archive_le: null, lecture_seule_le: null });
      return;
    }
    case "modifier_vehicule":
      etat.vehicules.set(l.cible, { ...vehiculeDe(etat, l.cible), ...l.apres });
      return;
    case "archiver_vehicule":
      etat.vehicules.set(l.cible, { ...vehiculeDe(etat, l.cible), archive_le: ARCHIVE_SIMULE });
      return;
    case "creer_conducteur": {
      const id = idLigne(ligne);
      etat.conducteurs.set(id, { id, ...l.apres, archive_le: null });
      return;
    }
    case "modifier_conducteur":
      etat.conducteurs.set(l.cible, { ...conducteurDe(etat, l.cible), ...l.apres });
      return;
    case "archiver_conducteur":
      etat.conducteurs.set(l.cible, { ...conducteurDe(etat, l.cible), archive_le: ARCHIVE_SIMULE });
      return;
    case "creer_affectation": {
      const id = idLigne(ligne);
      etat.affectations.set(id, { id, ...affectationApres(etat, null, l.apres, ligne) });
      return;
    }
    case "modifier_affectation": {
      const actuelle = affectationDe(etat, l.cible);
      etat.affectations.set(l.cible, { id: actuelle.id, ...affectationApres(etat, actuelle, l.apres, ligne) });
      return;
    }
    case "cloturer_affectation":
      etat.affectations.set(l.cible, { ...affectationDe(etat, l.cible), fin: l.apres.fin });
      return;
  }
}

/** L'élément existant que vise une entrée ou une ligne stockée, s'il y en a un. */
function cibleDe(item: EntreeModification | LigneRecapitulatif): string | undefined {
  if ("cible" in item) return item.cible;
  if ("vehicule_id" in item) return item.vehicule_id;
  if ("conducteur_id" in item) return item.conducteur_id;
  if ("affectation_id" in item) return item.affectation_id;
  return undefined;
}

type Parcours = {
  /** Toutes les lignes, dans l'ordre, les rouges à leur place. */
  lignes: LigneRecapitulatif[];
  /** Le motif de chaque ligne refusée, rouge ou mal formée. */
  motifs: Motif[];
  /** Le motif de chaque ligne mal formée par l'agent. */
  invalides: Motif[];
};

/**
 * Ligne après ligne : chaque ligne est lue, vérifiée sur l'état simulé, puis écrite dans cet état. Une ligne refusée par
 * les règles des écrans garde sa place, en rouge, sans entrer dans l'état : celles qui en dépendent deviennent rouges à
 * leur tour. `afficher` nomme ses éléments quand elle n'a pas pu être lue.
 */
function parcourir<T extends EntreeModification | LigneRecapitulatif>(
  etat: Etat,
  items: readonly T[],
  lire: (item: T, ligne: number) => LignePossible,
  afficher: (item: T, ligne: number) => Affichage,
): Parcours {
  const parcours: Parcours = { lignes: [], motifs: [], invalides: [] };
  const visees = new Map<string, number>();
  items.forEach((item, rang) => {
    const ligne = rang + 1;
    let lue: LignePossible | null = null;
    try {
      try {
        const element = elementVise(item);
        const deja = element && visees.get(element);
        if (deja) throw new Invalide(MESSAGES_RECAPITULATIF.uneLigneParElement(deja));
        if (element) visees.set(element, ligne);
        lue = lire(item, ligne);
        verifierLigne(etat, lue, ligne);
        appliquerLigne(etat, lue, ligne);
        etat.affichages.set(ligne, lue.affichage);
        parcours.lignes.push(lue);
      } catch (erreur) {
        if (!(erreur instanceof Impossible)) throw erreur;
        const affichage = lue?.affichage ?? afficher(item, ligne);
        const cible = cibleDe(item);
        etat.impossibles.add(ligne);
        etat.affichages.set(ligne, affichage);
        parcours.lignes.push({ operation: item.operation, ...(cible ? { cible } : {}), affichage, refus: erreur.message });
        parcours.motifs.push({ ligne, motif: erreur.message });
      }
    } catch (erreur) {
      if (!(erreur instanceof Invalide)) throw erreur;
      etat.impossibles.add(ligne);
      parcours.motifs.push({ ligne, motif: erreur.message });
      parcours.invalides.push({ ligne, motif: erreur.message });
    }
  });
  return parcours;
}

const TROP: ResultatRecapitulatif = {
  ok: false,
  motifs: [{ ligne: MAX_LIGNES_RECAPITULATIF + 1, motif: MESSAGES_RECAPITULATIF.trop }],
};

/**
 * Les modifications proposées par l'agent, prêtes à stocker : les lignes que les règles des écrans refusent sont
 * rouges, avec le motif des écrans. Une proposition mal formée est refusée en entier, avec le motif de chaque ligne en
 * cause. L'instantané est la flotte du moment, lue sous la session du gestionnaire.
 */
export function preparerRecapitulatif(instantane: Instantane, entrees: readonly EntreeModification[]): ResultatRecapitulatif {
  if (entrees.length > MAX_LIGNES_RECAPITULATIF) return TROP;
  const etat = etatDe(
    instantane,
    entrees.map(({ operation }) => CREATIONS[operation]),
  );
  const { lignes, invalides } = parcourir(
    etat,
    entrees,
    (entree, ligne) => lireEntree(etat, entree, ligne),
    (entree, ligne) => affichageEntree(etat, entree, ligne),
  );
  return invalides.length ? { ok: false, motifs: invalides } : { ok: true, lignes };
}

/** « avant » ne vaut plus : la ligne a été préparée sur une flotte qui a changé. */
function perimee(etat: Etat, l: LignePossible): string | null {
  if (!("cible" in l)) return null;
  const actuel =
    l.operation.endsWith("_vehicule")
      ? vehiculeDe(etat, l.cible)
      : l.operation.endsWith("_conducteur")
        ? conducteurDe(etat, l.cible)
        : affectationDe(etat, l.cible);
  if (!("avant" in l)) return null;
  const change = Object.entries(l.avant).some(
    ([champ, valeur]) => !memeValeur((actuel as Record<string, unknown>)[champ], valeur, INSTANTS.has(champ)),
  );
  return change ? MESSAGES_RECAPITULATIF.aChange(designationLigne(l)) : null;
}

/**
 * « Confirmer » : les lignes stockées, revérifiées sur la flotte du moment. Une ligne rouge, un élément disparu, puis un
 * « avant » qui a changé, puis les règles des écrans, ligne après ligne, comme à la proposition. Tout motif refuse.
 */
export function revaliderRecapitulatif(instantane: Instantane, lignes: readonly LigneRecapitulatif[]): ResultatRecapitulatif {
  if (lignes.length > MAX_LIGNES_RECAPITULATIF) return TROP;
  const etat = etatDe(
    instantane,
    lignes.map(({ operation }) => CREATIONS[operation]),
  );
  const parcours = parcourir(
    etat,
    lignes,
    (l) => {
      if (estImpossible(l)) throw new Impossible(l.refus);
      refuser(perimee(etat, l));
      return l;
    },
    (l) => l.affichage,
  );
  return parcours.motifs.length ? { ok: false, motifs: parcours.motifs } : { ok: true, lignes: parcours.lignes };
}

// Les éléments à lire avant de préparer ou de revérifier : ceux que les lignes visent ou nomment.

export type Cibles = { vehicules: string[]; conducteurs: string[]; affectations: string[] };

function cibles(vehicules: (Ref | string | undefined)[], conducteurs: (Ref | string | undefined)[], affectations: (string | undefined)[]) {
  const ids = (refs: (Ref | string | undefined)[]) => [
    ...new Set(
      refs.flatMap((ref) => (typeof ref === "string" ? [ref] : ref && "id" in ref ? [ref.id] : [])).filter((id) => !ID_LIGNE.test(id)),
    ),
  ];
  return { vehicules: ids(vehicules), conducteurs: ids(conducteurs), affectations: ids(affectations) };
}

export function ciblesDesEntrees(entrees: readonly EntreeModification[]): Cibles {
  return cibles(
    entrees.flatMap((e): (Ref | string | undefined)[] => ("vehicule_id" in e ? [e.vehicule_id] : "vehicule" in e ? [e.vehicule] : [])),
    entrees.flatMap((e): (Ref | string | undefined)[] =>
      "conducteur_id" in e ? [e.conducteur_id] : "conducteur" in e ? [e.conducteur] : [],
    ),
    entrees.flatMap((e) => ("affectation_id" in e ? [e.affectation_id] : [])),
  );
}

export function ciblesDe(lignes: readonly LigneRecapitulatif[]): Cibles {
  const vise = (fin: string) => lignes.flatMap((l) => ("cible" in l && l.operation.endsWith(fin) ? [l.cible] : []));
  const apres = (champ: "vehicule_id" | "conducteur_id") =>
    lignes.flatMap((l) => (l.operation.endsWith("_affectation") && "apres" in l ? [(l.apres as Partial<ChampsAffectationApres>)[champ]] : []));
  return cibles([...vise("_vehicule"), ...apres("vehicule_id")], [...vise("_conducteur"), ...apres("conducteur_id")], vise("_affectation"));
}

// Les libellés : la carte du panneau, et le texte que l'outil renvoie à l'agent (design-preview.html, Demande à Désigno).

export type Segment = { texte: string } | { plaque: string; ref: Ref } | { conducteur: string; ref: Ref };
/** « Fin : sans fin → 07/11/2026 00:00 », ou un complément sans libellé (« attitré »). */
export type Detail = { libelle?: string; avant?: string; apres: string } | { texte: string };
/** `refus` : le motif d'une ligne rouge, qui remplace ses détails. */
export type LigneDecrite = { quoi: Segment[]; details: Detail[]; refus?: string };

const AUCUNE = "—";
const instant = (valeur: string | null | undefined) => (valeur ? formaterDateHeure(valeur) : "sans fin");
const typeEnMinuscules = (type: TypeVehicule) => LIBELLES_TYPE[type].toLowerCase();

function valeurConducteur(champ: ChampConducteur, valeur: unknown): string {
  if (valeur == null || valeur === "") return AUCUNE;
  if (champ === "civilite") return LIBELLES_CIVILITE[valeur as Civilite];
  if (champ === "date_naissance" || champ === "permis_delivre_le") return depuisIso(String(valeur));
  if (Array.isArray(valeur)) return valeur.join(", ");
  return String(valeur);
}

function valeurVehicule(champ: keyof ChampsVehicule, valeur: unknown): string {
  if (valeur == null || valeur === "") return AUCUNE;
  return champ === "type" ? typeEnMinuscules(valeur as TypeVehicule) : String(valeur);
}

const LIBELLES_VEHICULE: Record<keyof ChampsVehicule, string> = { plaque: "Plaque", modele: "Modèle", type: "Type" };

function plaque(affichage: Affichage): Segment {
  return { plaque: affichage.vehicule?.plaque ?? "?", ref: affichage.vehicule?.ref ?? { ligne: 0 } };
}

function conducteur(affichage: Affichage): Segment {
  return { conducteur: affichage.conducteur?.nom ?? "?", ref: affichage.conducteur?.ref ?? { ligne: 0 } };
}

/** « Clôturer l'affectation de Karim B. sur AB-123-CD » : ce que fait la ligne, possible ou rouge. */
function quoiDe(operation: Operation, affichage: Affichage): Segment[] {
  switch (operation) {
    case "creer_vehicule":
      return [{ texte: "Ajouter le véhicule " }, plaque(affichage)];
    case "modifier_vehicule":
      return [{ texte: "Modifier le véhicule " }, plaque(affichage)];
    case "archiver_vehicule":
      return [{ texte: "Archiver le véhicule " }, plaque(affichage)];
    case "creer_conducteur":
      return [{ texte: "Ajouter la fiche de " }, conducteur(affichage)];
    case "modifier_conducteur":
      return [{ texte: "Modifier la fiche de " }, conducteur(affichage)];
    case "archiver_conducteur":
      return [{ texte: "Archiver la fiche de " }, conducteur(affichage)];
    case "creer_affectation":
      return [{ texte: "Créer une affectation pour " }, conducteur(affichage), { texte: " sur " }, plaque(affichage)];
    case "modifier_affectation":
      return [{ texte: "Modifier l'affectation de " }, conducteur(affichage), { texte: " sur " }, plaque(affichage)];
    case "cloturer_affectation":
      return [{ texte: "Clôturer l'affectation de " }, conducteur(affichage), { texte: " sur " }, plaque(affichage)];
  }
}

export function decrireLigne(l: LigneRecapitulatif): LigneDecrite {
  const { affichage } = l;
  const quoi = quoiDe(l.operation, affichage);
  if (estImpossible(l)) return { quoi, details: [], refus: l.refus };
  switch (l.operation) {
    case "creer_vehicule":
      return {
        quoi,
        details: [...(l.apres.modele ? [{ libelle: "Modèle", apres: l.apres.modele }] : []), { texte: typeEnMinuscules(l.apres.type) }],
      };
    case "modifier_vehicule":
      return {
        quoi,
        details: CHAMPS_VEHICULE.filter((champ) => champ in l.apres).map((champ) => ({
          libelle: LIBELLES_VEHICULE[champ],
          avant: valeurVehicule(champ, l.avant[champ]),
          apres: valeurVehicule(champ, l.apres[champ]),
        })),
      };
    case "archiver_vehicule":
      return { quoi, details: [{ avant: "Actif", apres: "Archivé" }] };
    case "creer_conducteur":
      return {
        quoi,
        details: CHAMPS_CONDUCTEUR.filter((champ) => champ !== "prenom" && champ !== "nom" && l.apres[champ] != null).map((champ) => ({
          libelle: LIBELLES_CHAMP_CONDUCTEUR[champ],
          apres: valeurConducteur(champ, l.apres[champ]),
        })),
      };
    case "modifier_conducteur":
      return {
        quoi,
        details: CHAMPS_CONDUCTEUR.filter((champ) => champ in l.apres).map((champ) => ({
          libelle: LIBELLES_CHAMP_CONDUCTEUR[champ],
          avant: valeurConducteur(champ, l.avant[champ]),
          apres: valeurConducteur(champ, l.apres[champ]),
        })),
      };
    case "archiver_conducteur":
      return { quoi, details: [{ avant: "Actif", apres: "Archivé" }] };
    case "creer_affectation":
      return {
        quoi,
        details: [
          { libelle: "Début", apres: instant(l.apres.debut) },
          l.apres.fin ? { libelle: "Fin", apres: instant(l.apres.fin) } : { texte: "sans fin" },
          ...(affichage.vehicule ? [{ texte: typeEnMinuscules(affichage.vehicule.type) }] : []),
        ],
      };
    case "modifier_affectation": {
      const changes = l.affichage.apres ?? {};
      return {
        quoi,
        details: [
          ...(changes.vehicule ? [{ libelle: "Véhicule", avant: affichage.vehicule?.plaque ?? "?", apres: changes.vehicule.plaque }] : []),
          ...(changes.conducteur ? [{ libelle: "Conducteur", avant: affichage.conducteur?.nom ?? "?", apres: changes.conducteur.nom }] : []),
          ...("debut" in l.apres ? [{ libelle: "Début", avant: instant(l.avant.debut), apres: instant(l.apres.debut) }] : []),
          ...("fin" in l.apres ? [{ libelle: "Fin", avant: instant(l.avant.fin), apres: instant(l.apres.fin) }] : []),
        ],
      };
    }
    case "cloturer_affectation":
      return {
        quoi,
        details: [{ libelle: "Fin", avant: "sans fin", apres: instant(l.apres.fin) }],
      };
  }
}

const texteSegment = (segment: Segment) => ("texte" in segment ? segment.texte : "plaque" in segment ? segment.plaque : segment.conducteur);

const texteDetail = (detail: Detail) =>
  "texte" in detail
    ? detail.texte
    : `${detail.libelle ? `${detail.libelle} : ` : ""}${detail.avant !== undefined ? `${detail.avant} → ` : ""}${detail.apres}`;

/**
 * « Clôturer l'affectation de Karim B. sur AB-123-CD · Fin : sans fin → 07/11/2026 00:00 » : la ligne pour l'agent. Une
 * ligne rouge finit par « Impossible : » et son motif.
 */
export function texteLigne(l: LigneRecapitulatif): string {
  const { quoi, details, refus } = decrireLigne(l);
  return [quoi.map(texteSegment).join(""), ...details.map(texteDetail), ...(refus ? [`Impossible : ${refus}`] : [])].join(" · ");
}

/** « L'affectation de Karim B. sur AB-123-CD » : l'élément d'une ligne, dans un message. */
export function designationLigne(l: LigneRecapitulatif): string {
  const { vehicule, conducteur: personne } = l.affichage;
  if (l.operation.endsWith("_affectation")) return `L'affectation de ${personne?.nom ?? "?"} sur ${vehicule?.plaque ?? "?"}`;
  if (l.operation.endsWith("_vehicule")) return `Le véhicule ${vehicule?.plaque ?? "?"}`;
  return `La fiche de ${personne?.nom ?? "?"}`;
}

/** Le texte du sort d'un récapitulatif qui n'attend plus « Confirmer ». */
export function texteStatut({ statut, applique_le }: Pick<RecapitulatifConversation, "statut" | "applique_le">): string | null {
  switch (statut) {
    case "propose":
      return null;
    case "applique":
      return MESSAGES_RECAPITULATIF.applique(applique_le!);
    default:
      return MESSAGES_RECAPITULATIF[statut];
  }
}
