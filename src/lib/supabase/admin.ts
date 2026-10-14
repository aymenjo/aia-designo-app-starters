import { createClient } from "@supabase/supabase-js";

// Clé secrète : contourne la RLS. Réservé aux tests et aux tâches serveur,
// jamais importé par un composant.
export function createAdminClient() {
  const cle = process.env.SUPABASE_SECRET_KEY;
  if (!cle) throw new Error("SUPABASE_SECRET_KEY manquante");

  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, cle, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
