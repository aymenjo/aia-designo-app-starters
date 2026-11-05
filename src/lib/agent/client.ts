import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaManagedAgentsEventParams,
  BetaManagedAgentsSessionEvent,
  BetaManagedAgentsStreamSessionEvents,
} from "@anthropic-ai/sdk/resources/beta/sessions/events";
import { DUREE_MAX_DEMANDE_MS } from "./regles";

// Les appels à Claude Managed Agents (phase 26) : une session par conversation, des événements envoyés et reçus. Le client
// est injecté, comme ceux de Stripe et de Composio : les tests jouent un scénario d'événements, sans appeler l'API.

/** Un événement de la session, réduit à ce que Désigno en lit. */
export type EvenementSession =
  /** L'agent appelle un outil de Désigno : la session attend son résultat. */
  | { type: "outil"; id: string; nom: string; entree: unknown }
  /** Le résultat d'un outil, tel qu'il est parti. */
  | { type: "resultat"; outilId: string; contenu: string }
  /** Une demande du gestionnaire. */
  | { type: "demande"; id: string }
  /** Du texte de l'agent, et l'instant où il a été produit. */
  | { type: "message"; id: string; texte: string; le: string }
  /** La session attend les résultats de ces appels d'outil. */
  | { type: "attente"; ids: string[] }
  /** L'agent a fini son tour. */
  | { type: "fin" }
  /** Le tour n'aboutira pas : erreurs répétées, refus, ou session terminée. */
  | { type: "echec"; raison: string }
  | { type: "autre" };

/** Un événement envoyé à la session. */
export type EvenementEnvoye =
  /** Une demande du gestionnaire, avec le contexte du jour (date et heure de Paris). */
  | { type: "demande"; texte: string; contexte: string }
  | { type: "resultat"; outilId: string; contenu: string; erreur: boolean }
  | { type: "interruption" };

export type StatutSession = "idle" | "running" | "rescheduling" | "terminated";

export type ClientAgent = {
  /** Crée une session de l'agent ; les métadonnées ne portent que l'id de l'entreprise. Renvoie son id (sesn_…). */
  creerSession(metadonnees: Record<string, string>): Promise<string>;
  /** Efface la session et ses événements chez Anthropic ; une session déjà effacée ne lève rien. */
  effacerSession(sessionId: string): Promise<void>;
  statut(sessionId: string): Promise<StatutSession>;
  envoyer(sessionId: string, evenements: EvenementEnvoye[]): Promise<void>;
  /** Ouvre le flux des événements à venir : à ouvrir avant d'envoyer, pour n'en manquer aucun. */
  ecouter(sessionId: string, signal: AbortSignal): Promise<AsyncIterable<EvenementSession>>;
  /** Tous les événements passés de la session, dans l'ordre. */
  historique(sessionId: string): Promise<EvenementSession[]>;
};

type EvenementSdk = BetaManagedAgentsSessionEvent | BetaManagedAgentsStreamSessionEvents;

function texte(contenu: readonly { type: string; text?: string }[] | undefined) {
  return (contenu ?? []).map((bloc) => (bloc.type === "text" ? (bloc.text ?? "") : "")).join("");
}

export function normaliser(evenement: EvenementSdk): EvenementSession {
  switch (evenement.type) {
    case "agent.custom_tool_use":
      return { type: "outil", id: evenement.id, nom: evenement.name, entree: evenement.input };
    case "user.custom_tool_result":
      return { type: "resultat", outilId: evenement.custom_tool_use_id, contenu: texte(evenement.content) };
    case "user.message":
      return { type: "demande", id: evenement.id };
    case "agent.message":
      return { type: "message", id: evenement.id, texte: texte(evenement.content), le: evenement.processed_at };
    case "session.status_idle":
      if (evenement.stop_reason.type === "requires_action") return { type: "attente", ids: evenement.stop_reason.event_ids };
      if (evenement.stop_reason.type === "end_turn") return { type: "fin" };
      return { type: "echec", raison: evenement.stop_reason.type };
    case "session.status_terminated":
      return { type: "echec", raison: "terminated" };
    default:
      return { type: "autre" };
  }
}

function versSdk(evenement: EvenementEnvoye): BetaManagedAgentsEventParams[] {
  switch (evenement.type) {
    case "demande":
      // Le contexte du jour suit la demande, comme un message système de ce tour : le SDK veut qu'il soit le dernier.
      return [
        { type: "user.message" as const, content: [{ type: "text" as const, text: evenement.texte }] },
        { type: "system.message" as const, content: [{ type: "text" as const, text: evenement.contexte }] },
      ];
    case "resultat":
      return [
        {
          type: "user.custom_tool_result" as const,
          custom_tool_use_id: evenement.outilId,
          content: [{ type: "text" as const, text: evenement.contenu }],
          is_error: evenement.erreur,
        },
      ];
    case "interruption":
      return [{ type: "user.interrupt" as const }];
  }
}

function clientAgent(anthropic: Anthropic, agentId: string, environnementId: string): ClientAgent {
  const sessions = anthropic.beta.sessions;
  return {
    async creerSession(metadonnees) {
      const session = await sessions.create({
        agent: agentId,
        environment_id: environnementId,
        title: "Demande à Désigno",
        metadata: metadonnees,
      });
      return session.id;
    },

    async effacerSession(sessionId) {
      try {
        await sessions.delete(sessionId);
      } catch (erreur) {
        if (!(erreur instanceof Anthropic.NotFoundError)) throw erreur;
      }
    },

    async statut(sessionId) {
      return (await sessions.retrieve(sessionId)).status;
    },

    async envoyer(sessionId, evenements) {
      await sessions.events.send(sessionId, { events: evenements.flatMap(versSdk) });
    },

    async ecouter(sessionId, signal) {
      const flux = await sessions.events.stream(sessionId, {}, { signal, timeout: DUREE_MAX_DEMANDE_MS + 30_000 });
      return (async function* () {
        for await (const evenement of flux) yield normaliser(evenement);
      })();
    },

    async historique(sessionId) {
      const evenements: EvenementSession[] = [];
      for await (const evenement of sessions.events.list(sessionId)) evenements.push(normaliser(evenement));
      return evenements;
    },
  };
}

/**
 * Le client de Demande à Désigno, ou `null` sans clé d'API, sans agent ou sans environnement (`npm run agent:config`) :
 * la fonction est alors indisponible.
 */
export function clientAgentConfigure(): ClientAgent | null {
  const cle = process.env.ANTHROPIC_API_KEY;
  const agentId = process.env.ANTHROPIC_AGENT_ID;
  const environnementId = process.env.ANTHROPIC_ENVIRONMENT_ID;
  if (!cle || !agentId || !environnementId) return null;
  return clientAgent(new Anthropic({ apiKey: cle, maxRetries: 2, timeout: 30_000 }), agentId, environnementId);
}
