import { expect, type Page } from "@playwright/test";
import { createAdminClient } from "@/lib/supabase/admin";

const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

export function nouvelEmail(prefixe: string) {
  return `${prefixe}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@exemple.fr`;
}

/** Liens de connexion reçus par `email` dans Mailpit, du plus ancien au plus récent. */
async function liensRecus(email: string) {
  const recherche = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
  const { messages } = (await recherche.json()) as { messages: { ID: string; Created: string }[] };
  const tries = [...messages].sort((a, b) => a.Created.localeCompare(b.Created));

  return Promise.all(
    tries.map(async ({ ID }) => {
      const message = (await (await fetch(`${MAILPIT}/api/v1/message/${ID}`)).json()) as { HTML: string };
      const href = message.HTML.match(/href="([^"]*\/connexion\/confirmer\?[^"]*)"/)?.[1];
      if (!href) throw new Error(`Aucun lien de connexion dans le message ${ID}`);
      return href.replaceAll("&amp;", "&");
    }),
  );
}

/** Attend le (dejaRecus + 1)-ième lien envoyé à `email` et le renvoie. */
export async function attendreNouveauLien(email: string, dejaRecus = 0) {
  let liens: string[] = [];
  await expect
    .poll(async () => (liens = await liensRecus(email)).length, { timeout: 15_000 })
    .toBeGreaterThan(dejaRecus);
  // Supabase refuse un second email à la même adresse moins d'1 s après (max_frequency local) :
  // sans cette pause, un renvoi enchaîné par le test recevrait un 429.
  await new Promise((fin) => setTimeout(fin, 1_100));
  return liens[liens.length - 1];
}

export async function demanderLien(page: Page, email: string) {
  await page.goto("/connexion");
  await page.getByLabel("Adresse email").fill(email);
  await page.getByRole("button", { name: "Recevoir mon lien" }).click();
  await expect(page.getByRole("heading", { name: "Vérifiez votre boîte mail" })).toBeVisible();
}

export async function seConnecterAvec(page: Page, lien: string) {
  await page.goto(lien);
  await page.getByRole("button", { name: "Se connecter" }).click();
}

/** Comptes et entreprises en base pour `email` (clé secrète, hors RLS). */
export async function comptesEtEntreprises(email: string) {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  const comptes = data.users.filter((u) => u.email === email);
  const { data: entreprises, error: erreurEntreprises } = await admin
    .from("entreprise")
    .select("id, user_id")
    .in(
      "user_id",
      comptes.map((c) => c.id),
    );
  if (erreurEntreprises) throw erreurEntreprises;
  return { comptes, entreprises };
}

/** Crée un compte neuf et ouvre sa session : la page arrive sur le tableau de bord. */
export async function connecterNouveauCompte(page: Page, prefixe: string) {
  const email = nouvelEmail(prefixe);
  await demanderLien(page, email);
  await seConnecterAvec(page, await attendreNouveauLien(email));
  await expect(page).toHaveURL(/\/tableau-de-bord$/);
  return email;
}
