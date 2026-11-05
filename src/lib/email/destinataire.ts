import type { SupabaseClient } from "@supabase/supabase-js";

/** L'adresse du gestionnaire, celle de son compte : `supabase` porte la clé secrète (alertes, factures). */
export async function emailDuGestionnaire(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error) throw new Error(`gestionnaire : ${error.message}`);
  if (!data.user.email) throw new Error("gestionnaire sans email");
  return data.user.email;
}
