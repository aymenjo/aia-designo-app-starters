import { expect, test, type Page } from "@playwright/test";
import { connecterNouveauCompte } from "./outils";

async function ouvrirAjout(page: Page) {
  await page.getByRole("button", { name: "Ajouter un véhicule" }).click();
  const fenetre = page.getByRole("dialog", { name: "Ajouter un véhicule" });
  await expect(fenetre).toBeVisible();
  return fenetre;
}

async function ajouter(page: Page, plaque: string, modele: string, type: "Attitré" | "Pool") {
  const fenetre = await ouvrirAjout(page);
  await fenetre.getByLabel("Plaque").fill(plaque);
  await fenetre.getByLabel("Modèle").fill(modele);
  await fenetre.getByRole("radio", { name: type }).check();
  await fenetre.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(fenetre).toBeHidden();
}

const ligne = (page: Page, plaque: string) => page.getByRole("link", { name: new RegExp(plaque) });

test("ajouter, modifier, archiver puis réactiver un véhicule", async ({ page }) => {
  await connecterNouveauCompte(page, "vehicules");
  await page.getByRole("navigation").getByRole("link", { name: "Véhicules" }).click();

  // 1. État vide
  await expect(page.getByRole("heading", { name: "Véhicules", level: 1 })).toBeVisible();
  await expect(page.getByText("Aucun véhicule pour l'instant")).toBeVisible();

  // 2 et 3. Ajouts : la plaque est affichée en majuscules avec tirets
  await ajouter(page, "ab 123 cd", "Renault Master", "Attitré");
  await expect(ligne(page, "AB-123-CD")).toContainText("Renault Master");
  await expect(ligne(page, "AB-123-CD")).toContainText("Attitré");

  await ajouter(page, "123 abc 45", "Peugeot Partner", "Pool");
  await expect(ligne(page, "123-ABC-45")).toContainText("Pool");
  await expect(page.getByText("2 véhicules")).toBeVisible();

  // 4. Doublon et format, puis Échap ferme la fenêtre
  const fenetre = await ouvrirAjout(page);
  await expect(fenetre.getByLabel("Plaque")).toBeFocused();
  await fenetre.getByLabel("Plaque").fill("AB123CD");
  await fenetre.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(fenetre.getByText("La plaque AB-123-CD est déjà dans votre flotte.")).toBeVisible();

  await fenetre.getByLabel("Plaque").fill("AB-12-CD");
  await fenetre.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(fenetre.getByText("Plaque mal formée : attendu AB-123-CD ou 123 ABC 45.")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(fenetre).toBeHidden();

  // 5. Modification sur la fiche
  await ligne(page, "AB-123-CD").click();
  await expect(page.getByRole("heading", { name: "AB-123-CD", level: 1 })).toBeVisible();
  await page.getByLabel("Modèle").fill("Renault Master L2H2");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Modifications enregistrées.")).toBeVisible();
  await expect(page.getByLabel("Modèle")).toHaveValue("Renault Master L2H2");

  // 6. Archivage : le véhicule quitte la liste
  await page.getByRole("button", { name: "Archiver ce véhicule" }).click();
  const confirmation = page.getByRole("dialog", { name: "Archiver AB-123-CD ?" });
  await confirmation.getByRole("button", { name: "Archiver", exact: true }).click();
  await expect(page.getByText(/^Archivé le \d{2}\/\d{2}\/\d{4}$/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Réactiver" })).toBeVisible();

  await page.getByRole("navigation").getByRole("link", { name: "Véhicules" }).click();
  await expect(ligne(page, "123-ABC-45")).toBeVisible();
  await expect(ligne(page, "AB-123-CD")).toHaveCount(0);
  await expect(page.getByText("1 véhicule", { exact: true })).toBeVisible();

  // 7. Ressaisir la plaque archivée mène à sa fiche, d'où « Réactiver »
  const nouvelle = await ouvrirAjout(page);
  await nouvelle.getByLabel("Plaque").fill("ab-123-cd");
  await nouvelle.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(nouvelle.getByText("AB-123-CD appartient à un véhicule archivé.")).toBeVisible();
  await nouvelle.getByRole("link", { name: "Ouvrir sa fiche" }).click();

  await expect(page.getByRole("heading", { name: "AB-123-CD", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Réactiver" }).click();
  await expect(page.getByRole("button", { name: "Archiver ce véhicule" })).toBeVisible();

  await page.getByRole("navigation").getByRole("link", { name: "Véhicules" }).click();
  await expect(ligne(page, "AB-123-CD")).toContainText("Renault Master L2H2");
  await expect(page.getByText("2 véhicules")).toBeVisible();
});

test("une fiche inconnue affiche la page introuvable", async ({ page }) => {
  await connecterNouveauCompte(page, "vehicule-inconnu");
  await page.goto("/flotte/vehicules/pas-un-id");
  await expect(page.getByRole("heading", { name: "Cette page n'existe pas" })).toBeVisible();
  await page.goto("/flotte/vehicules/00000000-0000-4000-8000-000000000000");
  await expect(page.getByRole("heading", { name: "Cette page n'existe pas" })).toBeVisible();
});
