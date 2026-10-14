import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { BUCKET_AVIS } from "@/lib/avis/avis";
import { MESSAGES_AVIS, type StatutAvis } from "@/lib/avis/regles";
import { ajouterJours, aujourdhuiParis } from "@/lib/dates";
import { createAdminClient } from "@/lib/supabase/admin";
import { comptesEtEntreprises, connecterNouveauCompte } from "./outils";

const FICHIERS = path.join(__dirname, "fichiers");
const URL_AVIS = /\/avis\/[0-9a-f-]{36}$/;
/** Le dépôt attend la lecture IA quand le serveur a une clé d'API. */
const APRES_DEPOT = { timeout: 30_000 };

/** Le sélecteur de fichier (et non l'appareil photo, qui porte `capture`). */
const selecteur = (page: Page) => page.locator('input[type="file"]:not([capture])');

async function entrepriseDe(email: string) {
  const { entreprises } = await comptesEtEntreprises(email);
  return entreprises[0].id as string;
}

/** Envoyé il y a `jours` jours : à 50, l'échéance est dépassée depuis 5 jours. */
const envoyeIlYa = (jours: number) => ajouterJours(aujourdhuiParis(), -jours);

/**
 * Sème des avis hors écran, sans fichier dans le bucket (la liste ne les ouvre pas) : leur chemin est seulement
 * rangé dans le dossier de l'entreprise. Renvoie les ids par n°.
 */
async function semer(
  entrepriseId: string,
  avis: { numero: string; statut: StatutAvis; date_envoi: string | null }[],
): Promise<Record<string, string>> {
  const { data, error } = await createAdminClient()
    .from("avis")
    .insert(
      avis.map((un) => ({
        ...un,
        entreprise_id: entrepriseId,
        fichier: `${entrepriseId}/${crypto.randomUUID()}.png`,
        fichier_type: "image/png",
      })),
    )
    .select("id, numero");
  if (error) throw error;
  return Object.fromEntries(data.map(({ id, numero }) => [numero, id]));
}

test("la liste suit les échéances : tri, filtre par statut et badge « Échéance dépassée »", async ({ page }) => {
  const email = await connecterNouveauCompte(page, "suivi-avis");
  const ids = await semer(await entrepriseDe(email), [
    { numero: "3000000001", statut: "a_valider", date_envoi: envoyeIlYa(10) },
    { numero: "3000000002", statut: "designe", date_envoi: envoyeIlYa(60) },
    { numero: "3000000003", statut: "a_traiter", date_envoi: envoyeIlYa(50) },
    { numero: "3000000004", statut: "a_traiter", date_envoi: null },
    { numero: "3000000005", statut: "a_valider", date_envoi: envoyeIlYa(40) },
  ]);

  // Sans échéance d'abord, puis par échéance croissante ; le désigné en dernier, même dépassé.
  await page.goto("/avis");
  const lignes = page.getByRole("main").getByRole("listitem");
  await expect(lignes).toHaveText([/^3000000004/, /^3000000003/, /^3000000005/, /^3000000001/, /^3000000002/]);
  await expect(lignes.filter({ hasText: "Échéance dépassée" })).toHaveCount(1);
  await expect(lignes.nth(1)).toContainText("Échéance dépassée");
  await expect(lignes.nth(1)).toContainText("À traiter");

  // Le filtre ne garde que le statut choisi, dans le même ordre, et se lit dans l'URL.
  const filtre = page.getByRole("navigation", { name: "Filtrer par statut" });
  await expect(filtre.getByRole("link", { name: "Tous" })).toHaveAttribute("aria-current", "page");
  await filtre.getByRole("link", { name: "À valider" }).click();
  await expect(page).toHaveURL(/\/avis\?statut=a_valider$/);
  await expect(lignes).toHaveText([/^3000000005/, /^3000000001/]);
  await expect(page.getByText("2 avis sur 5")).toBeVisible();
  await expect(filtre.getByRole("link", { name: "À valider" })).toHaveAttribute("aria-current", "page");

  await filtre.getByRole("link", { name: "Tous" }).click();
  await expect(page).toHaveURL(/\/avis$/);
  await expect(lignes).toHaveCount(5);

  // Le badge figure aussi sur la page de l'avis, à côté de son statut inchangé.
  await lignes.nth(1).getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/avis/${ids["3000000003"]}$`));
  await expect(page.getByRole("heading", { name: "Avis n° 3000000003", level: 1 })).toBeVisible();
  await expect(page.getByText("Échéance dépassée", { exact: true })).toBeVisible();
  await expect(page.getByText("À traiter", { exact: true })).toBeVisible();
});

test("saisir le n° d'un avis déjà enregistré abandonne le dépôt, fichier compris, et mène à l'avis existant", async ({
  page,
}) => {
  const email = await connecterNouveauCompte(page, "doublon-avis");
  const entrepriseId = await entrepriseDe(email);
  const { "4000000001": existantId } = await semer(entrepriseId, [
    { numero: "4000000001", statut: "a_traiter", date_envoi: envoyeIlYa(3) },
  ]);

  await page.goto("/avis/nouveau");
  await selecteur(page).setInputFiles(path.join(FICHIERS, "avis.png"));
  await expect(page).toHaveURL(URL_AVIS, APRES_DEPOT);
  await page.getByLabel("N° d'avis").fill("40 0000 0001");
  await page.getByRole("button", { name: "Enregistrer" }).click();

  await expect(page).toHaveURL(new RegExp(`/avis/nouveau\\?existant=${existantId}$`));
  await expect(page.getByText("Cet avis existe déjà : n° 4000000001.")).toBeVisible();
  await expect(page.getByText(MESSAGES_AVIS.depotAbandonne)).toBeVisible();

  // Un second avis n'a pas été créé, et le fichier déposé est parti avec lui.
  const admin = createAdminClient();
  const { count } = await admin
    .from("avis")
    .select("id", { count: "exact", head: true })
    .eq("entreprise_id", entrepriseId);
  expect(count).toBe(1);
  expect((await admin.storage.from(BUCKET_AVIS).list(entrepriseId)).data).toEqual([]);

  await page.getByRole("link", { name: "Ouvrir l'avis existant" }).click();
  await expect(page).toHaveURL(new RegExp(`/avis/${existantId}$`));
  await expect(page.getByRole("heading", { name: "Avis n° 4000000001", level: 1 })).toBeVisible();
});

test("corriger un avis identifié vers le n° d'un autre est refusé, avec un lien vers l'existant", async ({ page }) => {
  const email = await connecterNouveauCompte(page, "doublon-corrige");
  const ids = await semer(await entrepriseDe(email), [
    { numero: "5000000001", statut: "a_traiter", date_envoi: null },
    { numero: "5000000002", statut: "a_traiter", date_envoi: null },
  ]);

  await page.goto(`/avis/${ids["5000000002"]}`);
  await page.getByLabel("N° d'avis").fill("5000000001");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText(MESSAGES_AVIS.avisExistant)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/avis/${ids["5000000002"]}$`));

  await page.getByRole("link", { name: "Ouvrir l'avis existant" }).click();
  await expect(page).toHaveURL(new RegExp(`/avis/${ids["5000000001"]}$`));
  await expect(page.getByRole("heading", { name: "Avis n° 5000000001", level: 1 })).toBeVisible();
});
