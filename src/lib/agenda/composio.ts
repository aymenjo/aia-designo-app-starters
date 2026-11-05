import { Composio } from "@composio/core";
import { ajouterJours } from "@/lib/dates";
import { estIntrouvable, type StatutCompte } from "@/lib/gmail/composio";
import { NOM_AGENDA } from "./regles";

// Les appels à Composio pour les rappels Google Calendar (phase 22) : la connexion du compte Google, puis l'API Calendar
// par le proxy de Composio. Le client est injecté, comme celui de Gmail : les tests n'appellent jamais Composio. Le scope
// de l'auth config (calendar.app.created) ne donne accès qu'aux agendas créés par l'app : Désigno ne voit que le sien.

/**
 * Google refuse l'accès à l'agenda : le compte connecté a expiré, l'accès a été retiré, ou l'agenda « Désigno » a été
 * supprimé. Les rappels sont interrompus jusqu'à la reconnexion.
 */
export class AccesAgendaRefuse extends Error {
  constructor(detail: string) {
    super(`accès à l'agenda refusé : ${detail}`);
  }
}

/** Un événement sur la journée : `jour` en ISO, l'id tiré de celui de l'avis (`idEvenement`). */
export type EvenementAgenda = { id: string; jour: string; titre: string; description: string };

export type ClientAgenda = {
  /** Le lien de connexion de Composio : Google demande l'accès, puis revient sur `urlRetour`. */
  lienConnexion(entrepriseId: string, urlRetour: string): Promise<string>;
  /** Le statut du compte, s'il a été connecté pour cette entreprise ; `null` sinon (un id venu d'ailleurs). */
  statutCompte(entrepriseId: string, compteId: string): Promise<StatutCompte | null>;
  /** L'adresse du compte Google. */
  adresse(compteId: string): Promise<string>;
  /** L'agenda existe encore et ce compte y a accès : une reconnexion le réutilise. */
  agendaExiste(compteId: string, agendaId: string): Promise<boolean>;
  /** Crée l'agenda « Désigno », à l'heure de Paris ; renvoie son id. */
  creerAgenda(compteId: string): Promise<string>;
  /** Supprime l'agenda et ses événements ; un agenda déjà supprimé ne lève rien. */
  supprimerAgenda(compteId: string, agendaId: string): Promise<void>;
  /** Crée l'événement, ou le met à jour s'il existe déjà, même supprimé. */
  poserEvenement(compteId: string, agendaId: string, evenement: EvenementAgenda): Promise<void>;
  /** Retire l'événement ; un événement déjà retiré ne lève rien. */
  retirerEvenement(compteId: string, agendaId: string, evenementId: string): Promise<void>;
  /** Supprime le compte connecté, ce qui révoque l'accès ; un compte déjà supprimé ne lève rien. */
  supprimerCompte(id: string): Promise<void>;
};

const API_AGENDA = "https://www.googleapis.com/calendar/v3";
// Même domaine que l'API Calendar : le proxy de Composio l'appelle tel quel, avec le jeton du compte.
const INFOS_COMPTE = "https://www.googleapis.com/oauth2/v2/userinfo";

type Methode = "GET" | "POST" | "PATCH" | "DELETE";

/** Un 403 de quota (trop de requêtes) n'est pas un refus d'accès : la synchronisation suivante réessaiera. */
function estLimite(data: unknown): boolean {
  const erreur = (data as { error?: { status?: string; errors?: { reason?: string }[] } } | null)?.error;
  return (
    erreur?.status === "RESOURCE_EXHAUSTED" ||
    (erreur?.errors ?? []).some(({ reason }) => reason === "quotaExceeded" || /rateLimitExceeded$/i.test(reason ?? ""))
  );
}

function clientAgenda(composio: Composio, authConfig: string): ClientAgenda {
  async function google(compteId: string, method: Methode, chemin: string, body?: unknown) {
    const { status, data } = await composio.tools.proxyExecute({
      endpoint: chemin.startsWith("https://") ? chemin : `${API_AGENDA}${chemin}`,
      method,
      connectedAccountId: compteId,
      ...(body !== undefined && { body }),
    });
    if (status === 401 || (status === 403 && !estLimite(data))) {
      throw new AccesAgendaRefuse(`${status} sur ${method} ${chemin}`);
    }
    return { status, data };
  }

  const echec = (method: Methode, chemin: string, status: number) =>
    new Error(`Google Calendar ${method} ${chemin} : ${status}`);
  const agenda = (agendaId: string) => `/calendars/${encodeURIComponent(agendaId)}`;

  return {
    async lienConnexion(entrepriseId, urlRetour) {
      const demande = await composio.connectedAccounts.link(entrepriseId, authConfig, { callbackUrl: urlRetour });
      if (!demande.redirectUrl) throw new Error("lien de connexion Composio sans adresse");
      return demande.redirectUrl;
    },

    async statutCompte(entrepriseId, compteId) {
      const { items } = await composio.connectedAccounts.list({
        userIds: [entrepriseId],
        authConfigIds: [authConfig],
        limit: 100,
      });
      return items.find(({ id }) => id === compteId)?.status ?? null;
    },

    async adresse(compteId) {
      const { status, data } = await google(compteId, "GET", INFOS_COMPTE);
      if (status >= 300) throw echec("GET", INFOS_COMPTE, status);
      return (data as { email: string }).email;
    },

    async agendaExiste(compteId, agendaId) {
      const { status } = await google(compteId, "GET", agenda(agendaId));
      if (status === 404 || status === 410) return false;
      if (status >= 300) throw echec("GET", agenda(agendaId), status);
      return true;
    },

    async creerAgenda(compteId) {
      const { status, data } = await google(compteId, "POST", "/calendars", {
        summary: NOM_AGENDA,
        description: "Les rappels des échéances de désignation, à J-2. Créé et tenu à jour par Désigno.",
        timeZone: "Europe/Paris",
      });
      if (status >= 300) throw echec("POST", "/calendars", status);
      return (data as { id: string }).id;
    },

    async supprimerAgenda(compteId, agendaId) {
      const { status } = await google(compteId, "DELETE", agenda(agendaId));
      if (status >= 300 && status !== 404 && status !== 410) throw echec("DELETE", agenda(agendaId), status);
    },

    async poserEvenement(compteId, agendaId, { id, jour, titre, description }) {
      const contenu = {
        summary: titre,
        description,
        // Sur la journée : la fin est le lendemain, exclue.
        start: { date: jour },
        end: { date: ajouterJours(jour, 1) },
        // Le rappel n'occupe pas la journée, et garde les notifications par défaut de l'agenda.
        transparency: "transparent",
        reminders: { useDefault: true },
      };
      const chemin = `${agenda(agendaId)}/events`;
      const creation = await google(compteId, "POST", chemin, { id, ...contenu });
      if (creation.status === 404) throw new AccesAgendaRefuse(`agenda introuvable (${agendaId})`);
      if (creation.status < 300) return;
      // L'id existe déjà : l'événement est mis à jour, et rétabli s'il avait été retiré (un avis rouvert).
      if (creation.status !== 409) throw echec("POST", chemin, creation.status);
      const cheminEvenement = `${chemin}/${encodeURIComponent(id)}`;
      const miseAJour = await google(compteId, "PATCH", cheminEvenement, { ...contenu, status: "confirmed" });
      if (miseAJour.status === 404) throw new AccesAgendaRefuse(`agenda introuvable (${agendaId})`);
      if (miseAJour.status >= 300) throw echec("PATCH", cheminEvenement, miseAJour.status);
    },

    async retirerEvenement(compteId, agendaId, evenementId) {
      const chemin = `${agenda(agendaId)}/events/${encodeURIComponent(evenementId)}`;
      const { status } = await google(compteId, "DELETE", chemin);
      if (status >= 300 && status !== 404 && status !== 410) throw echec("DELETE", chemin, status);
    },

    async supprimerCompte(id) {
      try {
        await composio.connectedAccounts.delete(id);
      } catch (erreur) {
        if (!estIntrouvable(erreur)) throw erreur;
      }
    },
  };
}

/**
 * Le client des rappels Google Calendar, ou `null` sans clé de projet Composio ni auth config de l'agenda : les rappels
 * sont alors indisponibles, et aucune synchronisation n'est lancée.
 */
export function clientAgendaConfigure(): ClientAgenda | null {
  const cle = process.env.COMPOSIO_API_KEY;
  const authConfig = process.env.COMPOSIO_AUTH_CONFIG_AGENDA;
  if (!cle || !authConfig) return null;
  return clientAgenda(new Composio({ apiKey: cle, allowTracking: false, disableVersionCheck: true }), authConfig);
}
