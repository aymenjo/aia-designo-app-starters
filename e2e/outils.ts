import { expect, type Page } from "@playwright/test";
import { createAdminClient } from "@/lib/supabase/admin";

const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
/** Le sujet du lien de connexion (`supabase/config.toml`). */
const SUJET_CONNEXION = "Votre lien de connexion à Désigno";

export function nouvelEmail(prefixe: string) {
  return `${prefixe}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@exemple.fr`;
}

/** Emails reçus par `email` dans Mailpit, du plus ancien au plus récent. */
export async function emailsRecus(email: string) {
  const recherche = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
  const { messages } = (await recherche.json()) as { messages: { ID: string; Created: string; Subject: string }[] };
  const tries = [...messages].sort((a, b) => a.Created.localeCompare(b.Created));

  return Promise.all(
    tries.map(async ({ ID, Subject }) => {
      const message = (await (await fetch(`${MAILPIT}/api/v1/message/${ID}`)).json()) as {
        From: { Name: string; Address: string };
        To: { Address: string }[] | null;
        Cc: { Address: string }[] | null;
        ReplyTo: { Address: string }[] | null;
        HTML: string;
        Text: string;
        Attachments: { PartID: string; FileName: string; ContentType: string }[] | null;
      };
      return {
        id: ID,
        sujet: Subject,
        expediteur: message.From.Name,
        a: (message.To ?? []).map(({ Address }) => Address),
        cc: (message.Cc ?? []).map(({ Address }) => Address),
        repondreA: (message.ReplyTo ?? []).map(({ Address }) => Address),
        html: message.HTML,
        texte: message.Text,
        piecesJointes: (message.Attachments ?? []).map(({ PartID, FileName, ContentType }) => ({
          nom: FileName,
          type: ContentType,
          /** Le contenu de la pièce jointe, lu dans Mailpit. */
          contenu: async () => {
            const partie = await fetch(`${MAILPIT}/api/v1/message/${ID}/part/${PartID}`);
            return Buffer.from(await partie.arrayBuffer());
          },
        })),
      };
    }),
  );
}

/** Liens de connexion reçus par `email`, du plus ancien au plus récent. Les autres emails (alertes) sont ignorés. */
async function liensRecus(email: string) {
  const connexions = (await emailsRecus(email)).filter(({ sujet }) => sujet === SUJET_CONNEXION);
  return connexions.map(({ id, html }) => {
    const href = html.match(/href="([^"]*\/connexion\/confirmer\?[^"]*)"/)?.[1];
    if (!href) throw new Error(`Aucun lien de connexion dans le message ${id}`);
    return href.replaceAll("&amp;", "&");
  });
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

/**
 * Passe l'entreprise du compte en Pro sans Stripe, comme le webhook : ses véhicules et ses avis ne sont plus limités.
 * Pour les tests qui sèment plus de 3 véhicules actifs ou plus de 5 avis par mois ; le parcours du paiement est dans
 * passage-pro.spec.ts.
 */
export async function passerEnPro(email: string) {
  const { entreprises } = await comptesEtEntreprises(email);
  const { error } = await createAdminClient()
    .from("entreprise")
    .update({ plan: "pro" })
    .in(
      "id",
      entreprises.map(({ id }) => id),
    );
  if (error) throw error;
}

/** Crée un compte neuf et ouvre sa session : la page arrive sur le tableau de bord. */
export async function connecterNouveauCompte(page: Page, prefixe: string) {
  const email = nouvelEmail(prefixe);
  await demanderLien(page, email);
  await seConnecterAvec(page, await attendreNouveauLien(email));
  await expect(page).toHaveURL(/\/tableau-de-bord$/);
  return email;
}
