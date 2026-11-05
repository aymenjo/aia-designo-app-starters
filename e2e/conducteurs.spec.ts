import { expect, test, type Page } from "@playwright/test";
import { connecterNouveauCompte } from "./outils";

const nav = (page: Page) => page.getByRole("navigation", { name: "Navigation principale" });

/** Ajoute un conducteur depuis la liste : la fenêtre mène à sa fiche. */
async function ajouter(page: Page, civilite: "M." | "Mme", prenom: string, nom: string) {
  await page.getByRole("button", { name: "Ajouter un conducteur" }).click();
  const fenetre = page.getByRole("dialog", { name: "Ajouter un conducteur" });
  await fenetre.getByRole("radio", { name: civilite }).check();
  await fenetre.getByLabel("Prénom").fill(prenom);
  await fenetre.getByLabel("Nom", { exact: true }).fill(nom);
  await fenetre.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(page.getByRole("heading", { name: `${prenom} ${nom}`, level: 1 })).toBeVisible();
}

const ligne = (page: Page, nom: string) => page.getByRole("link", { name: new RegExp(nom) });

test("ajouter un conducteur, compléter sa fiche, l'archiver puis le réactiver", async ({ page }) => {
  await connecterNouveauCompte(page, "conducteurs");
  await nav(page).getByRole("link", { name: "Conducteurs" }).click();

  // 1. État vide
  await expect(page.getByRole("heading", { name: "Conducteurs", level: 1 })).toBeVisible();
  await expect(page.getByText("Aucun conducteur pour l'instant")).toBeVisible();

  // 2. Ajout en trois champs, puis la fiche liste ce qui manque
  await ajouter(page, "M.", "Karim", "Benali");
  await expect(page.getByText("Incomplète · 6 champs")).toBeVisible();
  await expect(page.getByText("Pour ouvrir le récap ANTAI, complétez :")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Date de délivrance du permis" })).toBeVisible();

  // 3. Erreurs signalées à la sortie du champ, effacées une fois corrigées
  const naissance = page.getByLabel("Date de naissance");
  await naissance.fill("31021985");
  await naissance.blur();
  await expect(naissance).toHaveValue("31/02/1985");
  await expect(page.getByText("Le 31/02/1985 n'existe pas.")).toBeVisible();
  await naissance.fill("12031985");
  await expect(page.getByText("Le 31/02/1985 n'existe pas.")).toBeHidden();
  await naissance.blur();
  await expect(naissance).toHaveValue("12/03/1985");

  const delivrance = page.getByLabel("Date de délivrance");
  const tropTot = page.getByText("Le permis ne peut pas avoir été délivré avant les 14 ans du conducteur.");
  await delivrance.fill("01/01/1990");
  await delivrance.blur();
  await expect(tropTot).toBeVisible();
  await delivrance.fill("4/6/2004");
  await expect(tropTot).toBeHidden();

  const categories = page.getByLabel("Catégories");
  await categories.fill("b, x");
  await categories.blur();
  await expect(page.getByText("Catégorie inconnue : X. Attendu, par exemple : B, C1, CE.")).toBeVisible();
  await categories.fill("c1 b");
  await categories.blur();
  await expect(categories).toHaveValue("B, C1");

  const permis = page.getByLabel("N° de permis");
  await permis.fill("1234 5678 9012");
  await permis.blur();
  await expect(permis).toHaveValue("123456789012");

  // 4. Le reste de la fiche : elle devient complète, sans email
  await page.getByLabel("Adresse", { exact: true }).fill("8 rue des Peupliers");
  await page.getByLabel("Code postal").fill("69 003");
  await page.getByLabel("Ville").fill("Lyon");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Fiche enregistrée.")).toBeVisible();
  await expect(page.getByText("Fiche complète")).toBeVisible();
  await expect(page.getByText("Pour ouvrir le récap ANTAI, complétez :")).toBeHidden();
  await expect(delivrance).toHaveValue("04/06/2004");

  // 5. La liste affiche le conducteur, son permis et son badge
  await nav(page).getByRole("link", { name: "Conducteurs" }).click();
  await expect(page.getByText("1 conducteur", { exact: true })).toBeVisible();
  await expect(ligne(page, "Karim Benali")).toContainText("123456789012");
  await expect(ligne(page, "Karim Benali")).toContainText("Fiche complète");

  // 6. Un second conducteur ne peut pas reprendre le même permis
  await ajouter(page, "Mme", "Léa", "Martin");
  await permis.fill("123456789012");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Ce n° de permis est déjà celui de Karim Benali.")).toBeVisible();
  await expect(page.getByText("Fiche non enregistrée : corrigez les champs signalés.")).toBeVisible();

  // 7. Archivage : le conducteur quitte la liste
  await nav(page).getByRole("link", { name: "Conducteurs" }).click();
  await expect(page.getByText("2 conducteurs · 1 fiche incomplète")).toBeVisible();
  await ligne(page, "Karim Benali").click();
  await page.getByRole("button", { name: "Archiver ce conducteur" }).click();
  await page
    .getByRole("dialog", { name: "Archiver Karim Benali ?" })
    .getByRole("button", { name: "Archiver", exact: true })
    .click();
  await expect(page.getByText(/^Archivé le \d{2}\/\d{2}\/\d{4}$/)).toBeVisible();
  await expect(page.getByLabel("N° de permis")).toBeDisabled();

  await nav(page).getByRole("link", { name: "Conducteurs" }).click();
  await expect(ligne(page, "Karim Benali")).toHaveCount(0);
  await expect(page.getByText("1 conducteur · 1 fiche incomplète")).toBeVisible();

  // 8. Ressaisir son permis mène à sa fiche, d'où « Réactiver »
  await ligne(page, "Léa Martin").click();
  await permis.fill("1234-5678-9012");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Ce n° de permis appartient à Karim Benali, conducteur archivé.")).toBeVisible();
  await page.getByRole("link", { name: "Ouvrir sa fiche" }).click();

  await expect(page.getByRole("heading", { name: "Karim Benali", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Réactiver" }).click();
  await expect(page.getByRole("button", { name: "Archiver ce conducteur" })).toBeVisible();

  await nav(page).getByRole("link", { name: "Conducteurs" }).click();
  await expect(page.getByText("2 conducteurs · 1 fiche incomplète")).toBeVisible();
  await expect(ligne(page, "Karim Benali")).toContainText("Fiche complète");
});

test("une fiche conducteur inconnue affiche la page introuvable", async ({ page }) => {
  await connecterNouveauCompte(page, "conducteur-inconnu");
  await page.goto("/flotte/conducteurs/pas-un-id");
  await expect(page.getByRole("heading", { name: "Cette page n'existe pas" })).toBeVisible();
  await page.goto("/flotte/conducteurs/00000000-0000-4000-8000-000000000000");
  await expect(page.getByRole("heading", { name: "Cette page n'existe pas" })).toBeVisible();
});
