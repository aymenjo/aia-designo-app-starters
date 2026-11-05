import { expect, test } from "@playwright/test";
import { DELAI_DESIGNATION_JOURS } from "@/lib/avis/echeance";
import { ajouterJours, aujourdhuiParis, depuisIso } from "@/lib/dates";
import { createAdminClient } from "@/lib/supabase/admin";
import { comptesEtEntreprises, connecterNouveauCompte, emailsRecus } from "./outils";

// Alertes J-15, J-7, J-2 (phase 14) : la tâche planifiée, appelée comme Vercel l'appelle, écrit dans Mailpit.
// Les avis sont semés hors RLS, sans fichier dans le bucket.

const admin = createAdminClient();
const aujourdhui = aujourdhuiParis();
const ROUTE = "/api/cron/alertes";

/** Sème des avis dont l'échéance tombe dans `jours` jours ; renvoie les ids par n°. */
async function semer(entreprise_id: string, avis: ({ numero: string; jours: number } & Record<string, unknown>)[]) {
  const { data, error } = await admin
    .from("avis")
    .insert(
      avis.map(({ jours, ...un }) => ({
        statut: "a_traiter",
        plaque: "AL-123-ER",
        ...un,
        date_envoi: ajouterJours(aujourdhui, jours - DELAI_DESIGNATION_JOURS),
        entreprise_id,
        fichier: `${entreprise_id}/${crypto.randomUUID()}.png`,
        fichier_type: "image/png",
      })),
    )
    .select("id, numero");
  if (error) throw error;
  return Object.fromEntries(data.map(({ id, numero }) => [numero, id as string]));
}

const alertesRecues = async (email: string) =>
  (await emailsRecus(email)).filter(({ sujet }) => sujet.includes("avis à désigner"));

test("chaque matin, un seul email regroupe les avis ouverts à J-15, J-7 et J-2", async ({ page, request }) => {
  const email = await connecterNouveauCompte(page, "alertes");
  const { entreprises } = await comptesEtEntreprises(email);
  const ids = await semer(entreprises[0].id, [
    { numero: "1400000015", jours: 15 },
    { numero: "1400000007", jours: 7 },
    { numero: "1400000002", jours: 2, statut: "a_valider" },
    { numero: "1400000010", jours: 10 },
    { numero: "1400000070", jours: 7, statut: "classe", classe_le: new Date().toISOString(), motif_classement: "conteste" },
  ]);

  // Sans le secret de Vercel, la tâche est refusée, et rien ne part.
  expect((await request.get(ROUTE)).status()).toBe(401);
  expect((await request.get(ROUTE, { headers: { Authorization: "Bearer mauvais" } })).status()).toBe(401);
  expect(await alertesRecues(email)).toHaveLength(0);

  const autorise = { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } };
  const reponse = await request.get(ROUTE, autorise);
  expect(reponse.status()).toBe(200);
  expect(await reponse.json()).toMatchObject({ echecs: 0 });

  await expect.poll(async () => (await alertesRecues(email)).length).toBe(1);
  const [alerte] = await alertesRecues(email);
  expect(alerte.sujet).toBe(
    `3 avis à désigner · échéance la plus proche le ${depuisIso(ajouterJours(aujourdhui, 2)).slice(0, 5)} (J-2)`,
  );
  const liens = [...alerte.html.matchAll(/href="([^"]*\/avis\/[0-9a-f-]{36})"/g)].map(([, href]) => href);
  expect(liens).toEqual(
    ["1400000002", "1400000007", "1400000015"].map((numero) => expect.stringMatching(new RegExp(`/avis/${ids[numero]}$`))),
  );
  expect(alerte.html).not.toContain(ids["1400000010"]);
  expect(alerte.html).not.toContain(ids["1400000070"]);

  // Relancée le même jour, la tâche n'envoie rien de plus.
  expect((await request.get(ROUTE, autorise)).status()).toBe(200);
  expect(await alertesRecues(email)).toHaveLength(1);

  // Le lien de l'email ouvre l'avis.
  await page.goto(liens[0]);
  await expect(page).toHaveURL(new RegExp(`/avis/${ids["1400000002"]}$`));
  await expect(page.getByRole("main").getByText(`avant le ${depuisIso(ajouterJours(aujourdhui, 2))} · J-2`)).toBeVisible();
});
