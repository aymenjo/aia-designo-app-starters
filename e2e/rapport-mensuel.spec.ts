import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { FONCTIONS_PRO } from "@/lib/abonnement/plans";
import { ajouterJours, aujourdhuiParis, depuisIso } from "@/lib/dates";
import { MESSAGES } from "@/lib/entreprise/regles";
import { MESSAGES_RAPPORT } from "@/lib/rapport/liste";
import { libelleMois, moisDuRapport } from "@/lib/rapport/synthese";
import { createAdminClient } from "@/lib/supabase/admin";
import { comptesEtEntreprises, connecterNouveauCompte, emailsRecus, nouvelEmail, passerEnPro } from "./outils";

// Le rapport mensuel (phase 25) : en Pro, le gestionnaire saisit les adresses « direction » ; la tâche du matin, appelée
// comme Vercel l'appelle, envoie le PDF du mois écoulé à la direction, avec lui en copie, dans Mailpit ; /rapports le
// garde à télécharger. En Free, tout est cadenassé. L'entreprise est antidatée : elle existait pendant le mois écoulé.

const admin = createAdminClient();
const ROUTE = "/api/cron/rapport-mensuel";
const RAPPORT_MENSUEL = FONCTIONS_PRO.find(({ nom }) => nom === "Rapport mensuel")!;
const aujourdhui = aujourdhuiParis();
const mois = moisDuRapport(aujourdhui);

test("en Free, la fiche et l'écran Rapports montrent le cadenas, et le téléchargement est refusé", async ({ page }) => {
  await connecterNouveauCompte(page, "rapport-free");

  await page.goto("/parametres/entreprise");
  await expect(page.getByRole("group", { name: RAPPORT_MENSUEL.nom })).toContainText(RAPPORT_MENSUEL.explication);
  await expect(page.getByLabel("Adresse 1")).toHaveCount(0);

  await page.getByRole("navigation", { name: "Navigation principale" }).getByRole("link", { name: "Rapports" }).click();
  await expect(page.getByRole("heading", { name: "Rapports" })).toBeVisible();
  const cadenas = page.getByRole("group", { name: RAPPORT_MENSUEL.nom });
  await expect(cadenas).toContainText(RAPPORT_MENSUEL.explication);
  await expect(cadenas.getByRole("link", { name: "Passer en Pro" })).toBeVisible();

  const reponse = await page.request.get(`/rapports/${mois.slice(0, 7)}`);
  expect(reponse.status()).toBe(403);
  expect(await reponse.text()).toBe(MESSAGES_RAPPORT.fonctionPro);
});

test("en Pro, le rapport du mois écoulé part à la direction, gestionnaire en copie, et se télécharge", async ({
  page,
  request,
}) => {
  const email = await connecterNouveauCompte(page, "rapport-pro");
  await passerEnPro(email);
  const { entreprises } = await comptesEtEntreprises(email);
  const entreprise_id = entreprises[0].id as string;
  const { error } = await admin
    .from("entreprise")
    .update({ raison_sociale: "Plomberie Martin SARL", created_at: `${ajouterJours(mois, 14)}T08:00:00Z` })
    .eq("id", entreprise_id);
  if (error) throw error;
  const dg = nouvelEmail("dg");
  const daf = nouvelEmail("daf");

  // Les adresses « direction » : vérifiées à la sortie du champ, comme les autres champs de la fiche.
  await page.goto("/parametres/entreprise");
  const adresse1 = page.getByLabel("Adresse 1");
  await adresse1.fill("dg@");
  await adresse1.blur();
  await expect(page.getByText(MESSAGES.emailMalForme)).toBeVisible();
  await adresse1.fill(dg.toUpperCase());
  await adresse1.blur();
  await expect(page.getByText(MESSAGES.emailMalForme)).toHaveCount(0);
  await expect(adresse1).toHaveValue(dg);
  const adresse2 = page.getByLabel("Adresse 2");
  await adresse2.fill(dg);
  await adresse2.blur();
  await expect(page.getByText(MESSAGES.emailDirectionDouble)).toBeVisible();
  await adresse2.fill(daf);
  await adresse2.blur();
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Fiche enregistrée.")).toBeVisible();
  const enBase = await admin.from("entreprise").select("emails_direction").eq("id", entreprise_id).single();
  expect(enBase.data?.emails_direction).toEqual([dg, daf]);

  // Avant le passage de la tâche : le rapport du mois écoulé est attendu le lendemain.
  const demain = depuisIso(ajouterJours(aujourdhui, 1));
  await page.goto("/rapports");
  await expect(page.getByText(`Prochain rapport le ${demain}, à ${dg}, ${daf}`)).toBeVisible();
  await expect(page.getByText(`Votre premier rapport arrivera le ${demain}.`)).toBeVisible();

  const autorise = { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } };
  const reponse = await request.get(ROUTE, autorise);
  expect(reponse.status()).toBe(200);

  const sujet = `Rapport de flotte – ${libelleMois(mois)}`;
  const rapportsRecus = async () => (await emailsRecus(dg)).filter((recu) => recu.sujet === sujet);
  await expect.poll(async () => (await rapportsRecus()).length).toBe(1);
  const [recu] = await rapportsRecus();
  expect(recu).toMatchObject({
    a: [dg, daf],
    cc: [email],
    repondreA: [email],
    expediteur: "Plomberie Martin SARL via Désigno",
  });
  expect(recu.texte).toContain("Le rapport complet est en pièce jointe");
  expect(recu.piecesJointes).toHaveLength(1);
  const [piece] = recu.piecesJointes;
  expect(piece).toMatchObject({ nom: `rapport-flotte-${mois.slice(0, 7)}.pdf`, type: "application/pdf" });
  expect((await piece.contenu()).subarray(0, 5).toString()).toBe("%PDF-");

  // Relancée, la tâche n'envoie rien de plus.
  expect((await request.get(ROUTE, autorise)).status()).toBe(200);
  expect(await rapportsRecus()).toHaveLength(1);

  await page.goto("/rapports");
  const ligne = page.getByRole("listitem").filter({ hasText: new RegExp(libelleMois(mois), "i") });
  await expect(ligne).toContainText("Envoyé le");
  const [telechargement] = await Promise.all([
    page.waitForEvent("download"),
    ligne.getByRole("link", { name: `Télécharger le rapport de ${libelleMois(mois)}` }).click(),
  ]);
  expect(telechargement.suggestedFilename()).toBe(`rapport-flotte-${mois.slice(0, 7)}.pdf`);
  expect((await readFile(await telechargement.path())).subarray(0, 5).toString()).toBe("%PDF-");
});
