import type { Plan } from "@/lib/abonnement/plans";
import { ajouterJours, depuisIso } from "@/lib/dates";

// Les règles des rappels Google Calendar (phase 22) et leurs messages, définis une seule fois : la synchronisation, les
// écrans et le script Composio les reprennent. Sans appel réseau, pour se tester seul, et sans module Node : les écrans
// l'importent.

/**
 * Les seules permissions demandées à Google : les agendas que Désigno a créés, et l'adresse du compte pour l'écran.
 * Désigno ne lit ni ne modifie aucun autre agenda.
 */
export const SCOPES_AGENDA = [
  "https://www.googleapis.com/auth/calendar.app.created",
  "https://www.googleapis.com/auth/userinfo.email",
] as const;

/** Le nom de l'agenda créé dans le compte Google. */
export const NOM_AGENDA = "Désigno";

/** Le rappel tombe à J-2 de l'échéance, comme la dernière alerte email, même si ce jour est passé. */
export function jourRappel(echeance: string): string {
  return ajouterJours(echeance, -2);
}

type AvisRappel = { numero: string | null; plaque: string | null; echeance: string };

/** « Désigner – AB-123-CD – avant le 18/11 ». Sans plaque, le n° d'avis ; sans l'un ni l'autre, « avis sans plaque ». */
export function titreEvenement({ numero, plaque, echeance }: AvisRappel): string {
  const objet = plaque ?? (numero ? `avis n° ${numero}` : "avis sans plaque");
  return `Désigner – ${objet} – avant le ${depuisIso(echeance).slice(0, 5)}`;
}

/** La date complète, puis le lien vers l'avis. Aucune donnée de conducteur : l'agenda peut être partagé. */
export function descriptionEvenement({ echeance, lien }: { echeance: string; lien: string }): string {
  return `À désigner sur l'ANTAI avant le ${depuisIso(echeance)}.\n\n${lien}`;
}

/**
 * L'id de l'événement chez Google, tiré de l'id de l'avis : deux synchronisations qui se croisent visent le même
 * événement, et la seconde le met à jour au lieu d'en créer un autre. Google accepte les caractères de base32hex
 * (0-9, a-v) : un uuid sans ses tirets n'en utilise qu'une partie.
 */
export function idEvenement(avisId: string): string {
  return avisId.replaceAll("-", "").toLowerCase();
}

/** Un événement tel qu'il doit être dans l'agenda, pour un avis ouvert qui a une échéance. */
export type EvenementVoulu = { avisId: string; jour: string; titre: string; description: string };

/** Un événement posé par une synchronisation précédente, tel que Google l'a reçu (`evenement_agenda`). */
export type EvenementPose = { agenda_id: string; avis_id: string; jour: string; titre: string };

export type PlanSynchro = {
  /** À créer, ou à mettre à jour : l'avis n'a pas d'événement, ou son jour ou son titre a changé. */
  aPoser: EvenementVoulu[];
  /** Les avis dont l'événement est à retirer de l'agenda. */
  aRetirer: string[];
  /** Des lignes d'un ancien agenda (une reconnexion sur un autre compte) : à effacer, sans appeler Google. */
  aOublier: EvenementPose[];
};

/**
 * Compare les événements voulus à ceux qui sont posés dans l'agenda actuel. En Pro, chaque avis ouvert a son événement,
 * et ceux des avis désignés, classés ou disparus sont retirés. En Free, rien n'est créé ni déplacé, mais un événement
 * devenu faux (avis clos, échéance ou titre changés) est retiré : l'agenda ne dit jamais rien d'inexact.
 */
export function planifierSynchro({
  voulus,
  poses,
  agendaId,
  plan,
}: {
  voulus: EvenementVoulu[];
  poses: EvenementPose[];
  agendaId: string;
  plan: Plan;
}): PlanSynchro {
  const aOublier = poses.filter(({ agenda_id }) => agenda_id !== agendaId);
  const posesIci = new Map(poses.filter(({ agenda_id }) => agenda_id === agendaId).map((pose) => [pose.avis_id, pose]));
  const voulusParAvis = new Map(voulus.map((voulu) => [voulu.avisId, voulu]));
  const juste = (voulu: EvenementVoulu | undefined, pose: EvenementPose) =>
    voulu !== undefined && voulu.jour === pose.jour && voulu.titre === pose.titre;

  const aRetirer = [...posesIci.values()]
    .filter((pose) => {
      const voulu = voulusParAvis.get(pose.avis_id);
      // En Pro, un événement faux est mis à jour ; en Free, il est retiré.
      return plan === "pro" ? !voulu : !juste(voulu, pose);
    })
    .map(({ avis_id }) => avis_id);
  const aPoser =
    plan === "pro"
      ? voulus.filter((voulu) => {
          const pose = posesIci.get(voulu.avisId);
          return !pose || !juste(voulu, pose);
        })
      : [];
  return { aPoser, aRetirer, aOublier };
}

// Écrans

// Espace insécable avant les deux-points : ils ne passent jamais seuls en début de ligne.
export const MESSAGES_AGENDA = {
  agendaCree: `Désigno crée dans votre compte Google un agenda « ${NOM_AGENDA} », et ne voit que lui.`,
  rappel: "Chaque avis ouvert y a un événement à J-2 de son échéance, avec le lien vers l'avis.",
  aucunAutre: "Vos autres agendas ne sont ni lus ni modifiés.",
  pause:
    `En Free, aucun rappel n'est ajouté ni déplacé dans l'agenda « ${NOM_AGENDA} », et ceux devenus faux sont retirés. ` +
    "Les rappels reprennent seuls au passage en Pro.",
  interrompus:
    `Les rappels sont interrompus : Google refuse l'accès à l'agenda « ${NOM_AGENDA} », ou il a été supprimé. ` +
    "Reconnectez Google Calendar pour les reprendre. Les alertes par email continuent.",
  deconnexion: `L'agenda « ${NOM_AGENDA} » et ses événements seront supprimés de votre compte Google, et son accès révoqué.`,

  connecte: `Google Calendar est connecté : l'agenda « ${NOM_AGENDA} » reçoit les rappels de vos avis ouverts.`,
  reconnecte: "Google Calendar est reconnecté, et les rappels ont repris.",

  fonctionPro: "Les rappels Google Calendar sont une fonction Pro.",
  indisponible: "Les rappels Google Calendar sont indisponibles pour le moment. Réessayez dans quelques minutes.",
  connexionRefusee: "La connexion à Google Calendar n'a pas abouti. Réessayez.",
  compteInconnu: "Ce compte Google n'a pas été connecté depuis Désigno. Réessayez.",
} as const;

/** Les messages que l'adresse de l'écran Intégrations peut désigner après le retour de Google. */
export type CleMessageAgenda = keyof typeof MESSAGES_AGENDA;

export function estCleMessageAgenda(cle: unknown): cle is CleMessageAgenda {
  return typeof cle === "string" && Object.hasOwn(MESSAGES_AGENDA, cle);
}
