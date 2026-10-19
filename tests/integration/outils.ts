import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { BUCKET_AVIS, creerAvis } from "@/lib/avis/avis";
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

/**
 * Passe l'entreprise en Pro, comme le fera le webhook Stripe (phase 18) : ses véhicules et ses avis ne sont plus limités.
 * Pour les tests qui semment plus de 3 véhicules actifs ou plus de 5 avis par mois.
 */
export async function passerEnPro(entrepriseId: string) {
  const { error } = await admin.from("entreprise").update({ plan: "pro" }).eq("id", entrepriseId);
  if (error) throw error;
}

export function suffixeUnique() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Supprime le compte et son entreprise, et vide son dossier d'avis. */
export async function supprimerGestionnaire(g: Gestionnaire) {
  // Les fichiers ne partent pas avec l'entreprise : la suppression de compte (phase 20) videra le dossier.
  const { data } = await admin.storage.from(BUCKET_AVIS).list(g.entrepriseId);
  if (data?.length) await admin.storage.from(BUCKET_AVIS).remove(data.map((f) => `${g.entrepriseId}/${f.name}`));
  await admin.auth.admin.deleteUser(g.userId);
}

// Avis

// Un PNG de 1 × 1 pixel.
export const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

export function cheminAvis(g: Gestionnaire, extension = "png") {
  return `${g.entrepriseId}/${crypto.randomUUID()}.${extension}`;
}

/** Envoie un fichier au bucket sous la session du gestionnaire, comme le navigateur. */
export async function envoyerFichierAvis(g: Gestionnaire, contenu: Buffer = PNG, type = "image/png", extension = "png") {
  const cheminFichier = cheminAvis(g, extension);
  const { error } = await g.client.storage.from(BUCKET_AVIS).upload(cheminFichier, contenu, { contentType: type });
  if (error) throw error;
  return cheminFichier;
}

/** Dépose un avis comme l'écran : fichier dans le bucket, puis création de l'avis. */
export async function deposerAvis(g: Gestionnaire, nom = "avis.png") {
  const cheminFichier = await envoyerFichierAvis(g);
  const depot = await creerAvis(g.client, { chemin: cheminFichier, nom });
  if (!depot.ok) throw new Error(`dépôt : ${depot.erreur}`);
  return { id: depot.id, chemin: cheminFichier };
}

/** La ligne de l'avis en base, hors RLS ; `null` s'il n'existe plus. */
export async function avisEnBase(id: string) {
  const { data } = await admin.from("avis").select("*").eq("id", id).maybeSingle();
  return data;
}
