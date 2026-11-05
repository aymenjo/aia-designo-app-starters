import { moisQuota, prochainDeverrouillage } from "@/lib/abonnement/quotas";
import { aujourdhuiParis, depuisIso } from "@/lib/dates";
import { nomComplet } from "@/lib/flotte/regles";
import { texteLigne, type LigneRecapitulatif } from "@/lib/flotte/regles-recapitulatif";
import { formaterDate, formaterDateAHeure } from "@/lib/format";
import { TYPES_ELEMENT, UUID, lienElement, type TypeElement } from "./citations";

// Demande à Désigno (phase 26) : les messages, les exemples et les délais, définis une seule fois. Sans dépendance
// serveur : le panneau les reprend. La limite de demandes par mois (phase 27) est dans src/lib/abonnement/plans.ts.
// Le contexte de l'écran, les étapes et « Arrêter » (phase 28) sont en fin de fichier, puis « Modifier » (phase 30).
// Les messages de l'historique (phase 32) sont avec les autres, dans `MESSAGES_AGENT`.

/** Les 3 exemples du PRD, à l'ouverture d'une nouvelle conversation : un clic les envoie. */
export const EXEMPLES = [
  "Qui avait AB-123-CD le 12/03 à 8 h ?",
  "Quels avis sont bloqués, et pourquoi ?",
  "Karim part vendredi, passe son camion à Léa",
] as const;

/** Les conversations de plus de 30 jours sont effacées, en base et chez Anthropic. */
export const CONSERVATION_JOURS = 30;

/** Au-delà, la demande est interrompue chez Anthropic, et le gestionnaire est invité à réessayer. */
export const DUREE_MAX_DEMANDE_MS = 120_000;

/** La durée maximale de la route /api/agent (`maxDuration`) : un verrou plus vieux est celui d'une demande morte. */
export const DUREE_MAX_ROUTE_S = 300;

export const LONGUEUR_MAX_DEMANDE = 2000;

/** Le panneau interroge le serveur à ce rythme tant qu'une demande est en cours (après une coupure). */
export const INTERVALLE_SUIVI_MS = 2000;

/** Le serveur vérifie à ce rythme si le gestionnaire a cliqué « Arrêter » (phase 28). */
export const INTERVALLE_ARRET_MS = 1000;

/** Au-delà, l'étape en cours est coupée : la colonne `conversation.etape` n'en garde pas plus. */
export const LONGUEUR_MAX_ETAPE = 200;

export const MESSAGES_AGENT = {
  pro: "Demande à Désigno est une fonction Pro : passez en Pro pour poser vos questions sur votre flotte.",
  indisponible: "Désigno ne peut pas répondre pour l'instant. Réessayez dans un instant.",
  enCours: "Désigno répond encore à votre demande précédente. Attendez sa réponse avant d'en envoyer une autre.",
  delai: "Désigno n'a pas pu répondre à temps. Reformulez votre demande, ou réessayez.",
  refus: "Désigno ne peut pas répondre à cette demande. Reformulez-la.",
  vide: "Écrivez votre demande.",
  tropLong: `Votre demande dépasse ${LONGUEUR_MAX_DEMANDE} caractères : raccourcissez-la.`,
  /** Le résultat renvoyé à l'agent pour un outil resté sans réponse après une coupure. */
  interrompue: "Demande interrompue : ce résultat n'est plus attendu.",
  /** Les demandes du mois sont épuisées (phase 27) : `retour` est la remise à zéro, en ISO. « … retour le 01/12. » */
  limite: (retour: string) => `Limite atteinte, retour le ${depuisIso(retour).slice(0, 5)}.`,
  limiteEcrans: "En attendant, vos véhicules, conducteurs, planning et avis restent accessibles par les écrans.",
  /** La mention qui remplace la réponse d'une demande arrêtée (phase 28), en gris dans le fil. */
  arretee: "Demande arrêtée.",
  /** L'étape affichée avant le premier appel d'outil. */
  etapeDefaut: "Je lis votre demande…",
  /** L'étape affichée entre le clic sur « Arrêter » et la mention « Demande arrêtée. ». */
  arretEnCours: "Arrêt en cours…",
  arretImpossible: "Désigno n'a pas pu arrêter la demande. Réessayez.",
  /** Une demande envoyée par « Modifier » (phase 30) : la pilule au-dessus de la saisie, et le rappel sous la bulle. */
  corrige: "Corrige le récapitulatif",
  /** Le texte d'aide de la saisie pendant une correction. */
  placeholderCorrection: "Précisez la correction…",
  /** L'historique (phase 32) : la liste des conversations des 30 derniers jours, puis la lecture seule. */
  historique: `Conversations des ${CONSERVATION_JOURS} derniers jours`,
  historiqueVide: `Aucune conversation ces ${CONSERVATION_JOURS} derniers jours.`,
  lectureSeule: "Conversation terminée : elle se consulte en lecture seule.",
  plusConsultable: "Cette conversation n'est plus consultable.",
  /** La sous-ligne d'une conversation de la liste, quand au moins un récapitulatif y a été appliqué. */
  appliques: (n: number) => (n > 1 ? `${n} récapitulatifs appliqués` : `${n} récapitulatif appliqué`),
} as const;

/** La demande saisie, prête à envoyer, ou le message qui la refuse. */
export function verifierDemande(brut: unknown): { ok: true; texte: string } | { ok: false; erreur: string } {
  const texte = typeof brut === "string" ? brut.trim() : "";
  if (!texte) return { ok: false, erreur: MESSAGES_AGENT.vide };
  if (texte.length > LONGUEUR_MAX_DEMANDE) return { ok: false, erreur: MESSAGES_AGENT.tropLong };
  return { ok: true, texte };
}

/** Le début de la période conservée : une conversation commencée avant est effacée. */
export function debutConservation(maintenant: Date): Date {
  return new Date(maintenant.getTime() - CONSERVATION_JOURS * 86_400_000);
}

/** Le mois calendaire, à Paris, dont le compteur compte une demande faite à cet instant : « 2026-11-01 ». */
export function moisDemandes(maintenant: Date): string {
  return moisQuota(aujourdhuiParis(maintenant));
}

/** Le 1er du mois suivant, à Paris, en ISO : le compteur de demandes repart à 0. */
export function remiseAZeroDemandes(maintenant: Date): string {
  return prochainDeverrouillage(aujourdhuiParis(maintenant));
}

/** Un verrou pris avant cet instant est celui d'une demande morte. */
export function verrouMortAvant(maintenant: Date): Date {
  return new Date(maintenant.getTime() - DUREE_MAX_ROUTE_S * 1000);
}

const JOUR_PARIS = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris",
  weekday: "long",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});
const HEURE_PARIS = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * Le contexte joint à chaque demande : la date et l'heure de Paris, pour que l'agent comprenne « hier », « vendredi »
 * ou « cette année ». « Nous sommes le samedi 31/10/2026, il est 10:00 (heure de Paris). »
 */
export function contexteDate(maintenant: Date): string {
  return `Nous sommes le ${JOUR_PARIS.format(maintenant)}, il est ${HEURE_PARIS.format(maintenant)} (heure de Paris).`;
}

/** Le sort d'un récapitulatif de modifications (phase 29) que l'agent ignore encore. */
export type SortRecapitulatif = { id: string; statut: "applique" | "annule" | "expire"; applique_le: string | null };

const PHRASES_SORT: Record<SortRecapitulatif["statut"], (sort: SortRecapitulatif) => string> = {
  applique: ({ applique_le }) =>
    `Le gestionnaire a confirmé le récapitulatif que tu as proposé : ses modifications sont appliquées depuis le ${formaterDateAHeure(applique_le!)}.`,
  annule: () => "Le gestionnaire a annulé le récapitulatif que tu as proposé : rien n'a été modifié.",
  expire: () => "Le récapitulatif que tu as proposé a expiré sans être appliqué : rien n'a été modifié.",
};

/**
 * La note jointe à la demande suivante, après la date : ce que sont devenus les récapitulatifs proposés depuis la
 * dernière réponse de l'agent. `null` quand il n'y a rien à dire.
 */
export function noteRecapitulatifs(sorts: readonly SortRecapitulatif[]): string | null {
  if (!sorts.length) return null;
  return sorts.map((sort) => PHRASES_SORT[sort.statut](sort)).join(" ");
}

// Le contexte de l'écran, les étapes et « Arrêter » (phase 28).

/** L'élément de l'écran ouvert : chaque demande part avec lui. */
export type RefContexte = { type: TypeElement; id: string };

/** Le contexte d'une demande, enregistré avec elle (`message.contexte`) et rappelé sous sa bulle. */
export type ContexteDemande = RefContexte & { libelle: string };

/** Un élément nommé dans la note : un véhicule ou un conducteur que « ce véhicule » ou « ce conducteur » désigne. */
export type ElementNomme = { id: string; libelle: string };

/**
 * Ce que désignent « ce véhicule » et « ce conducteur » sur l'écran, quand il n'y a qu'un candidat (contexte.ts). Le
 * rôle du conducteur suit son nom : « son conducteur validé », « qui conduit ce véhicule en ce moment ».
 */
export type ReferencesDerivees = { vehicule?: ElementNomme; conducteur?: ElementNomme & { role: string } };

/**
 * L'élément de l'écran d'après son chemin : la fiche d'un avis (son récap compris), d'un véhicule ou d'un conducteur.
 * `null` pour tout autre écran : les listes, le planning, le dépôt d'un avis.
 */
export function elementDeLEcran(chemin: string): RefContexte | null {
  for (const type of TYPES_ELEMENT) {
    const prefixe = lienElement(type, "");
    if (!chemin.startsWith(prefixe)) continue;
    const [id, ...reste] = chemin.slice(prefixe.length).replace(/\/$/, "").split("/");
    const suite = reste.join("/");
    if (suite && !(type === "avis" && suite === "recap")) return null;
    const minuscule = id.toLowerCase();
    return UUID.test(minuscule) ? { type, id: minuscule } : null;
  }
  return null;
}

/** Ce qu'il faut d'un élément pour le nommer derrière « Sur : ». */
export type ElementALibeller =
  | { type: "avis"; numero: string | null; plaque: string | null; infraction_le: string | null; depose_le: string }
  | { type: "vehicule"; plaque: string }
  | { type: "conducteur"; prenom: string; nom: string };

/**
 * Le libellé de l'élément, affiché derrière « Sur : » : « avis n° 1234567890 », « avis sans n° · AB-123-CD du
 * 12/03/2026 », « avis déposé le 03/11/2026 », « AB-123-CD », « Karim Benali ».
 */
export function libelleContexte(element: ElementALibeller): string {
  switch (element.type) {
    case "avis":
      if (element.numero) return `avis n° ${element.numero}`;
      if (element.plaque && element.infraction_le) {
        return `avis sans n° · ${element.plaque} du ${formaterDate(element.infraction_le)}`;
      }
      return `avis déposé le ${formaterDate(element.depose_le)}`;
    case "vehicule":
      return element.plaque;
    case "conducteur":
      return nomComplet(element);
  }
}

const COLONNE_ID: Record<TypeElement, string> = { avis: "avis_id", vehicule: "vehicule_id", conducteur: "conducteur_id" };
const DEMONSTRATIFS: Record<TypeElement, string> = { avis: "cet avis", vehicule: "ce véhicule", conducteur: "ce conducteur" };

/** « AB-123-CD (vehicule_id : …, lien : /flotte/vehicules/…) » : de quoi le lire avec un outil, et le citer. */
function designation(type: TypeElement, { id, libelle }: ElementNomme) {
  return `${libelle} (${COLONNE_ID[type]} : ${id}, lien : ${lienElement(type, id)})`;
}

const majuscule = (texte: string) => texte.charAt(0).toUpperCase() + texte.slice(1);

/**
 * La note jointe à chaque demande, après la date : l'élément de l'écran ouvert, et ce que désignent « cet avis », « ce
 * véhicule » et « ce conducteur ». Toujours jointe, même sans élément : le contexte d'une demande précédente ne sert pas
 * une seconde fois.
 */
export function noteContexte(contexte: ContexteDemande | null, derives: ReferencesDerivees = {}): string {
  const sens: Partial<Record<TypeElement, string>> = {};
  let ouvert = "aucun avis, véhicule ni conducteur";
  if (contexte) {
    const nomme = { id: contexte.id, libelle: contexte.libelle };
    // Le libellé d'un avis le nomme déjà : « avis n° 1234567890 », « avis déposé le … ».
    const quoi = { avis: "", vehicule: "le véhicule ", conducteur: "la fiche du conducteur " }[contexte.type];
    ouvert = `${quoi}${designation(contexte.type, nomme)}`;
    sens[contexte.type] = `« ${majuscule(DEMONSTRATIFS[contexte.type])} » le désigne.`;
    if (derives.vehicule && contexte.type !== "vehicule") {
      sens.vehicule = `« Ce véhicule » désigne ${designation("vehicule", derives.vehicule)}.`;
    }
    if (derives.conducteur && contexte.type !== "conducteur") {
      sens.conducteur = `« Ce conducteur » désigne ${designation("conducteur", derives.conducteur)}, ${derives.conducteur.role}.`;
    }
  }
  const sansSens = TYPES_ELEMENT.filter((type) => !sens[type]).map(
    (type, rang) => `« ${rang ? DEMONSTRATIFS[type] : majuscule(DEMONSTRATIFS[type])} »`,
  );
  const reste = sansSens.length
    ? `${enumerer(sansSens)} ne ${sansSens.length > 1 ? "désignent" : "désigne"} rien sur cet écran : demande lequel.`
    : [];
  return [`Écran ouvert : ${ouvert}.`, ...TYPES_ELEMENT.flatMap((type) => sens[type] ?? []), reste].flat().join(" ");
}

/** « a », « a et b », « a, b et c ». */
function enumerer(mots: readonly string[]) {
  return mots.length > 1 ? `${mots.slice(0, -1).join(", ")} et ${mots.at(-1)}` : mots[0];
}

/** La note jointe à la demande qui suit un arrêt : la réponse arrêtée ne doit pas reprendre d'elle-même. */
export const NOTE_ARRET = "Le gestionnaire a arrêté ta réponse à sa demande précédente : ne la reprends pas, sauf s'il te le demande.";

/** L'entrée d'un outil, telle que la définition l'a validée : seuls ces champs nomment l'étape. */
export type EntreeEtape = {
  texte?: string;
  vehicule_id?: string;
  conducteur_id?: string;
  avis_id?: string;
  numero?: string;
  date?: string;
  heure?: string;
  bloques_seulement?: boolean;
};

/** Le nom d'un élément, d'après son id : la plaque, le nom ou le n° d'avis ; `null` s'il est inconnu ou sans n°. */
export type Nommer = (type: TypeElement, id: string) => Promise<string | null> | string | null;

/**
 * L'étape en cours, d'après l'outil que l'agent appelle et son entrée : « Je consulte le planning de AB-123-CD… ». Un
 * élément que `nommer` ne connaît pas donne la phrase sans nom.
 */
export async function libelleEtape(nom: string, entree: EntreeEtape, nommer: Nommer): Promise<string> {
  const texte = entree.texte?.trim();
  const nomDe = async (type: TypeElement, id: string | undefined) => (id ? await nommer(type, id) : null);
  switch (nom) {
    case "chercher_vehicules":
      return texte ? `Je cherche ${texte} dans les véhicules…` : "Je consulte les véhicules…";
    case "chercher_conducteurs":
      return texte ? `Je cherche ${texte} dans les conducteurs…` : "Je consulte les conducteurs…";
    case "fiche_conducteur": {
      const conducteur = await nomDe("conducteur", entree.conducteur_id);
      return conducteur ? `J'ouvre la fiche de ${conducteur}…` : "J'ouvre la fiche du conducteur…";
    }
    case "lister_affectations": {
      const cible = (await nomDe("vehicule", entree.vehicule_id)) ?? (await nomDe("conducteur", entree.conducteur_id));
      return cible ? `Je consulte le planning de ${cible}…` : "Je consulte le planning…";
    }
    case "conducteur_au_moment": {
      const plaque = await nomDe("vehicule", entree.vehicule_id);
      const moment = entree.date ? ` le ${depuisIso(entree.date)}${entree.heure ? ` à ${entree.heure}` : ""}` : "";
      return `Je cherche qui conduisait${plaque ? ` ${plaque}` : ""}${moment}…`;
    }
    case "lister_avis": {
      const numero = entree.numero?.trim() || (await nomDe("avis", entree.avis_id));
      if (numero) return `Je consulte l'avis n° ${numero}…`;
      if (entree.avis_id) return "Je consulte l'avis…";
      const cible = (await nomDe("vehicule", entree.vehicule_id)) ?? (await nomDe("conducteur", entree.conducteur_id));
      if (cible) return `Je consulte les avis de ${cible}…`;
      return entree.bloques_seulement ? "Je cherche les avis bloqués…" : "Je consulte les avis…";
    }
    case "proposer_modifications":
      return "Je prépare le récapitulatif…";
    default:
      return "Je consulte votre flotte…";
  }
}

// « Modifier » (phase 30).

/**
 * La note jointe à une demande envoyée par « Modifier » : les lignes du récapitulatif corrigé, motifs des lignes rouges
 * compris, et la consigne de le refaire en entier. Il ne s'applique plus : la demande l'a remplacé.
 */
export function noteCorrection(lignes: readonly LigneRecapitulatif[]): string {
  return [
    "Le gestionnaire a cliqué « Modifier » : sa demande corrige le récapitulatif que tu as proposé, qui ne s'appliquera plus. Ses lignes :",
    ...lignes.map((ligne, rang) => `${rang + 1}. ${texteLigne(ligne)}`),
    "Refais tout le récapitulatif avec proposer_modifications, en tenant compte de la correction, ou pose une question s'il manque une information.",
  ].join("\n");
}
