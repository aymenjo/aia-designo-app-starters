import type { SupabaseClient } from "@supabase/supabase-js";
import {
  COLONNES_RECAPITULATIF,
  type LigneRecapitulatif,
  type RecapitulatifConversation,
  type StatutRecapitulatif,
} from "@/lib/flotte/regles-recapitulatif";
import type { ConversationServeur } from "./conversations";
import type { SortRecapitulatif } from "./regles";

// Les récapitulatifs de modifications (phase 29), du côté de la demande : seul le serveur les crée et les rattache, avec
// la clé secrète (`admin`). Un récapitulatif naît pendant le tour de l'agent, sans message ; il est rattaché à la réponse
// une fois celle-ci enregistrée. Un récapitulatif resté sans réponse (tour en échec, demande coupée net) expire. Son sort
// (appliqué, annulé, expiré) est signalé à l'agent avec la demande suivante, une seule fois. « Modifier » (phase 30) le remplace
// dès que la demande qui le corrige est acceptée.

type Reponse<T> = { data: T | null; error: { code: string; message: string } | null };

function verifier<T>({ data, error }: Reponse<T>, quoi: string): T | null {
  if (error) throw new Error(`${quoi} : ${error.code} ${error.message}`);
  return data;
}

/** Enregistre la proposition de l'agent : elle remplace la précédente de la conversation (trigger de la migration). */
export async function enregistrerRecapitulatif(
  admin: SupabaseClient,
  conversation: Pick<ConversationServeur, "id" | "entreprise_id">,
  lignes: readonly LigneRecapitulatif[],
): Promise<{ id: string; statut: StatutRecapitulatif }> {
  return verifier(
    await admin
      .from("recapitulatif")
      .insert({ entreprise_id: conversation.entreprise_id, conversation_id: conversation.id, lignes })
      .select("id, statut")
      .single<{ id: string; statut: StatutRecapitulatif }>(),
    "récapitulatif",
  )!;
}

/**
 * Rattache à la réponse de l'agent les récapitulatifs proposés pendant son tour. Renvoie le dernier, celui que la carte
 * affiche sous la réponse.
 */
export async function rattacherRecapitulatifs(
  admin: SupabaseClient,
  conversationId: string,
  messageId: string,
): Promise<RecapitulatifConversation | null> {
  const rattaches = verifier(
    await admin
      .from("recapitulatif")
      .update({ message_id: messageId })
      .eq("conversation_id", conversationId)
      .is("message_id", null)
      .select(`${COLONNES_RECAPITULATIF}, cree_le`)
      .overrideTypes<(RecapitulatifConversation & { cree_le: string })[], { merge: false }>(),
    "récapitulatifs rattachés",
  );
  const dernier = (rattaches ?? []).toSorted((a, b) => Date.parse(b.cree_le) - Date.parse(a.cree_le))[0];
  if (!dernier) return null;
  const { cree_le, ...recapitulatif } = dernier;
  void cree_le;
  return recapitulatif;
}

/**
 * « Modifier » (phase 30) : la demande qui corrige un récapitulatif en attente de la conversation le rend inapplicable
 * dès qu'elle est acceptée, même si l'agent ne fait que poser une question. Renvoie ses lignes, jointes à la demande, ou
 * `null` s'il n'attend plus « Confirmer » (appliqué entre-temps, annulé, remplacé) ou n'est pas de cette conversation :
 * la demande part alors comme une autre. Un « Confirmer » simultané se règle par le verrou de la ligne
 * (`appliquer_recapitulatif` la lit `for update`) : l'un des deux seulement trouve le récapitulatif en attente.
 */
export async function remplacerPourCorrection(
  admin: SupabaseClient,
  conversationId: string,
  id: string,
): Promise<LigneRecapitulatif[] | null> {
  const remplace = verifier(
    await admin
      .from("recapitulatif")
      .update({ statut: "remplace" })
      .eq("id", id)
      .eq("conversation_id", conversationId)
      .eq("statut", "propose")
      .select("lignes")
      .maybeSingle<{ lignes: LigneRecapitulatif[] }>(),
    "récapitulatif corrigé",
  );
  return remplace?.lignes ?? null;
}

/** Les récapitulatifs en attente restés sans réponse de l'agent : l'agent ne les a jamais présentés, ils expirent. */
export async function expirerOrphelins(admin: SupabaseClient, conversationId: string): Promise<void> {
  verifier(
    await admin
      .from("recapitulatif")
      .update({ statut: "expire" })
      .eq("conversation_id", conversationId)
      .is("message_id", null)
      .eq("statut", "propose"),
    "récapitulatifs orphelins",
  );
}

/** Les sorts que l'agent ignore encore : appliqué, annulé ou expiré depuis sa dernière réponse. */
export async function sortsANoter(admin: SupabaseClient, conversationId: string): Promise<SortRecapitulatif[]> {
  return (
    verifier(
      await admin
        .from("recapitulatif")
        .select("id, statut, applique_le")
        .eq("conversation_id", conversationId)
        .in("statut", ["applique", "annule", "expire"])
        .is("sort_signale_le", null)
        .order("cree_le")
        .overrideTypes<SortRecapitulatif[], { merge: false }>(),
      "sorts des récapitulatifs",
    ) ?? []
  );
}

/** Les sorts sont partis avec la demande : ils ne seront plus signalés. */
export async function marquerSignales(admin: SupabaseClient, ids: readonly string[], maintenant: Date): Promise<void> {
  if (!ids.length) return;
  verifier(
    await admin.from("recapitulatif").update({ sort_signale_le: maintenant.toISOString() }).in("id", ids),
    "sorts signalés",
  );
}
