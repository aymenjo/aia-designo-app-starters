import { createClient } from "@supabase/supabase-js";

/**
 * Un client porteur du jeton du gestionnaire : la RLS s'applique comme sous sa session, sans dépendre des cookies de la
 * requête. Demande à Désigno (phase 26) s'en sert pour finir une demande après la réponse (`after`), onglet fermé.
 */
export function createClientAuJeton(jeton: string) {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${jeton}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
