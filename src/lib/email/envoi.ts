import { Resend } from "resend";

// Les emails envoyés par l'application elle-même : alertes (phase 14), puis échec de paiement, email au conducteur,
// relève Gmail et rapport mensuel. Le lien de connexion, lui, part par le SMTP de Supabase.
// L'envoyeur est injecté : les tests n'envoient jamais rien, et le développement écrit dans Mailpit.

/** L'expéditeur, le même que celui du lien de connexion (`supabase/config.toml`). À changer avec le domaine vérifié. */
export const EXPEDITEUR = { nom: "Désigno", email: "onboarding@resend.dev" };

export type Email = {
  a: string;
  sujet: string;
  html: string;
  texte: string;
  /** Un même envoi, rejoué dans les 24 h avec cette clé, ne part qu'une fois (Resend seulement). */
  cleIdempotence?: string;
};

/** Envoie un email, ou lève une erreur s'il n'est pas parti. */
export type Envoyeur = (email: Email) => Promise<void>;

function envoyeurResend(cle: string): Envoyeur {
  const resend = new Resend(cle);
  return async ({ a, sujet, html, texte, cleIdempotence }) => {
    const { error } = await resend.emails.send(
      { from: `${EXPEDITEUR.nom} <${EXPEDITEUR.email}>`, to: a, subject: sujet, html, text: texte },
      cleIdempotence ? { idempotencyKey: cleIdempotence } : undefined,
    );
    if (error) throw new Error(`Resend : ${error.name} : ${error.message}`);
  };
}

/** L'API HTTP de Mailpit, qui reçoit déjà les liens de connexion du Supabase local. */
function envoyeurMailpit(url: string): Envoyeur {
  return async ({ a, sujet, html, texte }) => {
    const reponse = await fetch(`${url}/api/v1/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        From: { Email: EXPEDITEUR.email, Name: EXPEDITEUR.nom },
        To: [{ Email: a }],
        Subject: sujet,
        HTML: html,
        Text: texte,
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
