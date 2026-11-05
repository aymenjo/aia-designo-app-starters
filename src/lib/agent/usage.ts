import type { SupabaseClient } from "@supabase/supabase-js";
import { DEMANDES_AGENT_PAR_MOIS } from "@/lib/abonnement/plans";
import { moisDemandes } from "./regles";

// La limite de Demande à Désigno (phase 27) : 100 demandes par mois calendaire, à l'heure de Paris. Le compteur vit dans
// `usage_agent`, à part des messages : la purge à 30 jours ne le touche pas. Seule la clé secrète l'incrémente, par
// `compter_demande_agent`, en un upsert atomique (migration usage_agent).

/** Les demandes du mois de l'entreprise du gestionnaire (RLS) : 0 sans ligne. */
export async function lireDemandesDuMois(supabase: SupabaseClient, maintenant = new Date()): Promise<number> {
  const { data, error } = await supabase
    .from("usage_agent")
    .select("demandes")
    .eq("mois", moisDemandes(maintenant))
    .maybeSingle<{ demandes: number }>();
  if (error) throw new Error(`usage de l'agent : ${error.code} ${error.message}`);
  return data?.demandes ?? 0;
}

/**
 * Compte une demande acceptée. Renvoie le nouveau total du mois, ou `null` si la limite est déjà atteinte : la demande
 * est alors refusée, sans rien compter. `admin` porte la clé secrète.
 */
export async function compterDemande(
  admin: SupabaseClient,
  entrepriseId: string,
  maintenant = new Date(),
): Promise<number | null> {
  const { data, error } = await admin.rpc("compter_demande_agent", {
    p_entreprise_id: entrepriseId,
    p_mois: moisDemandes(maintenant),
    p_limite: DEMANDES_AGENT_PAR_MOIS,
  });
  if (error) throw new Error(`compte de la demande : ${error.code} ${error.message}`);
  return (data as number | null) ?? null;
}
