import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Ecart } from "./regles";

// Les emails relevés dans Gmail (phase 23), sous la session du gestionnaire (RLS) : la liste « Emails non exploitables »,
// et ses deux actions, « Ignorer » et « Déposer manuellement ». Seule la relève les crée, avec la clé secrète.

export type EtatEmail = "releve" | "non_exploitable" | "ignore" | "depose";

export type EmailGmail = {
  id: string;
  message_id: string;
  boite: string | null;
  expediteur: string | null;
  objet: string | null;
  recu_le: string | null;
  releve_le: string;
  etat: EtatEmail;
  ecarts: Ecart[];
};

export const COLONNES_EMAIL = "id, message_id, boite, expediteur, objet, recu_le, releve_le, etat, ecarts";

export const schemaIdEmail = z.uuid();

/** Les emails non exploitables, du plus récent au plus ancien. */
export function listerNonExploitables(supabase: SupabaseClient) {
  return supabase
    .from("email_gmail")
    .select(COLONNES_EMAIL)
    .eq("etat", "non_exploitable")
    .order("releve_le", { ascending: false })
    .overrideTypes<EmailGmail[], { merge: false }>();
}

/** Le nombre d'emails non exploitables : le lien en tête de la liste des avis. */
export function compterNonExploitables(supabase: SupabaseClient) {
  return supabase.from("email_gmail").select("id", { count: "exact", head: true }).eq("etat", "non_exploitable");
}

/** Un email encore non exploitable, que le dépôt manuel rappelle ; `null` s'il a été traité entre-temps. */
export function lireNonExploitable(supabase: SupabaseClient, id: string) {
  return supabase
    .from("email_gmail")
    .select(COLONNES_EMAIL)
    .eq("id", id)
    .eq("etat", "non_exploitable")
    .maybeSingle<EmailGmail>();
}

/**
 * « Ignorer » ou « Déposer manuellement » : l'email sort de la liste. Rien n'est supprimé, ni ici ni dans Gmail. La RLS
 * n'autorise que ce passage, depuis un email non exploitable. Renvoie `false` si l'email n'y était plus.
 */
export async function traiterEmail(supabase: SupabaseClient, id: string, etat: "ignore" | "depose"): Promise<boolean> {
  if (!schemaIdEmail.safeParse(id).success) return false;
  const { data, error } = await supabase
    .from("email_gmail")
    .update({ etat, traite_le: new Date().toISOString() })
    .eq("id", id)
    .eq("etat", "non_exploitable")
    .select("id");
  if (error) throw new Error(`email ${etat} : ${error.code} ${error.message}`);
  return data.length > 0;
}
