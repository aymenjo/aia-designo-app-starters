import type { SupabaseClient } from "@supabase/supabase-js";
import { COLONNES_RECAPITULATIF, type RecapitulatifConversation } from "@/lib/flotte/regles-recapitulatif";
import { UUID } from "./citations";
import type { ClientAgent } from "./client";
import { MESSAGES_AGENT, debutConservation, verrouMortAvant, type ContexteDemande } from "./regles";

// Les conversations de Demande à Désigno (phase 26) : la conversation en cours, « Nouvelle conversation », la purge à
// 30 jours et l'effacement à la suppression de compte. Le gestionnaire lit sous sa session (RLS) ; seul le serveur
// écrit, avec la clé secrète (`admin`). Une conversation correspond à une session chez Anthropic, effacée avec elle.
// « Arrêter » (phase 28) passe aussi par le serveur : il pose le verrou de la demande en cours, que le traitement guette.
// L'historique (phase 32) liste les conversations des 30 derniers jours, et rouvre une conversation terminée en lecture.

export type RoleMessage = "gestionnaire" | "agent";

export type MessageConversation = {
  id: string;
  role: RoleMessage;
  contenu: string;
  /** Une réponse qui n'a pas abouti (délai, panne) : le panneau l'affiche comme une erreur. */
  erreur: boolean;
  /** « Demande arrêtée. » : la mention qui remplace la réponse d'une demande arrêtée (phase 28). */
  arret: boolean;
  /** L'élément de l'écran ouvert quand le gestionnaire a envoyé sa demande (phase 28), rappelé sous sa bulle. */
  contexte: ContexteDemande | null;
  /** Une demande envoyée par « Modifier » (phase 30) : « Corrige le récapitulatif » est rappelé sous sa bulle. */
  correction: boolean;
  cree_le: string;
  /** Le récapitulatif de modifications que la réponse présente (phase 29), avec « Confirmer ». */
  recapitulatif?: RecapitulatifConversation;
};

export const COLONNES_MESSAGE = "id, role, contenu, erreur, arret, contexte, correction, cree_le";

/** La conversation en cours, côté serveur : avec sa session, son verrou et ses éléments connus. */
export type ConversationServeur = {
  id: string;
  entreprise_id: string;
  session_id: string | null;
  debut: string;
  premiere_demande: string | null;
  demande_en_cours_depuis: string | null;
  elements_connus: string[];
};

export const COLONNES_CONVERSATION =
  "id, entreprise_id, session_id, debut, premiere_demande, demande_en_cours_depuis, elements_connus";

type Reponse<T> = { data: T | null; error: { code: string; message: string } | null };

/** Les lignes d'une lecture, ou son erreur levée. */
function lignes<T>({ data, error }: Reponse<T[]>, quoi: string): T[] {
  if (error) throw new Error(`${quoi} : ${error.code} ${error.message}`);
  return data ?? [];
}

/** La ligne d'une lecture ou d'une écriture, `null` s'il n'y en a pas, ou son erreur levée. */
function ligne<T>({ data, error }: Reponse<T>, quoi: string): T | null {
  if (error) throw new Error(`${quoi} : ${error.code} ${error.message}`);
  return data;
}

const enCours = (depuis: string | null, maintenant: Date) =>
  depuis !== null && Date.parse(depuis) > verrouMortAvant(maintenant).getTime();

/**
 * La conversation en cours du gestionnaire et ses messages, dans l'ordre ; vide s'il n'en a pas, ou si elle a plus de
 * 30 jours. `enCours` : une demande est en train d'être traitée, par exemple après la fermeture de l'onglet ; `etape` est
 * alors son étape en cours (phase 28), `null` avant le premier appel d'outil.
 */
export async function lireConversation(
  supabase: SupabaseClient,
  maintenant = new Date(),
): Promise<{ messages: MessageConversation[]; enCours: boolean; etape: string | null }> {
  const conversation = ligne(
    await supabase
      .from("conversation")
      .select("id, demande_en_cours_depuis, etape")
      .is("terminee_le", null)
      .gte("debut", debutConservation(maintenant).toISOString())
      .maybeSingle<{ id: string; demande_en_cours_depuis: string | null; etape: string | null }>(),
    "conversation",
  );
  if (!conversation) return { messages: [], enCours: false, etape: null };
  return { messages: await lireFil(supabase, conversation.id), ...suivi(conversation, maintenant) };
}

/** Les messages d'une conversation, dans l'ordre, et sous chaque réponse le récapitulatif qu'elle présente. */
async function lireFil(supabase: SupabaseClient, conversationId: string): Promise<MessageConversation[]> {
  const [messages, recapitulatifs] = await Promise.all([
    supabase
      .from("message")
      .select(COLONNES_MESSAGE)
      .eq("conversation_id", conversationId)
      .order("cree_le")
      .overrideTypes<MessageConversation[], { merge: false }>(),
    supabase
      .from("recapitulatif")
      .select(`${COLONNES_RECAPITULATIF}, message_id`)
      .eq("conversation_id", conversationId)
      .not("message_id", "is", null)
      .order("cree_le")
      .overrideTypes<(RecapitulatifConversation & { message_id: string })[], { merge: false }>(),
  ]);
  // Une réponse présente le dernier récapitulatif proposé pendant son tour.
  const parMessage = new Map<string, RecapitulatifConversation>();
  for (const { message_id, ...recapitulatif } of lignes(recapitulatifs, "récapitulatifs")) parMessage.set(message_id, recapitulatif);
  return lignes(messages, "messages").map((message) => {
    const recapitulatif = parMessage.get(message.id);
    return recapitulatif ? { ...message, recapitulatif } : message;
  });
}

function suivi(conversation: { demande_en_cours_depuis: string | null; etape: string | null }, maintenant: Date) {
  const actif = enCours(conversation.demande_en_cours_depuis, maintenant);
  return { enCours: actif, etape: actif ? conversation.etape : null };
}

// L'historique (phase 32) : les conversations des 30 derniers jours, sous la session du gestionnaire. La RLS coupe déjà
// à 30 jours ; les lectures coupent aussi, à `maintenant`, pour suivre la même règle que la conversation en cours.

/** Une conversation de l'historique, telle que la liste l'affiche. */
export type ConversationListee = {
  id: string;
  debut: string;
  premiereDemande: string;
  /** La conversation en cours, en tête de la liste : un clic ramène au fil, avec la saisie. */
  enCours: boolean;
  /** Le nombre de récapitulatifs appliqués : ce que l'agent a modifié. */
  appliques: number;
};

/**
 * Les conversations des 30 derniers jours qui ont reçu au moins une demande : la conversation en cours en tête, puis
 * les autres, de la plus récente à la plus ancienne. Sans pagination : la limite de demandes par mois en borne le nombre.
 */
export async function listerConversations(supabase: SupabaseClient, maintenant = new Date()): Promise<ConversationListee[]> {
  const coupure = debutConservation(maintenant).toISOString();
  const [conversations, appliques] = await Promise.all([
    supabase
      .from("conversation")
      .select("id, debut, premiere_demande, terminee_le")
      .gte("debut", coupure)
      .not("premiere_demande", "is", null)
      .order("debut", { ascending: false })
      .overrideTypes<{ id: string; debut: string; premiere_demande: string; terminee_le: string | null }[], { merge: false }>(),
    // Sans liste d'ids, qui ferait une URL trop longue : un récapitulatif naît après le début de sa conversation.
    supabase
      .from("recapitulatif")
      .select("conversation_id")
      .eq("statut", "applique")
      .gte("cree_le", coupure)
      .overrideTypes<{ conversation_id: string }[], { merge: false }>(),
  ]);
  const parConversation = new Map<string, number>();
  for (const { conversation_id } of lignes(appliques, "récapitulatifs appliqués")) {
    parConversation.set(conversation_id, (parConversation.get(conversation_id) ?? 0) + 1);
  }
  return lignes(conversations, "conversations")
    .map(({ id, debut, premiere_demande, terminee_le }) => ({
      id,
      debut,
      premiereDemande: premiere_demande,
      enCours: terminee_le === null,
      appliques: parConversation.get(id) ?? 0,
    }))
    .toSorted((a, b) => Number(b.enCours) - Number(a.enCours));
}

/** Une conversation terminée, rouverte en lecture seule. */
export type ConversationPassee = { debut: string; messages: MessageConversation[] };

/**
 * Une conversation terminée des 30 derniers jours, ses messages et ses récapitulatifs ; `null` si elle est introuvable
 * (une autre entreprise, plus de 30 jours, un id invalide), ou si c'est la conversation en cours, qui s'ouvre par le fil.
 */
export async function lireConversationPassee(
  supabase: SupabaseClient,
  id: string,
  maintenant = new Date(),
): Promise<ConversationPassee | null> {
  if (!UUID.test(id)) return null;
  const conversation = ligne(
    await supabase
      .from("conversation")
      .select("debut, terminee_le")
      .eq("id", id)
      .gte("debut", debutConservation(maintenant).toISOString())
      .maybeSingle<{ debut: string; terminee_le: string | null }>(),
    "conversation",
  );
  if (!conversation?.terminee_le) return null;
  return { debut: conversation.debut, messages: await lireFil(supabase, id) };
}

/**
 * La conversation en cours de l'entreprise, créée si elle n'en a pas. Une conversation de plus de 30 jours est terminée
 * et remplacée : la purge efface sa session.
 */
export async function conversationEnCours(
  admin: SupabaseClient,
  entrepriseId: string,
  maintenant: Date,
): Promise<ConversationServeur> {
  const lireEnCours = async () =>
    ligne(
      await admin
        .from("conversation")
        .select(COLONNES_CONVERSATION)
        .eq("entreprise_id", entrepriseId)
        .is("terminee_le", null)
        .maybeSingle<ConversationServeur>(),
      "conversation",
    );

  const existante = await lireEnCours();
  if (existante && Date.parse(existante.debut) >= debutConservation(maintenant).getTime()) return existante;
  if (existante) {
    ligne(
      await admin
        .from("conversation")
        .update({ terminee_le: maintenant.toISOString() })
        .eq("id", existante.id)
        .is("terminee_le", null),
      "conversation expirée",
    );
  }

  const creee = await admin
    .from("conversation")
    .insert({ entreprise_id: entrepriseId, debut: maintenant.toISOString() })
    .select(COLONNES_CONVERSATION)
    .single<ConversationServeur>();
  // Deux demandes simultanées : l'index unique n'en laisse créer qu'une, l'autre la reprend.
  if (creee.error?.code === "23505") {
    const concurrente = await lireEnCours();
    if (concurrente) return concurrente;
  }
  return ligne(creee, "nouvelle conversation")!;
}

/**
 * « Arrêter » : la demande en cours de la conversation du gestionnaire est marquée à arrêter, par son verrou. Le
 * traitement le voit dans la seconde, interrompt la session et enregistre « Demande arrêtée. ». Sans demande en cours
 * (déjà finie, ou morte), rien ne change.
 */
export async function arreterDemande({
  admin,
  supabase,
  maintenant = new Date(),
}: {
  admin: SupabaseClient;
  supabase: SupabaseClient;
  maintenant?: Date;
}): Promise<{ ok: true }> {
  const entreprise = ligne(await supabase.from("entreprise").select("id").single<{ id: string }>(), "entreprise")!;
  const conversation = ligne(
    await admin
      .from("conversation")
      .select("id, demande_en_cours_depuis")
      .eq("entreprise_id", entreprise.id)
      .is("terminee_le", null)
      .maybeSingle<{ id: string; demande_en_cours_depuis: string | null }>(),
    "conversation",
  );
  const verrou = conversation?.demande_en_cours_depuis ?? null;
  if (!conversation || !verrou || !enCours(verrou, maintenant)) return { ok: true };
  // Conditionné par le verrou : une demande finie entre-temps n'arrête pas la suivante.
  ligne(
    await admin
      .from("conversation")
      .update({ arret_demande: verrou })
      .eq("id", conversation.id)
      .eq("demande_en_cours_depuis", verrou),
    "arrêt demandé",
  );
  return { ok: true };
}

/** Les sessions de l'entreprise qui restent chez Anthropic. */
async function sessionsAEffacer(admin: SupabaseClient, entrepriseId: string) {
  return lignes(
    await admin
      .from("conversation")
      .select("id, session_id")
      .eq("entreprise_id", entrepriseId)
      .not("session_id", "is", null)
      .is("session_effacee_le", null)
      .overrideTypes<{ id: string; session_id: string }[], { merge: false }>(),
    "sessions à effacer",
  );
}

/** Efface la session chez Anthropic, puis le note. Une conversation encore en cours est terminée au passage. */
async function effacerSession(admin: SupabaseClient, client: ClientAgent, id: string, sessionId: string, maintenant: Date) {
  await client.effacerSession(sessionId);
  const instant = maintenant.toISOString();
  ligne(
    await admin.from("conversation").update({ terminee_le: instant }).eq("id", id).is("terminee_le", null),
    "conversation terminée",
  );
  ligne(await admin.from("conversation").update({ session_effacee_le: instant }).eq("id", id), "session effacée");
}

/**
 * « Nouvelle conversation » : la conversation en cours est terminée, et sa session effacée chez Anthropic ; la demande
 * suivante en ouvre une neuve. Refusé pendant une demande. Si l'effacement échoue, ou sans client, la purge de la nuit
 * le reprend.
 */
export async function nouvelleConversation({
  admin,
  supabase,
  client,
  maintenant = new Date(),
}: {
  admin: SupabaseClient;
  supabase: SupabaseClient;
  client: ClientAgent | null;
  maintenant?: Date;
}): Promise<{ ok: true } | { ok: false; erreur: string }> {
  const entreprise = ligne(await supabase.from("entreprise").select("id").single<{ id: string }>(), "entreprise")!;
  const conversation = ligne(
    await admin
      .from("conversation")
      .select(COLONNES_CONVERSATION)
      .eq("entreprise_id", entreprise.id)
      .is("terminee_le", null)
      .maybeSingle<ConversationServeur>(),
    "conversation",
  );
  if (!conversation) return { ok: true };

  const verrouMort = verrouMortAvant(maintenant).toISOString();
  const terminee = ligne(
    await admin
      .from("conversation")
      .update({ terminee_le: maintenant.toISOString() })
      .eq("id", conversation.id)
      .is("terminee_le", null)
      .or(`demande_en_cours_depuis.is.null,demande_en_cours_depuis.lt."${verrouMort}"`)
      .select("id")
      .maybeSingle(),
    "conversation terminée",
  );
  if (!terminee) return { ok: false, erreur: MESSAGES_AGENT.enCours };

  if (conversation.session_id && client) {
    try {
      await effacerSession(admin, client, conversation.id, conversation.session_id, maintenant);
    } catch (erreur) {
      console.error("nouvelle conversation", erreur instanceof Error ? erreur.message : erreur);
    }
  }
  return { ok: true };
}

/**
 * La purge quotidienne : les sessions des conversations terminées, ou de plus de 30 jours, sont effacées chez Anthropic,
 * puis les conversations de plus de 30 jours sont supprimées, messages compris. Idempotente : relancée, elle ne trouve
 * plus rien. Une session qui ne s'efface pas garde sa conversation, que la nuit suivante reprend.
 */
export async function purgerConversations({
  admin,
  client,
  maintenant = new Date(),
}: {
  admin: SupabaseClient;
  client: ClientAgent;
  maintenant?: Date;
}): Promise<{ sessions: number; conversations: number; echecs: number }> {
  const coupure = debutConservation(maintenant).toISOString();
  const aEffacer = lignes(
    await admin
      .from("conversation")
      .select("id, session_id")
      .not("session_id", "is", null)
      .is("session_effacee_le", null)
      .or(`terminee_le.not.is.null,debut.lt."${coupure}"`)
      .overrideTypes<{ id: string; session_id: string }[], { merge: false }>(),
    "sessions à effacer",
  );

  let sessions = 0;
  let echecs = 0;
  for (const { id, session_id } of aEffacer) {
    try {
      await effacerSession(admin, client, id, session_id, maintenant);
      sessions += 1;
    } catch (erreur) {
      echecs += 1;
      console.error(`purge de la session ${session_id}`, erreur instanceof Error ? erreur.message : erreur);
    }
  }

  const supprimees = lignes(
    await admin
      .from("conversation")
      .delete()
      .lt("debut", coupure)
      .or("session_id.is.null,session_effacee_le.not.is.null")
      .select("id"),
    "conversations expirées",
  );
  return { sessions, conversations: supprimees.length, echecs };
}

/** Il reste au moins une session de l'entreprise chez Anthropic : la suppression de compte doit pouvoir l'effacer. */
export async function resteDesSessions(admin: SupabaseClient, entrepriseId: string): Promise<boolean> {
  return (await sessionsAEffacer(admin, entrepriseId)).length > 0;
}

/**
 * La suppression de compte (phase 20) : chaque session de l'entreprise est effacée chez Anthropic. Les lignes partent
 * ensuite en cascade avec l'entreprise. Une panne lève une erreur : la relance reprend les sessions qui restent.
 */
export async function effacerConversations({
  admin,
  client,
  entrepriseId,
  maintenant = new Date(),
}: {
  admin: SupabaseClient;
  client: ClientAgent | null;
  entrepriseId: string;
  maintenant?: Date;
}): Promise<void> {
  const sessions = await sessionsAEffacer(admin, entrepriseId);
  if (sessions.length && !client) throw new Error("sessions de l'agent à effacer sans client Anthropic");
  for (const { id, session_id } of sessions) await effacerSession(admin, client!, id, session_id, maintenant);
}
