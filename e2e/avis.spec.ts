import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { MESSAGES_AVIS } from "@/lib/avis/regles";
import { ajouterJours, aujourdhuiParis, depuisIso } from "@/lib/dates";
import { createAdminClient } from "@/lib/supabase/admin";
import { comptesEtEntreprises, connecterNouveauCompte } from "./outils";

const FICHIERS = path.join(__dirname, "fichiers");
const URL_AVIS = /\/avis\/[0-9a-f-]{36}$/;
/** Le dépôt attend la lecture IA quand le serveur a une clé d'API : les faux avis reviennent alors tout en rouge. */
const APRES_DEPOT = { timeout: 30_000 };

/** Le sélecteur de fichier (et non l'appareil photo, qui porte `capture`). */
const selecteur = (page: Page) => page.locator('input[type="file"]:not([capture])');

async function entrepriseDe(email: string) {
  const { entreprises } = await comptesEtEntreprises(email);
  return entreprises[0].id as string;
}

async function avisEnBase(id: string) {
  const { data, error } = await createAdminClient().from("avis").select("fichier, fichier_type").eq("id", id).single();
  if (error) throw error;
  return data;
}

const idDansUrl = (page: Page) => page.url().split("/").pop()!;

test("déposer un PNG, saisir les 7 champs : l'échéance suit la date d'envoi, et le statut suit les champs", async ({
  page,
}) => {
  const email = await connecterNouveauCompte(page, "avis-png");
  const { error } = await createAdminClient()
    .from("vehicule")
    .insert({ entreprise_id: await entrepriseDe(email), plaque: "AV-123-CD", modele: "Renault Master", type: "attitre" });
  if (error) throw error;

  // État vide de la liste, puis le dépôt depuis la barre latérale.
  await page.getByRole("navigation", { name: "Navigation principale" }).getByRole("link", { name: "Avis" }).click();
  await expect(page.getByText("Aucun avis pour l'instant")).toBeVisible();
  await page.getByRole("complementary").getByRole("link", { name: "Déposer un avis" }).click();
  await expect(page.getByRole("heading", { name: "Déposer un avis", level: 1 })).toBeVisible();

  await selecteur(page).setInputFiles(path.join(FICHIERS, "avis.png"));
  await expect(page).toHaveURL(URL_AVIS, APRES_DEPOT);
  await expect(page.getByRole("img", { name: "Avis de contravention déposé" })).toBeVisible();
  await expect(page.getByText("À traiter", { exact: true })).toBeVisible();

  // L'échéance se calcule à la frappe, sans enregistrer : la date d'envoi du jour donne J-45.
  const aujourdhui = aujourdhuiParis();
  await page.getByLabel("N° d'avis").fill("12 3456 7890");
  await page.getByLabel("Plaque").fill("av 123 cd");
  await page.getByLabel("Date de l'infraction").fill(depuisIso(ajouterJours(aujourdhui, -3)));
  await page.getByLabel("Heure", { exact: true }).fill("8h30");
  await page.getByLabel("Lieu").fill("A6, Auxerre, sens Paris-Province");
  await page.getByLabel("Infraction", { exact: true }).fill("Excès de vitesse inférieur à 20 km/h");
  await page.getByLabel("Montant (amende forfaitaire)").fill("135");
  await page.getByLabel("Date d'envoi").fill(depuisIso(aujourdhui));
  await expect(page.getByText(`avant le ${depuisIso(ajouterJours(aujourdhui, 45))} · J-45`)).toBeVisible();

  await page.getByLabel("Date d'envoi").fill(depuisIso(ajouterJours(aujourdhui, -1)));
  await expect(page.getByText(`avant le ${depuisIso(ajouterJours(aujourdhui, 44))} · J-44`)).toBeVisible();

  // Une date d'envoi future est signalée dès la sortie du champ.
  await page.getByLabel("Date d'envoi").fill(depuisIso(ajouterJours(aujourdhui, 1)));
  await page.getByLabel("Date d'envoi").blur();
  await expect(page.getByText(MESSAGES_AVIS.envoiFutur)).toBeVisible();
  await page.getByLabel("Date d'envoi").fill(depuisIso(ajouterJours(aujourdhui, -1)));

  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Avis enregistré.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Avis n° 1234567890", level: 1 })).toBeVisible();
  await expect(page.getByText("À valider", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Plaque")).toHaveValue("AV-123-CD");
  await expect(page.getByLabel("Montant (amende forfaitaire)")).toHaveValue("135,00");
  await expect(page.getByText("Véhicule de votre flotte :")).toBeVisible();
  await expect(page.getByText("Renault Master")).toBeVisible();

  // Un champ vidé repasse l'avis « À traiter », en nommant ce qui manque.
  await page.getByLabel("Montant (amende forfaitaire)").fill("");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("À traiter", { exact: true })).toBeVisible();
  await expect(page.getByText("L'avis passera « À valider » une fois remplis : Montant.")).toBeVisible();

  // La liste reprend l'avis, avec sa pastille d'échéance courte.
  await page.getByRole("navigation", { name: "Navigation principale" }).getByRole("link", { name: "Avis" }).click();
  const ligne = page.getByRole("link", { name: /1234567890/ });
  await expect(ligne).toContainText("AV-123-CD");
  await expect(ligne).toContainText(`avant le ${depuisIso(ajouterJours(aujourdhui, 44)).slice(0, 5)} · J-44`);
  await expect(ligne).toContainText("À traiter");
});

test("une photo HEIC est convertie en JPEG avant l'envoi, et s'affiche", async ({ page }) => {
  await connecterNouveauCompte(page, "avis-heic");
  await page.goto("/avis/nouveau");
  await selecteur(page).setInputFiles(path.join(FICHIERS, "avis.heic"));
  await expect(page).toHaveURL(URL_AVIS, APRES_DEPOT);

  const image = page.getByRole("img", { name: "Avis de contravention déposé" });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  const avis = await avisEnBase(idDansUrl(page));
  expect(avis.fichier_type).toBe("image/jpeg");
  expect(avis.fichier).toMatch(/\.jpg$/);
});

test("un PDF s'affiche dans la visionneuse du navigateur", async ({ page }) => {
  await connecterNouveauCompte(page, "avis-pdf");
  await page.goto("/avis/nouveau");
  await selecteur(page).setInputFiles(path.join(FICHIERS, "avis.pdf"));
  await expect(page).toHaveURL(URL_AVIS, APRES_DEPOT);
  await expect(page.locator('iframe[title="Fichier de l\'avis"]')).toBeVisible();
  expect((await avisEnBase(idDansUrl(page))).fichier_type).toBe("application/pdf");
});

test("un format refusé, un fichier trop lourd ou deux fichiers à la fois sont signalés, sans créer d'avis", async ({
  page,
}) => {
  await connecterNouveauCompte(page, "avis-refus");
  await page.goto("/avis/nouveau");

  await selecteur(page).setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("notes") });
  await expect(page.getByText(MESSAGES_AVIS.formatRefuse)).toBeVisible();

  await selecteur(page).setInputFiles({
    name: "scan.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(11 * 1024 * 1024),
  });
  await expect(page.getByText(MESSAGES_AVIS.fichierTropLourd)).toBeVisible();

  const deuxFichiers = await page.evaluateHandle(() => {
    const transfert = new DataTransfer();
    transfert.items.add(new File(["a"], "avis-1.png", { type: "image/png" }));
    transfert.items.add(new File(["b"], "avis-2.png", { type: "image/png" }));
    return transfert;
  });
  await page.getByText("Glissez l'avis ici").dispatchEvent("drop", { dataTransfer: deuxFichiers });
  await expect(page.getByText(MESSAGES_AVIS.unSeulFichier)).toBeVisible();

  await expect(page).toHaveURL(/\/avis\/nouveau$/);
  await page.goto("/avis");
  await expect(page.getByText("Aucun avis pour l'instant")).toBeVisible();
});

test.describe("sur téléphone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("l'appareil photo s'ouvre depuis l'écran de dépôt, sans défilement horizontal, et on enchaîne les photos", async ({
    page,
  }) => {
    await connecterNouveauCompte(page, "avis-mobile");
    await page.getByRole("link", { name: "Déposer", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Déposer un avis", level: 1 })).toBeVisible();

    const appareil = page.locator('input[type="file"][capture="environment"]');
    await expect(appareil).toHaveAttribute("accept", "image/*");
    await expect(page.getByRole("button", { name: "Photographier un avis" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Choisir un fichier" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await appareil.setInputFiles(path.join(FICHIERS, "avis.png"));
    await expect(page.getByText("Avis enregistré")).toBeVisible(APRES_DEPOT);
    await expect(page.getByRole("button", { name: "Photographier un autre avis" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.getByRole("link", { name: "Voir l'avis" }).click();
    await expect(page).toHaveURL(URL_AVIS);
    await expect(page.getByText("À traiter", { exact: true })).toBeVisible();
  });
});
