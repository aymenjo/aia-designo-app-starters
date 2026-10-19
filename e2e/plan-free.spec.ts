import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { FONCTIONS_PRO, LIMITES_FREE } from "@/lib/abonnement/plans";
import { MESSAGES_AVIS } from "@/lib/avis/regles";
import { ajouterJours, aujourdhuiParis, depuisIso } from "@/lib/dates";
import { MESSAGES } from "@/lib/flotte/regles";
import { createAdminClient } from "@/lib/supabase/admin";
import { comptesEtEntreprises, connecterNouveauCompte } from "./outils";

// Le plan Free (phase 17) : les quotas semés hors RLS, sans fichier dans le bucket, puis le geste de trop à l'écran.

const admin = createAdminClient();
const FICHIERS = path.join(__dirname, "fichiers");
const URL_AVIS = /\/avis\/[0-9a-f-]{36}$/;
/** Le sélecteur de fichier (et non l'appareil photo, qui porte `capture`). */
const selecteur = (page: Page) => page.locator('input[type="file"]:not([capture])');

async function entrepriseDe(email: string) {
  const { entreprises } = await comptesEtEntreprises(email);
  return entreprises[0].id as string;
}

/** Les avis du quota du mois, déposés maintenant. */
async function semerAvisDuMois(entreprise_id: string) {
  const { error } = await admin.from("avis").insert(
    Array.from({ length: LIMITES_FREE.avisParMois }, () => ({
      entreprise_id,
      fichier: `${entreprise_id}/${crypto.randomUUID()}.png`,
      fichier_type: "image/png",
    })),
  );
  if (error) throw error;
}

const compteur = (page: Page) => page.getByRole("banner").getByRole("link", { name: /véhicules/ });

test("le compteur d'usage est toujours dans la barre haute, et mène à l'abonnement", async ({ page }) => {
  await connecterNouveauCompte(page, "plan-free-compteur");
  await expect(compteur(page)).toHaveText(
    `0/${LIMITES_FREE.vehicules} véhicules0/${LIMITES_FREE.avisParMois} avis ce mois-ci`,
  );

  await page.getByRole("navigation", { name: "Navigation principale" }).getByRole("link", { name: "Véhicules" }).click();
  await page.getByRole("button", { name: "Ajouter un véhicule" }).click();
  const fenetre = page.getByRole("dialog", { name: "Ajouter un véhicule" });
  await fenetre.getByLabel("Plaque").fill("PF-101-AA");
  await fenetre.getByRole("button", { name: "Ajouter" }).click();
  await expect(compteur(page)).toContainText(`1/${LIMITES_FREE.vehicules} véhicules`);

  await compteur(page).click();
  await expect(page).toHaveURL(/\/parametres\/abonnement$/);
});

test(`avec ${LIMITES_FREE.vehicules} véhicules actifs, l'ajout et la réactivation invitent à passer en Pro`, async ({
  page,
}) => {
  const email = await connecterNouveauCompte(page, "plan-free-vehicules");
  const entreprise_id = await entrepriseDe(email);
  const { data, error } = await admin
    .from("vehicule")
    .insert([
      { entreprise_id, plaque: "PF-201-AA", type: "attitre", archive_le: new Date().toISOString() },
      ...Array.from({ length: LIMITES_FREE.vehicules }, (_, n) => ({
        entreprise_id,
        plaque: `PF-${211 + n}-AA`,
        type: "attitre",
      })),
    ])
    .select("id, plaque");
  if (error) throw error;
  const archive = data.find(({ plaque }) => plaque === "PF-201-AA")!;

  await page.goto("/flotte/vehicules");
  await expect(compteur(page)).toContainText(`${LIMITES_FREE.vehicules}/${LIMITES_FREE.vehicules} véhicules`);
  await page.getByRole("button", { name: "Ajouter un véhicule" }).click();
  const fenetre = page.getByRole("dialog", { name: "Ajouter un véhicule" });
  await expect(fenetre.getByRole("group", { name: "Véhicules illimités" })).toContainText(MESSAGES.limiteVehicules);
  await expect(fenetre.getByLabel("Plaque")).toHaveCount(0);
  await expect(fenetre.getByRole("link", { name: "Passer en Pro" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.goto(`/flotte/vehicules/${archive.id}`);
  await page.getByRole("button", { name: "Réactiver" }).click();
  const refus = page.getByRole("main").getByRole("alert");
  await expect(refus).toContainText(MESSAGES.limiteVehiculesReactivation);
  await refus.getByRole("link", { name: "Passer en Pro" }).click();
  await expect(page).toHaveURL(/\/parametres\/abonnement$/);
});

test(`à l'import, les véhicules au-delà du ${LIMITES_FREE.vehicules}e sont listés comme non importés`, async ({ page }) => {
  await connecterNouveauCompte(page, "plan-free-import");
  await page.goto("/flotte/import");
  const plaques = Array.from({ length: LIMITES_FREE.vehicules + 2 }, (_, n) => `PF-${301 + n}-AA`);
  await page.locator('input[type="file"]').setInputFiles({
    name: "vehicules.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(["Plaque;Type", ...plaques.map((plaque) => `${plaque};Attitré`)].join("\r\n")),
  });

  const fichier = page.locator("section").filter({ has: page.getByRole("heading", { level: 2, name: /^Fichier véhicules/ }) });
  await expect(fichier).toContainText(`2 non importés · limite Free · ${LIMITES_FREE.vehicules} à importer`);
  await expect(page.getByRole("main").getByRole("status").filter({ hasText: "2 véhicules non importés" })).toBeVisible();
  await page.getByRole("button", { name: `Importer ${LIMITES_FREE.vehicules} lignes` }).click();
  await expect(page.getByText(`${LIMITES_FREE.vehicules} véhicules ajoutés`)).toBeVisible();
  await expect(fichier.getByRole("listitem").filter({ hasText: plaques.at(-1)! })).toContainText(
    "Ce véhicule n'est pas importé",
  );
  await expect(compteur(page)).toContainText(`${LIMITES_FREE.vehicules}/${LIMITES_FREE.vehicules} véhicules`);
});

test(`le ${LIMITES_FREE.avisParMois + 1}e avis du mois est verrouillé : il se saisit, mais ni proposition ni récap`, async ({
  page,
}) => {
  const email = await connecterNouveauCompte(page, "plan-free-avis");
  await semerAvisDuMois(await entrepriseDe(email));

  await page.goto("/avis/nouveau");
  await expect(compteur(page)).toContainText(`${LIMITES_FREE.avisParMois}/${LIMITES_FREE.avisParMois} avis ce mois-ci`);
  await selecteur(page).setInputFiles(path.join(FICHIERS, "avis.png"));
  await expect(page).toHaveURL(URL_AVIS);

  await expect(page.getByRole("main").getByText("Verrouillé", { exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: "Lecture IA, conducteur proposé et récap ANTAI" })).toContainText(
    "saisissez au moins la plaque et la date d'envoi",
  );
  // Ni lecture IA : le formulaire est vide, et se remplit à la main.
  await expect(page.getByLabel("Plaque")).toHaveValue("");
  await page.getByLabel("Plaque").fill("AB-123-CD");
  const aujourdhui = aujourdhuiParis();
  await page.getByLabel("Date d'envoi").fill(depuisIso(aujourdhui));
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Avis enregistré.")).toBeVisible();
  await expect(page.getByText(`avant le ${depuisIso(ajouterJours(aujourdhui, 45))} · J-45`)).toBeVisible();
  // Ni conducteur proposé, ni véhicule à créer : seul le classement reste.
  await expect(page.getByRole("button", { name: "Valider ce conducteur" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Classer cet avis" })).toBeVisible();

  const id = page.url().split("/").pop();
  await page.goto(`/avis/${id}/recap`);
  await expect(page.getByRole("main")).toContainText(MESSAGES_AVIS.verrouille);

  await page.goto("/avis");
  await expect(page.getByRole("listitem").filter({ hasText: "AB-123-CD" })).toContainText("Verrouillé");
});

test("l'écran Abonnement montre l'usage, le prix du Pro et les fonctions Pro sous cadenas", async ({ page }) => {
  await connecterNouveauCompte(page, "plan-free-abonnement");
  await page.getByRole("navigation", { name: "Réglages" }).getByRole("link", { name: "Abonnement" }).click();
  await expect(page.getByRole("heading", { name: "Abonnement", level: 1 })).toBeVisible();
  await expect(page.getByRole("main").getByText("Avis ce mois-ci", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Passer en Pro" })).toBeDisabled();
  await expect(page.getByText("Le paiement en ligne arrive bientôt.")).toBeVisible();
  for (const { nom, explication } of FONCTIONS_PRO) {
    await expect(page.getByRole("group", { name: nom, exact: true })).toContainText(explication);
  }
});

test.describe("sur téléphone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("le compteur est sur l'écran de dépôt, et un avis verrouillé le dit une fois enregistré", async ({ page }) => {
    const email = await connecterNouveauCompte(page, "plan-free-mobile");
    await semerAvisDuMois(await entrepriseDe(email));

    await page.getByRole("link", { name: "Déposer", exact: true }).click();
    await expect(page.getByRole("banner").getByRole("link", { name: /véhicules/ })).toBeHidden();
    await expect(page.getByRole("main").getByRole("link", { name: /véhicules/ })).toContainText(
      `${LIMITES_FREE.avisParMois}/${LIMITES_FREE.avisParMois} avis ce mois-ci`,
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.locator('input[type="file"][capture="environment"]').setInputFiles(path.join(FICHIERS, "avis.png"));
    await expect(page.getByText("Avis enregistré")).toBeVisible();
    await expect(page.getByText(/Il est « Verrouillé »/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
