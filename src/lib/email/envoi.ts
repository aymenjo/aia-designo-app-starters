import { Resend } from "resend";

// Les emails envoyés par l'application elle-même : alertes (phase 14), factures (phase 18), échec de paiement (phase 19),
// email au conducteur (phase 21), relève Gmail (phase 23), puis rapport mensuel. Le lien de connexion, lui, part par le
// SMTP de Supabase. L'envoyeur est injecté : les tests n'envoient jamais rien, et le développement écrit dans Mailpit.

/** L'expéditeur, le même que celui du lien de connexion (`supabase/config.toml`). À changer avec le domaine vérifié. */
export const EXPEDITEUR = { nom: "Désigno", email: "onboarding@resend.dev" };

export type PieceJointe = { nom: string; contenu: Buffer; type: string };

export type Email = {
  /** Une adresse, ou plusieurs : la direction, pour le rapport mensuel. */
  a: string | string[];
  /** Les adresses en copie : le gestionnaire, pour le rapport mensuel. */
  cc?: string[];
  sujet: string;
  html: string;
  texte: string;
  /** Le nom affiché de l'expéditeur, « Plomberie Martin SARL via Désigno » : `EXPEDITEUR.nom` par défaut. */
  expediteur?: string;
  /** L'adresse où vont les réponses : celle du gestionnaire, pour l'email au conducteur. */
  repondreA?: string;
  /** Un même envoi, rejoué dans les 24 h avec cette clé, ne part qu'une fois (Resend seulement). */
  cleIdempotence?: string;
  /** Le PDF du rapport mensuel. */
  piecesJointes?: PieceJointe[];
};

/** Envoie un email, ou lève une erreur s'il n'est pas parti. */
export type Envoyeur = (email: Email) => Promise<void>;

/** Le nom affiché, sans les caractères qui casseraient l'en-tête `From` : une raison sociale reste du texte libre. */
export function nomExpediteur(nom: string | undefined) {
  const propre = (nom ?? "").replace(/["<>\\]/g, "").replace(/\s+/g, " ").trim();
  return propre || EXPEDITEUR.nom;
}

function envoyeurResend(cle: string): Envoyeur {
  const resend = new Resend(cle);
  return async ({ a, cc, sujet, html, texte, expediteur, repondreA, cleIdempotence, piecesJointes }) => {
    const { error } = await resend.emails.send(
      {
        from: `${nomExpediteur(expediteur)} <${EXPEDITEUR.email}>`,
        to: a,
        ...(cc?.length && { cc }),
        subject: sujet,
        html,
        text: texte,
        ...(repondreA && { replyTo: repondreA }),
        ...(piecesJointes?.length && {
          attachments: piecesJointes.map(({ nom, contenu, type }) => ({
            filename: nom,
            content: contenu.toString("base64"),
            contentType: type,
          })),
        }),
      },
      cleIdempotence ? { idempotencyKey: cleIdempotence } : undefined,
    );
    if (error) throw new Error(`Resend : ${error.name} : ${error.message}`);
  };
}

/** L'API HTTP de Mailpit, qui reçoit déjà les liens de connexion du Supabase local. */
function envoyeurMailpit(url: string): Envoyeur {
  return async ({ a, cc, sujet, html, texte, expediteur, repondreA, piecesJointes }) => {
    const reponse = await fetch(`${url}/api/v1/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        From: { Email: EXPEDITEUR.email, Name: nomExpediteur(expediteur) },
        To: [a].flat().map((Email) => ({ Email })),
        ...(cc?.length && { Cc: cc.map((Email) => ({ Email })) }),
        ...(repondreA && { ReplyTo: [{ Email: repondreA }] }),
        Subject: sujet,
        HTML: html,
        Text: texte,
        ...(piecesJointes?.length && {
          Attachments: piecesJointes.map(({ nom, contenu, type }) => ({
            Filename: nom,
            ContentType: type,
            Content: contenu.toString("base64"),
          })),
        }),
      }),
    });
    if (!reponse.ok) throw new Error(`Mailpit : ${reponse.status} ${await reponse.text()}`);
  };
}

/**
 * L'envoyeur de l'application : Resend avec une clé d'API (production), sinon Mailpit (Supabase local), sinon `null`.
 */
export function envoyeurConfigure(): Envoyeur | null {
  if (process.env.RESEND_API_KEY) return envoyeurResend(process.env.RESEND_API_KEY);
  if (process.env.MAILPIT_URL) return envoyeurMailpit(process.env.MAILPIT_URL.replace(/\/+$/, ""));
  return null;
}
