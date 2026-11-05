import { z } from "zod";
import { TAILLE_MAX_FICHIER, TYPES_STOCKES, typeFichier, type FormatStocke } from "@/lib/avis/regles";

// Les règles de la relève Gmail (phase 23) et leurs messages, définis une seule fois : le webhook, les écrans et l'email
// d'interruption les reprennent. Sans appel réseau, pour se tester seul, et sans module Node : les écrans l'importent. Les
// formes des événements de Composio viennent des livraisons relevées pendant l'essai (tests/fixtures/composio/).

/** Le déclencheur de Composio : il interroge Gmail toutes les 15 minutes, le minimum avec l'app OAuth de Composio. */
export const DECLENCHEUR_GMAIL = "GMAIL_NEW_GMAIL_MESSAGE";
export const INTERVALLE_RELEVE_MINUTES = 15;

/** La seule permission demandée à Google : Désigno lit la boîte, et ne peut rien y envoyer ni modifier. */
export const SCOPE_GMAIL = "https://www.googleapis.com/auth/gmail.readonly";

/** Les événements auxquels le projet Composio est abonné (webhook V3). */
export const EVENEMENTS_COMPOSIO = ["composio.trigger.message", "composio.connected_account.expired"] as const;

// Événements

type PartieGmail = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { attachmentId?: string; size?: number };
  parts?: PartieGmail[];
};

/** Une partie du message, au format de l'API Gmail : les pièces jointes sont des parties qui ont un nom de fichier. */
const schemaPartie: z.ZodType<PartieGmail> = z.lazy(() =>
  z.object({
    partId: z.string().optional(),
    mimeType: z.string().optional(),
    filename: z.string().optional(),
    headers: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
    body: z.object({ attachmentId: z.string().optional(), size: z.number().optional() }).optional(),
    parts: z.array(schemaPartie).optional(),
  }),
);

const schemaMessage = z.object({
  type: z.literal("composio.trigger.message"),
  metadata: z.object({ trigger_id: z.string(), connected_account_id: z.string() }),
  data: z.object({
    // L'id du message chez Gmail, celui de l'API et du lien « Ouvrir dans Gmail ».
    id: z.string().min(1).max(64),
    label_ids: z.array(z.string()).optional(),
    sender: z.string().optional(),
    subject: z.string().optional(),
    message_timestamp: z.string().optional(),
    payload: schemaPartie.optional(),
  }),
});

const schemaExpiration = z.object({
  type: z.literal("composio.connected_account.expired"),
  data: z.object({ id: z.string() }),
});

/** Un événement V3 de Composio : un email relevé, ou un compte connecté expiré. Les autres sont ignorés. */
export const schemaEvenement = z.discriminatedUnion("type", [schemaMessage, schemaExpiration]);
export type EvenementComposio = z.infer<typeof schemaEvenement>;
export type EmailReleve = z.infer<typeof schemaMessage>["data"];

/** La date de réception : un instant ISO, ou des millisecondes (`internalDate` de Gmail). `null` si illisible. */
export function dateReception(brute: string | undefined): string | null {
  if (!brute) return null;
  const ms = /^\d+$/.test(brute) ? Number(brute) : Date.parse(brute);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

// Pièces jointes

/** L'état d'un email que la relève vient de traiter : « non exploitable » dès qu'une pièce jointe n'a pas donné d'avis. */
export type EtatReleve = "releve" | "non_exploitable";

/** Pourquoi une pièce jointe n'a pas donné d'avis. */
export const MOTIFS_ECART = ["heic", "format", "taille", "connexion"] as const;
export type MotifEcart = (typeof MOTIFS_ECART)[number];
export type Ecart = { nom: string; motif: MotifEcart };

/** Une pièce jointe qui donnera un avis. `cle` la reconnaît d'une livraison à l'autre : l'`attachmentId` de Gmail change. */
export type PieceJointe = { cle: string; attachmentId: string; nom: string; type: string; taille: number };

function entete(partie: PartieGmail, nom: string) {
  return partie.headers?.find((h) => h.name.toLowerCase() === nom)?.value ?? null;
}

/** Une image affichée dans le corps de l'email (logo, signature) : elle a un Content-ID et n'est pas « attachment ». */
function estIntegree(partie: PartieGmail) {
  const disposition = entete(partie, "content-disposition")?.trim().toLowerCase() ?? "";
  return (
    entete(partie, "content-id") !== null &&
    !disposition.startsWith("attachment") &&
    (partie.mimeType ?? "").toLowerCase().startsWith("image/")
  );
}

function* parties(partie: PartieGmail): Generator<PartieGmail> {
  yield partie;
  for (const enfant of partie.parts ?? []) yield* parties(enfant);
}

/**
 * Sépare les pièces jointes d'un email : un PDF, un JPG ou un PNG de 10 Mo au plus donne un avis ; un HEIC, un autre
 * format ou un fichier trop lourd est écarté, avec son motif. Les images intégrées au corps sont ignorées.
 */
export function trierPiecesJointes(payload: PartieGmail | undefined): { exploitables: PieceJointe[]; ecarts: Ecart[] } {
  const exploitables: PieceJointe[] = [];
  const ecarts: Ecart[] = [];
  if (!payload) return { exploitables, ecarts };

  let rang = 0;
  for (const partie of parties(payload)) {
    const nom = partie.filename?.trim();
    const attachmentId = partie.body?.attachmentId;
    if (!nom || !attachmentId || estIntegree(partie)) continue;
    rang += 1;

    const format = typeFichier({ type: partie.mimeType ?? "", name: nom });
    const taille = partie.body?.size ?? 0;
    if (format === "heic") ecarts.push({ nom, motif: "heic" });
    else if (!format) ecarts.push({ nom, motif: "format" });
    else if (taille > TAILLE_MAX_FICHIER) ecarts.push({ nom, motif: "taille" });
    else {
      const cle = partie.partId ?? `${rang}:${nom}`;
      exploitables.push({ cle, attachmentId, nom, type: TYPES_STOCKES[format as FormatStocke], taille });
    }
  }
  return { exploitables, ecarts };
}

const SIGNATURES: Record<string, (contenu: Buffer) => boolean> = {
  "application/pdf": (c) => c.subarray(0, 5).toString("latin1") === "%PDF-",
  "image/jpeg": (c) => c[0] === 0xff && c[1] === 0xd8 && c[2] === 0xff,
  "image/png": (c) => c.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
};

/** Le contenu téléchargé est bien du format annoncé : un fichier renommé en .pdf est écarté. */
export function contenuConforme(type: string, contenu: Buffer): boolean {
  return SIGNATURES[type]?.(contenu) ?? false;
}

// Écrans et emails

/** Le message dans Gmail, depuis la boîte qui l'a reçu : un lien qui marche même si plusieurs comptes sont ouverts. */
export function lienGmail(boite: string | null, messageId: string) {
  return `https://mail.google.com/mail/u/${boite ? encodeURIComponent(boite) : "0"}/#all/${encodeURIComponent(messageId)}`;
}

// Espace insécable avant les deux-points : ils ne passent jamais seuls en début de ligne.
export const MESSAGES_GMAIL = {
  ecart: {
    heic: "Photo HEIC : déposez-la à la main, Désigno la convertit.",
    format: "Format non accepté : seuls les PDF, JPG et PNG deviennent des avis.",
    taille: "Fichier trop lourd : 10 Mo au maximum.",
    connexion: "Connexion Gmail interrompue : la pièce jointe n'a pas pu être téléchargée.",
  } satisfies Record<MotifEcart, string>,
  sansPieceJointe: "Aucune pièce jointe : l'avis est peut-être un lien, à ouvrir dans Gmail.",

  nouveauxSeulement:
    "Seuls les emails qui arrivent dans ce libellé à partir de maintenant sont relevés : ceux déjà rangés se déposent à la main.",
  lectureSeule: "Désigno lit seulement ce libellé, et n'envoie jamais rien depuis votre boîte.",
  delai: `La relève a lieu toutes les ${INTERVALLE_RELEVE_MINUTES} minutes environ.`,

  bandeau: (libelle: string | null) =>
    `La relève Gmail est interrompue : les avis rangés dans ${libelle ? `« ${libelle} »` : "votre libellé"} ne sont plus relevés. Les emails arrivés pendant la coupure ne seront pas rattrapés.`,
  reconnecte:
    "Gmail est reconnecté, et la relève a repris. Les emails arrivés pendant la coupure ne sont pas relevés : déposez-les à la main.",

  fonctionPro: "La relève Gmail est une fonction Pro.",
  indisponible: "La relève Gmail est indisponible pour le moment. Réessayez dans quelques minutes.",
  connexionRefusee: "La connexion à Gmail n'a pas abouti. Réessayez.",
  compteInconnu: "Ce compte Gmail n'a pas été connecté depuis Désigno. Réessayez.",
  libelleVide: "Choisissez un libellé.",
  libelleIntrouvable: "Ce libellé n'existe plus dans votre boîte Gmail. Choisissez-en un autre.",
  sansLibelle:
    "Votre boîte n'a aucun libellé créé par vous. Créez-en un dans Gmail, par exemple « Avis », puis rechargez cette page.",
  pasConnecte: "Aucune boîte Gmail n'est connectée.",
  emailIntrouvable: "Cet email n'est plus dans la liste des emails non exploitables.",
} as const;

/** Les messages d'une phrase, que l'adresse de l'écran Intégrations peut désigner après le retour de Google. */
export type CleMessageGmail = {
  [K in keyof typeof MESSAGES_GMAIL]: (typeof MESSAGES_GMAIL)[K] extends string ? K : never;
}[keyof typeof MESSAGES_GMAIL];

export function estCleMessageGmail(cle: unknown): cle is CleMessageGmail {
  return typeof cle === "string" && Object.hasOwn(MESSAGES_GMAIL, cle) && typeof MESSAGES_GMAIL[cle as CleMessageGmail] === "string";
}
