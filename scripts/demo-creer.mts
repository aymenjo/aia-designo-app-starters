// Un compte de démonstration pour essayer Demande à Désigno en développement (phase 26) : `npm run demo:creer [email]`.
// Le script crée le compte sur le Supabase local, puis la flotte de l'évaluation (evaluation/agent/flotte-demo.ts) :
// 15 véhicules, 15 conducteurs, le planning de mai à octobre 2026 et 40 avis, en Pro. Lancé par Node seul ; l'URL et la
// clé secrète sont lues dans .env.local (`npm run env:local`).
import { createClient } from "@supabase/supabase-js";
import { AUJOURDHUI_DEMO, creerFlotteDemo } from "../evaluation/agent/flotte-demo.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const cle = process.env.SUPABASE_SECRET_KEY;
if (!url || !cle) {
  console.error("NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SECRET_KEY manquante : lance `npx supabase start`, puis `npm run env:local`.");
  process.exit(1);
}
// La démo sème des données fictives : jamais ailleurs que sur le Supabase local.
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) {
  console.error(`Refusé : ${url} n'est pas le Supabase local.`);
  process.exit(1);
}

const admin = createClient(url, cle, { auth: { autoRefreshToken: false, persistSession: false } });
const email = process.argv[2] ?? `demo-${Date.now()}@exemple.fr`;

const cree = await admin.auth.admin.createUser({ email, email_confirm: true });
if (cree.error) throw cree.error;
// L'entreprise est créée avec l'utilisateur, par le trigger de la première connexion.
const entreprise = await admin.from("entreprise").select("id").eq("user_id", cree.data.user.id).single();
if (entreprise.error) throw entreprise.error;

// Un PNG de 1 × 1 pixel : le fichier de chaque avis.
const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const ids = await creerFlotteDemo(admin, entreprise.data.id, image);

console.log(`Compte de démonstration ${email} : ${Object.keys(ids.vehicules).length} véhicules, ${Object.keys(ids.conducteurs).length} conducteurs, ${Object.keys(ids.avis).length} avis, en Pro.

Connecte-toi sur http://127.0.0.1:3000/connexion avec cette adresse : le lien arrive dans Mailpit (http://127.0.0.1:54324).
Les dates de la démo sont fixées autour du ${AUJOURDHUI_DEMO.split("-").reverse().join("/")} : les échéances se lisent par rapport à ce jour-là.
Demande à Désigno répond si ANTHROPIC_AGENT_ID et ANTHROPIC_ENVIRONMENT_ID sont dans .env.development.local (npm run agent:config).`);
