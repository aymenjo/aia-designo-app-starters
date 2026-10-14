import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

// Nécessite le Supabase local : npx supabase start, puis npm run env:local.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const clePublique = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
export const admin = createAdminClient();

export function nouveauClient() {
  return createClient(url, clePublique, { auth: { persistSession: false, autoRefreshToken: false } });
}

export type Gestionnaire = { client: SupabaseClient; userId: string; entrepriseId: string };

/** Crée le compte par un lien de connexion, comme à la première connexion, et ouvre sa session. */
export async function premiereConnexion(email: string): Promise<Gestionnaire> {
  const lien = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (lien.error) throw lien.error;

  const client = nouveauClient();
  const { data, error } = await client.auth.verifyOtp({
    type: "email",
    token_hash: lien.data.properties.hashed_token,
  });
  if (error || !data.user) throw error ?? new Error("Aucun utilisateur");

  const entreprise = await admin.from("entreprise").select("id").eq("user_id", data.user.id).single();
  if (entreprise.error) throw entreprise.error;
  return { client, userId: data.user.id, entrepriseId: entreprise.data.id };
}

export function suffixeUnique() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
