import { z } from "zod";

// Règles de connexion et leurs messages, définis une seule fois côté serveur.

export const DUREE_SESSION_JOURS = 30;
export const DUREE_SESSION_S = DUREE_SESSION_JOURS * 24 * 60 * 60;

export const PAGE_APRES_CONNEXION = "/tableau-de-bord";

// Posés à la demande d'un lien, pour renvoyer un lien en un clic depuis
// /connexion/lien-invalide et revenir sur la page demandée après connexion.
export const COOKIE_EMAIL = "designo_email";
export const COOKIE_SUIVANT = "designo_suivant";
export const DUREE_COOKIES_DEMANDE_S = 24 * 60 * 60;

export const MESSAGES = {
  emailVide: "Saisissez votre adresse email.",
  emailInvalide: "Cette adresse email n'est pas valide.",
  tropDeDemandes: "Patientez une minute avant de redemander un lien.",
  envoiImpossible: "Le lien n'a pas pu être envoyé. Réessayez dans un instant.",
  sessionExpiree: "Votre session a expiré. Recevez un nouveau lien pour vous reconnecter.",
} as const;

export const schemaEmail = z
  .string({ error: MESSAGES.emailVide })
  .trim()
  .toLowerCase()
  .min(1, { error: MESSAGES.emailVide })
  .pipe(z.email({ error: MESSAGES.emailInvalide }));

type MethodeAuth = { method: string; timestamp: number } | string;

/**
 * La session dure 30 jours après la connexion, rafraîchissements compris.
 * `amr` vient du JWT : son horodatage (en secondes) est celui de la connexion.
 * Sans horodatage, on considère la session expirée.
 */
export function connexionExpiree(amr: readonly MethodeAuth[] | undefined, maintenant = new Date()) {
  const horodatages = (amr ?? []).flatMap((m) => (typeof m === "string" ? [] : [m.timestamp]));
  if (!horodatages.length) return true;
  const connexionLe = Math.min(...horodatages);
  return maintenant.getTime() / 1000 - connexionLe >= DUREE_SESSION_S;
}

/** N'accepte que les chemins internes à l'application, contre les redirections ouvertes. */
export function cheminSuivantSur(suivant: string | null | undefined, defaut = PAGE_APRES_CONNEXION) {
  if (!suivant || !suivant.startsWith("/") || suivant.startsWith("//") || suivant.includes("\\")) {
    return defaut;
  }
  const origine = "http://designo.invalid";
  const url = new URL(suivant, origine);
  if (url.origin !== origine) return defaut;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** « camille@exemple.fr » → « c…@exemple.fr » */
export function masquerEmail(email: string) {
  const [local, domaine] = email.split("@");
  if (!local || !domaine) return email;
  return `${local[0]}…@${domaine}`;
}
