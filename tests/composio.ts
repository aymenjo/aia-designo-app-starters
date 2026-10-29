import { signerCorps } from "@/lib/gmail/signature";

// Les événements que reçoit le webhook de Composio (V3), réduits aux champs utiles et signés comme Composio les signe.
// Partagés par les tests unitaires, d'intégration et E2E : la CI ne parle jamais à Composio.

/** Le secret de `npm run env:local` (scripts/env-supabase-local.sh), celui du serveur en local et en CI. */
export const SECRET_COMPOSIO = process.env.COMPOSIO_WEBHOOK_SECRET ?? "composio-local";

let compteur = 0;
/** « ti_t1a2b3… » : un id unique, pour que les tests ne se croisent pas en base. */
export function idComposio(prefixe: "ca" | "ti" | "msg") {
  compteur += 1;
  return `${prefixe}_t${Date.now().toString(36)}${compteur.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Une pièce jointe, comme une partie du message de l'API Gmail. `integree` : une image du corps (Content-ID, inline). */
export function piece({
  nom,
  type = "application/pdf",
  taille = 120_000,
  integree = false,
}: {
  nom: string;
  type?: string;
  taille?: number;
  integree?: boolean;
}) {
  return {
    mimeType: type,
    filename: nom,
    headers: integree
      ? [
          { name: "Content-Disposition", value: `inline; filename="${nom}"` },
          { name: "Content-ID", value: `<${nom}@exemple>` },
        ]
      : [{ name: "Content-Disposition", value: `attachment; filename="${nom}"` }],
    body: { attachmentId: `ANG${Math.random().toString(36).slice(2)}`, size: taille },
  };
}

/** Un email relevé par le déclencheur : un corps texte, puis ses pièces jointes, numérotées comme Gmail les numérote. */
export function evenementEmail({
  declencheur,
  compte,
  messageId = idComposio("msg").replace("msg_", ""),
  pieces = [],
  libelles,
  expediteur = "ANTAI <ne-pas-repondre@antai.gouv.fr>",
  objet = "Avis de contravention",
  recuLe = "2026-10-26T08:12:00Z",
}: {
  declencheur: string;
  compte: string;
  messageId?: string;
  pieces?: ReturnType<typeof piece>[];
  libelles?: string[];
  expediteur?: string;
  objet?: string;
  recuLe?: string;
}) {
  return {
    id: idComposio("msg"),
    type: "composio.trigger.message",
    timestamp: new Date().toISOString(),
    metadata: {
      log_id: "log_test",
      trigger_slug: "GMAIL_NEW_GMAIL_MESSAGE",
      trigger_id: declencheur,
      connected_account_id: compte,
      auth_config_id: "ac_test",
      user_id: "entreprise",
    },
    data: {
      id: messageId,
      message_id: messageId,
      thread_id: messageId,
      label_ids: libelles,
      sender: expediteur,
      subject: objet,
      message_timestamp: recuLe,
      message_text: "Veuillez trouver ci-joint votre avis.",
      payload: {
        partId: "",
        mimeType: "multipart/mixed",
        parts: [
          { partId: "0", mimeType: "text/plain", filename: "", body: { size: 36 } },
          ...pieces.map((p, i) => ({ ...p, partId: String(i + 1) })),
        ],
      },
    },
  };
}

/** Un compte connecté expiré : l'accès à la boîte est retiré ou n'a pas pu être renouvelé. */
export function evenementExpiration(compte: string) {
  return {
    id: idComposio("msg"),
    type: "composio.connected_account.expired",
    timestamp: new Date().toISOString(),
    metadata: { project_id: "pr_test", org_id: "ok_test" },
    data: {
      id: compte,
      toolkit: { slug: "gmail" },
      auth_config: { id: "ac_test", auth_scheme: "OAUTH2", is_composio_managed: true, is_disabled: false },
      status: "EXPIRED",
      status_reason: "OAuth refresh token expired",
      is_disabled: false,
    },
  };
}

/** Le corps brut et les en-têtes, signés comme Composio : `secret` autre que celui du serveur donne une signature forgée. */
export function signer(evenement: unknown, secret = SECRET_COMPOSIO) {
  const corps = JSON.stringify(evenement);
  return { corps, entetes: new Headers(signerCorps(corps, secret)) };
}

// Des contenus réduits à leur signature : le webhook vérifie que le fichier est bien du format annoncé.
export const CONTENU_PDF = Buffer.from("%PDF-1.4\n%test\n");
export const CONTENU_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
