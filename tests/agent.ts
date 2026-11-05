import type { ClientAgent, EvenementEnvoye, EvenementSession, StatutSession } from "@/lib/agent/client";

// Un faux Claude Managed Agents pour les tests de Demande à Désigno (phase 26) : la CI n'appelle jamais l'API. Chaque
// envoi à la session passe par un scénario, qui renvoie les événements que la session émettrait ensuite ; ils arrivent
// sur le flux ouvert, et s'ajoutent à l'historique.

export type Scenario = (envoyes: EvenementEnvoye[], session: FausseSession) => EvenementSession[];

export type FausseSession = { id: string; metadonnees: Record<string, string>; historique: EvenementSession[]; statut: StatutSession };

let compteur = 0;
/** Un id d'événement unique : « sevt_… ». */
export function idEvenement() {
  compteur += 1;
  return `sevt_test_${Date.now()}_${compteur}`;
}

/** Un canal : ce qui est poussé ressort, dans l'ordre, jusqu'à l'abandon. */
function canal(signal: AbortSignal) {
  const file: EvenementSession[] = [];
  let reveil: (() => void) | null = null;
  signal.addEventListener("abort", () => reveil?.());
  return {
    pousser(evenements: EvenementSession[]) {
      file.push(...evenements);
      reveil?.();
    },
    async *[Symbol.asyncIterator]() {
      for (;;) {
        while (file.length) yield file.shift()!;
        if (signal.aborted) throw new DOMException("Flux abandonné", "AbortError");
        await new Promise<void>((suite) => (reveil = suite));
        reveil = null;
      }
    },
  };
}

export function fauxAgent(scenario: Scenario = () => [{ type: "fin" }]) {
  const sessions = new Map<string, FausseSession>();
  const flux = new Map<string, ReturnType<typeof canal>>();
  const envois: { sessionId: string; evenements: EvenementEnvoye[] }[] = [];
  const effacees: string[] = [];
  const echecsEffacement = new Set<string>();

  const client: ClientAgent = {
    async creerSession(metadonnees) {
      const id = `sesn_test_${Date.now()}_${(compteur += 1)}`;
      sessions.set(id, { id, metadonnees, historique: [], statut: "idle" });
      return id;
    },
    async effacerSession(sessionId) {
      if (echecsEffacement.has(sessionId)) throw new Error("Anthropic en panne");
      effacees.push(sessionId);
      sessions.delete(sessionId);
    },
    async statut(sessionId) {
      return sessions.get(sessionId)?.statut ?? "terminated";
    },
    async envoyer(sessionId, evenements) {
      const session = sessions.get(sessionId);
      if (!session) throw new Error(`session inconnue : ${sessionId}`);
      envois.push({ sessionId, evenements });
      // Comme l'API, le flux renvoie l'écho de ce qui est envoyé, puis ce que la session en fait.
      const echos = evenements.flatMap((evenement): EvenementSession[] => {
        if (evenement.type === "demande") return [{ type: "demande", id: idEvenement() }];
        if (evenement.type === "resultat") return [{ type: "resultat", outilId: evenement.outilId, contenu: evenement.contenu }];
        return [];
      });
      session.historique.push(...echos);
      const emis = scenario(evenements, session);
      session.historique.push(...emis);
      flux.get(sessionId)?.pousser([...echos, ...emis]);
    },
    async ecouter(sessionId, signal) {
      const ouvert = canal(signal);
      flux.set(sessionId, ouvert);
      return ouvert;
    },
    async historique(sessionId) {
      return [...(sessions.get(sessionId)?.historique ?? [])];
    },
  };

  return {
    client,
    sessions,
    envois,
    effacees,
    /** Une session existante chez le faux Anthropic, avec son historique : celle d'une conversation semée. */
    ajouterSession(id: string, historique: EvenementSession[] = [], statut: StatutSession = "idle") {
      sessions.set(id, { id, metadonnees: {}, historique, statut });
    },
    /** L'effacement de cette session échouera. */
    echouerEffacement(id: string) {
      echecsEffacement.add(id);
    },
  };
}

/** Un message de l'agent, produit maintenant. */
export function messageAgent(texte: string, le = new Date().toISOString()): EvenementSession {
  return { type: "message", id: idEvenement(), texte, le };
}
