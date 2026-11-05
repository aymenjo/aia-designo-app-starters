import { expect, test } from "@playwright/test";
import { connecterNouveauCompte } from "./outils";

test("renseigner la fiche entreprise, avec les contrôles dès la saisie", async ({ page }) => {
  await connecterNouveauCompte(page, "entreprise");

  // 1. Fiche vide : la barre haute invite à la renseigner
  const barreHaute = page.getByRole("banner");
  await barreHaute.getByRole("link", { name: "Renseigner votre entreprise" }).click();
  await expect(page.getByRole("heading", { name: "Fiche entreprise", level: 1 })).toBeVisible();
  await expect(page.getByText("Incomplète · 9 champs")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Réglages" }).getByRole("link", { name: "Paramètres" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  // 2. SIREN faux, signalé à la sortie du champ, effacé dès qu'il est juste
  const siren = page.getByLabel("SIREN");
  const tva = page.getByLabel("N° de TVA intracommunautaire");
  await siren.fill("404 833 049");
  await siren.blur();
  await expect(page.getByText("SIREN invalide : l'un des 9 chiffres est sans doute erroné.")).toBeVisible();
  await siren.fill("404 833 048");
  await expect(page.getByText("SIREN invalide : l'un des 9 chiffres est sans doute erroné.")).toBeHidden();

  // 3. À la sortie, le SIREN est réécrit et la TVA proposée
  await siren.blur();
  await expect(siren).toHaveValue("404833048");
  await expect(tva).toHaveValue("FR83404833048");

  // 4. Une TVA d'un autre SIREN est signalée et bloque l'enregistrement
  await tva.fill("FR44732829320");
  await tva.blur();
  const tvaIncoherente = page.getByText("Ce n° de TVA ne correspond pas au SIREN. Attendu : FR83404833048.");
  await expect(tvaIncoherente).toBeVisible();
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Fiche non enregistrée : corrigez les champs signalés.")).toBeVisible();
  await expect(tvaIncoherente).toBeVisible();

  // 5. Une fiche incomplète s'enregistre ; la raison sociale remplace l'invitation dans la barre haute
  await tva.fill("fr 83 404 833 048");
  await expect(tvaIncoherente).toBeHidden();
  await page.getByLabel("Raison sociale").fill("Plomberie Martin SARL");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Fiche enregistrée.")).toBeVisible();
  await expect(tva).toHaveValue("FR83404833048");
  await expect(page.getByText("Incomplète · 6 champs")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Ville du siège" })).toBeVisible();
  await expect(barreHaute.getByRole("link", { name: "Plomberie Martin SARL" })).toBeVisible();

  // 6. Le reste de la fiche : elle devient complète, sans complément d'adresse
  await page.getByLabel("Prénom").fill("Claire");
  await page.getByLabel("Nom", { exact: true }).fill("Martin");
  await page.getByLabel("Fonction").fill("Gérante");
  await page.getByLabel("Adresse", { exact: true }).fill("12 rue des Lilas");
  const codePostal = page.getByLabel("Code postal");
  await codePostal.fill("6900");
  await codePostal.blur();
  await expect(page.getByText("Code postal mal formé : attendu 5 chiffres.")).toBeVisible();
  await codePostal.fill("69 003");
  await page.getByLabel("Ville").fill("Lyon");
  await page.getByRole("button", { name: "Enregistrer" }).click();

  await expect(page.getByText("Fiche complète")).toBeVisible();
  await expect(page.getByText("Pour ouvrir le récap ANTAI et passer en Pro, complétez :")).toBeHidden();

  // 7. Tout est relu depuis la base
  await page.reload();
  await expect(page.getByText("Fiche complète")).toBeVisible();
  await expect(siren).toHaveValue("404833048");
  await expect(codePostal).toHaveValue("69003");
  await expect(page.getByLabel("Fonction")).toHaveValue("Gérante");
});
