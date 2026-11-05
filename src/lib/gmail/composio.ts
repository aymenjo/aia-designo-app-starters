import { Composio } from "@composio/core";
import { DECLENCHEUR_GMAIL, INTERVALLE_RELEVE_MINUTES } from "./regles";

// Les appels à Composio (phase 23) : la connexion de la boîte Gmail, son déclencheur, et les lectures de l'API Gmail par
// le proxy de Composio. Le client est injecté, comme celui de Stripe et le lecteur des avis : les tests n'appellent jamais
// Composio. L'utilisateur Composio d'une boîte est l'id de son entreprise. Toutes les requêtes Gmail sont des GET, et le
// scope de l'auth config (gmail.readonly) interdit tout le reste : Désigno ne peut rien envoyer depuis la boîte.

export type LibelleGmail = { id: string; nom: string };
export type StatutCompte = "INITIALIZING" | "INITIATED" | "ACTIVE" | "FAILED" | "EXPIRED" | "INACTIVE" | "REVOKED";

/** Google refuse l'accès à la boîte : le compte connecté a expiré, ou l'accès a été retiré. La relève est interrompue. */
export class AccesGmailRefuse extends Error {
  constructor(detail: string) {
    super(`accès Gmail refusé : ${detail}`);
  }
}

export type ClientComposio = {
  /** Le lien de connexion de Composio : Google demande l'accès, puis revient sur `urlRetour`. */
  lienConnexion(entrepriseId: string, urlRetour: string): Promise<string>;
  /** Le statut du compte, s'il a été connecté pour cette entreprise ; `null` sinon (un id venu d'ailleurs). */
  statutCompte(entrepriseId: string, compteId: string): Promise<StatutCompte | null>;
  /** L'adresse de la boîte. */
  adresse(compteId: string): Promise<string>;
  /** Les libellés créés par le gestionnaire, sans ceux de Gmail (Boîte de réception, Spam…). */
  libelles(compteId: string): Promise<LibelleGmail[]>;
  /** Crée le déclencheur de la relève sur ce libellé ; renvoie son id (`ti_…`). */
  creerDeclencheur(entrepriseId: string, compteId: string, libelleId: string): Promise<string>;
  /** Supprime un déclencheur ; un déclencheur déjà supprimé ne lève rien. */
  supprimerDeclencheur(id: string): Promise<void>;
  /** Supprime le compte connecté, ce qui révoque l'accès ; un compte déjà supprimé ne lève rien. */
  supprimerCompte(id: string): Promise<void>;
  /** Télécharge une pièce jointe. Lève `AccesGmailRefuse` si Google refuse l'accès. */
  pieceJointe(compteId: string, messageId: string, pieceJointeId: string): Promise<Buffer>;
};

const API_GMAIL = "https://gmail.googleapis.com/gmail/v1";

/** Une erreur du SDK pour une ressource absente : la suppression est déjà faite. L'agenda (phase 22) s'en sert aussi. */
export function estIntrouvable(erreur: unknown): boolean {
  for (let e: unknown = erreur; e instanceof Error; e = e.cause) {
    if ("status" in e && e.status === 404) return true;
    if (e.name.includes("NotFound")) return true;
  }
  return false;
}

function clientComposio(composio: Composio, authConfig: string): ClientComposio {
  async function gmail<T>(compteId: string, chemin: string): Promise<T> {
    const { status, data } = await composio.tools.proxyExecute({
      endpoint: `${API_GMAIL}${chemin}`,
      method: "GET",
      connectedAccountId: compteId,
    });
    if (status === 401 || status === 403) throw new AccesGmailRefuse(`${status} sur ${chemin}`);
    if (status >= 300) throw new Error(`Gmail ${chemin} : ${status}`);
    return data as T;
  }

  async function supprimer(supprimer: () => Promise<unknown>) {
    try {
      await supprimer();
    } catch (erreur) {
      if (!estIntrouvable(erreur)) throw erreur;
    }
  }

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
      const { emailAddress } = await gmail<{ emailAddress: string }>(compteId, "/users/me/profile");
      return emailAddress;
    },

    async libelles(compteId) {
      const { labels = [] } = await gmail<{ labels?: { id: string; name: string; type?: string }[] }>(
        compteId,
        "/users/me/labels",
      );
      return labels
        .filter(({ type }) => type === "user")
        .map(({ id, name }) => ({ id, nom: name }))
        .sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
    },

    async creerDeclencheur(entrepriseId, compteId, libelleId) {
      const { triggerId } = await composio.triggers.create(entrepriseId, DECLENCHEUR_GMAIL, {
        connectedAccountId: compteId,
        triggerConfig: { labelIds: libelleId, userId: "me", interval: INTERVALLE_RELEVE_MINUTES },
      });
      return triggerId;
    },

    async supprimerDeclencheur(id) {
      await supprimer(() => composio.triggers.delete(id));
    },

    async supprimerCompte(id) {
      await supprimer(() => composio.connectedAccounts.delete(id));
    },

    async pieceJointe(compteId, messageId, pieceJointeId) {
      const { data } = await gmail<{ data: string }>(
        compteId,
        `/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(pieceJointeId)}`,
      );
      return Buffer.from(data, "base64url");
    },
  };
}

/**
 * Le client Composio de l'application, ou `null` sans clé de projet ni auth config Gmail : la relève est alors
 * indisponible, et le webhook répond 503 à un email qui a une pièce jointe.
 */
export function clientComposioConfigure(): ClientComposio | null {
  const cle = process.env.COMPOSIO_API_KEY;
  const authConfig = process.env.COMPOSIO_AUTH_CONFIG_GMAIL;
  if (!cle || !authConfig) return null;
  return clientComposio(new Composio({ apiKey: cle, allowTracking: false, disableVersionCheck: true }), authConfig);
}
