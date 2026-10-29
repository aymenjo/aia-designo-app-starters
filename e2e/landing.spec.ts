import { expect, test } from "@playwright/test";
import { connecterNouveauCompte } from "./outils";

const ETAPES = [
  "Transférez vos avis",
  "L'IA les lit",
  "Désigno retrouve le conducteur",
  "Vous désignez sur l'ANTAI, sans oubli",
];

const QUESTIONS_REQUISES = [
  "Désigno désigne-t-il à ma place ?",
  "Mes données sont-elles protégées ?",
  "Que se passe-t-il si je dépasse le plan Free ?",
  "L'agent peut-il modifier mes données sans mon accord ?",
];

const sansDefilementHorizontal = () => document.documentElement.scrollWidth <= window.innerWidth;

test("sans session, la landing présente la promesse, les 4 étapes, les tarifs et la FAQ, puis mène à /connexion", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Ne laissez plus jamais filer une échéance de désignation" }),
  ).toBeVisible();

  for (const etape of ETAPES) {
    await expect(page.getByRole("heading", { level: 3, name: etape, exact: true })).toBeVisible();
  }

  const tarifs = page.locator("#tarifs");
  await expect(tarifs.getByText("0 €", { exact: true })).toBeVisible();
  await expect(tarifs.getByText("49 € HT")).toBeVisible();
  await expect(tarifs.getByText("58,80 € TTC")).toBeVisible();
  await expect(tarifs.getByText(/une seule amende évitée paie plus d'un an d'abonnement/i)).toBeVisible();

  for (const question of QUESTIONS_REQUISES) {
    await expect(page.getByText(question, { exact: true })).toBeVisible();
  }
  const reponse = page.getByText(/c'est vous qui validez le conducteur et qui désignez sur le site de l'ANTAI/);
  await expect(reponse).toBeHidden();
  await page.getByText(QUESTIONS_REQUISES[0], { exact: true }).click();
  await expect(reponse).toBeVisible();

  await page.getByRole("main").getByRole("link", { name: "Essayer gratuitement" }).first().click();
  await expect(page).toHaveURL(/\/connexion$/);
  await expect(page.getByRole("heading", { name: "Connexion" })).toBeVisible();
});

test.describe("sur téléphone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("la landing s'affiche sans défilement horizontal, avec le CTA visible", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("main").getByRole("link", { name: "Essayer gratuitement" }).first()).toBeVisible();
    await expect(page.getByRole("banner").getByRole("link", { name: "Se connecter" })).toBeVisible();
    expect(await page.evaluate(sansDefilementHorizontal)).toBe(true);
  });
});

test("connecté, / mène au tableau de bord", async ({ page }) => {
  await connecterNouveauCompte(page, "landing");
  await page.goto("/");
  await expect(page).toHaveURL(/\/tableau-de-bord$/);
});
