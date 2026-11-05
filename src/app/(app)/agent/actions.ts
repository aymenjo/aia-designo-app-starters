"use server";

import { refresh } from "next/cache";
import { clientAgentConfigure } from "@/lib/agent/client";
import { lireContexte } from "@/lib/agent/contexte";
import {
  arreterDemande,
  lireConversation,
  lireConversationPassee,
  listerConversations,
  nouvelleConversation,
  type ConversationListee,
  type ConversationPassee,
  type MessageConversation,
} from "@/lib/agent/conversations";
import { MESSAGES_AGENT, remiseAZeroDemandes, type RefContexte } from "@/lib/agent/regles";
import { lireDemandesDuMois } from "@/lib/agent/usage";
import {
  annulerRecapitulatif,
  confirmerRecapitulatif,
  type ResultatRecapitulatifAction,
} from "@/lib/flotte/recapitulatif";
import { MESSAGES_RECAPITULATIF } from "@/lib/flotte/regles-recapitulatif";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Le panneau « Demande à Désigno » (phase 26) : la conversation en cours, et « Nouvelle conversation ». Une demande,
// elle, passe par la route /api/agent, qui suit la réponse au fil de l'eau. « Confirmer » et « Annuler » un
// récapitulatif (phase 29) n'envoient rien à l'agent ni ne créent de message : ils ne comptent pas comme des demandes.
// Le compteur du mois (phase 27) est relu avec la conversation : à l'ouverture, pendant le suivi et après chaque envoi.
// Phase 28 : l'étape en cours est relue avec la conversation, « Arrêter » passe par une action, et le libellé de
// l'élément de l'écran (« Sur : … ») est lu sous la session du gestionnaire.
// Phase 32 : l'historique liste les conversations des 30 derniers jours, et en rouvre une en lecture seule. Comme la
// conversation en cours, il se lit sans contrôle du plan : en Free, le panneau n'affiche que le cadenas.

/** `usage` : les demandes du mois, et la remise à zéro du compteur (ISO). `etape` : celle de la demande en cours. */
export type EtatConversation = {
  messages: MessageConversation[];
  enCours: boolean;
  etape: string | null;
  usage: { demandes: number; retour: string };
};

/** La conversation en cours, pour l'ouverture du panneau et le suivi d'une demande ; `null` sans session ou en panne. */
export async function lireConversationAction(): Promise<EtatConversation | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return null;
  try {
    const maintenant = new Date();
    const [conversation, demandes] = await Promise.all([
      lireConversation(supabase, maintenant),
      lireDemandesDuMois(supabase, maintenant),
    ]);
    return { ...conversation, usage: { demandes, retour: remiseAZeroDemandes(maintenant) } };
  } catch (erreur) {
    console.error("conversation", erreur instanceof Error ? erreur.message : erreur);
    return null;
  }
}

/** Les conversations des 30 derniers jours, la conversation en cours en tête ; `null` sans session ou en panne. */
export async function listerConversationsAction(): Promise<ConversationListee[] | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return null;
  try {
    return await listerConversations(supabase);
  } catch (erreur) {
    console.error("historique", erreur instanceof Error ? erreur.message : erreur);
    return null;
  }
}

/** Une conversation terminée, en lecture seule ; le message qui dit pourquoi elle ne s'ouvre pas, sinon. */
export async function lireConversationPasseeAction(
  id: string,
): Promise<{ ok: true; conversation: ConversationPassee } | { ok: false; erreur: string }> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return { ok: false, erreur: MESSAGES_AGENT.indisponible };
  try {
    const conversation = await lireConversationPassee(supabase, id);
    return conversation ? { ok: true, conversation } : { ok: false, erreur: MESSAGES_AGENT.plusConsultable };
  } catch (erreur) {
    console.error("conversation passée", erreur instanceof Error ? erreur.message : erreur);
    return { ok: false, erreur: MESSAGES_AGENT.indisponible };
  }
}

/** « Nouvelle conversation » : la précédente est terminée, et sa session effacée chez Anthropic. */
export async function nouvelleConversationAction(): Promise<{ ok: true } | { ok: false; erreur: string }> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return { ok: false, erreur: MESSAGES_AGENT.indisponible };
  try {
    return await nouvelleConversation({ admin: createAdminClient(), supabase, client: clientAgentConfigure() });
  } catch (erreur) {
    console.error("nouvelle conversation", erreur instanceof Error ? erreur.message : erreur);
    return { ok: false, erreur: MESSAGES_AGENT.indisponible };
  }
}

/** « Arrêter » : la demande en cours s'arrête dans les secondes qui suivent ; sans demande en cours, rien ne change. */
export async function arreterDemandeAction(): Promise<{ ok: true } | { ok: false; erreur: string }> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return { ok: false, erreur: MESSAGES_AGENT.arretImpossible };
  try {
    return await arreterDemande({ admin: createAdminClient(), supabase });
  } catch (erreur) {
    console.error("arrêt de la demande", erreur instanceof Error ? erreur.message : erreur);
    return { ok: false, erreur: MESSAGES_AGENT.arretImpossible };
  }
}

/** Le libellé de l'élément de l'écran, derrière « Sur : » ; `null` s'il est introuvable, ou sans session. */
export async function lireContexteAction(ref: RefContexte): Promise<{ libelle: string } | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return null;
  try {
    const lu = await lireContexte(supabase, ref);
    return lu && { libelle: lu.contexte.libelle };
  } catch (erreur) {
    console.error("contexte de l'écran", erreur instanceof Error ? erreur.message : erreur);
    return null;
  }
}

async function surRecapitulatif(
  agir: (supabase: Awaited<ReturnType<typeof createClient>>) => Promise<ResultatRecapitulatifAction>,
): Promise<ResultatRecapitulatifAction> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return { ok: false, erreur: MESSAGES_RECAPITULATIF.echec };
  try {
    return await agir(supabase);
  } catch (erreur) {
    console.error("récapitulatif", erreur instanceof Error ? erreur.message : erreur);
    return { ok: false, erreur: MESSAGES_RECAPITULATIF.echec };
  }
}

/** « Confirmer » : les modifications sont revérifiées, puis appliquées toutes ou aucune ; les écrans les montrent aussitôt. */
export async function confirmerRecapitulatifAction(id: string): Promise<ResultatRecapitulatifAction> {
  const resultat = await surRecapitulatif((supabase) => confirmerRecapitulatif(supabase, id));
  if (resultat.ok) refresh();
  return resultat;
}

/** « Annuler » : le récapitulatif est abandonné, sans rien modifier. */
export async function annulerRecapitulatifAction(id: string): Promise<ResultatRecapitulatifAction> {
  return surRecapitulatif((supabase) => annulerRecapitulatif(supabase, id));
}
