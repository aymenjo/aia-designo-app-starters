import { expect, test } from "@playwright/test";
import { ajouterJours, aujourdhuiParis, depuisIso, instantParis } from "@/lib/dates";
import { createAdminClient } from "@/lib/supabase/admin";
import { comptesEtEntreprises, connecterNouveauCompte } from "./outils";

// Classer et rouvrir un avis (phase 12). Les avis sont semés hors RLS, sans fichier dans le bucket.

const admin = createAdminClient();
const aujourdhui = aujourdhuiParis();

async function entrepriseDe(email: string) {
  const { entreprises } = await comptesEtEntreprises(email);
  return entreprises[0].id as string;
}

/** Sème des avis de l'entreprise ; renvoie les ids par n°. */
async function semer(entreprise_id: string, avis: ({ numero: string } & Record<string, unknown>)[]) {
  const { data, error } = await admin
    .from("avis")
    .insert(
      avis.map((un) => ({
        ...un,
        entreprise_id,
        fichier: `${entreprise_id}/${crypto.randomUUID()}.png`,
        fichier_type: "image/png",
      })),
    )
    .select("id, numero");
  if (error) throw error;
  return Object.fromEntries(data.map(({ id, numero }) => [numero, id as string]));
}

test("classer un avis avec un motif le sort du suivi, et le rouvrir l'y remet", async ({ page }) => {
  const email = await connecterNouveauCompte(page, "classement-avis");
  const ids = await semer(await entrepriseDe(email), [
    // Envoyé il y a 50 jours : l'échéance est dépassée depuis 5 jours.
    { numero: "6000000001", statut: "a_traiter", date_envoi: ajouterJours(aujourdhui, -50) },
    { numero: "6000000002", statut: "a_traiter", date_envoi: ajouterJours(aujourdhui, -3) },
  ]);

  await page.goto(`/avis/${ids["6000000001"]}`);
  const main = page.getByRole("main");
  await expect(main.getByText("Échéance dépassée", { exact: true })).toBeVisible();

  // « Autre » demande le motif en toutes lettres.
  await page.getByRole("button", { name: "Classer l'avis" }).click();
  const fenetre = page.getByRole("dialog", { name: "Classer cet avis" });
  await expect(fenetre.getByLabel("Précisez le motif")).toHaveCount(0);
  await fenetre.getByRole("radio", { name: "Autre" }).check();
  await fenetre.getByRole("button", { name: "Classer" }).click();
  await expect(fenetre.getByText("Précisez le motif.", { exact: true })).toBeVisible();
  await fenetre.getByLabel("Précisez le motif").fill("Avis déposé deux fois");
  await fenetre.getByRole("button", { name: "Classer" }).click();

  // Classé, l'avis n'a plus d'échéance : le badge disparaît, et la pastille devient « Classé le … ».
  await expect(fenetre).toBeHidden();
  await expect(main.getByText("Classé", { exact: true })).toBeVisible();
  await expect(main.getByText(new RegExp(`^Classé le ${depuisIso(aujourdhui)} à \\d{2}:\\d{2}$`))).toBeVisible();
  await expect(main.getByText(`Classé le ${depuisIso(aujourdhui)}`, { exact: true })).toBeVisible();
  await expect(main.getByText(/Motif\s*:\s*Avis déposé deux fois/)).toBeVisible();
  await expect(main.getByText("Échéance dépassée", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Classer l'avis" })).toHaveCount(0);

  // Le filtre « Classé » ne garde que lui, sans badge.
  await page.goto("/avis");
  await page.getByRole("navigation", { name: "Filtrer par statut" }).getByRole("link", { name: "Classé" }).click();
  await expect(page).toHaveURL(/\/avis\?statut=classe$/);
  const lignes = main.getByRole("listitem");
  await expect(lignes).toHaveText([/^6000000001/]);
  await expect(lignes.first()).toContainText(`Classé le ${depuisIso(aujourdhui).slice(0, 5)}`);
  await expect(lignes.first()).not.toContainText("Échéance dépassée");

  // Rouvert, il lui manque des champs : il repasse « À traiter », et retrouve son échéance dépassée.
  await lignes.first().getByRole("link").click();
  await page.getByRole("button", { name: "Rouvrir l'avis" }).click();
  const confirmation = page.getByRole("dialog", { name: "Rouvrir cet avis ?" });
  await expect(confirmation.getByText(/Il repasse « À traiter »/)).toBeVisible();
  await confirmation.getByRole("button", { name: "Rouvrir" }).click();
  await expect(main.getByText("À traiter", { exact: true })).toBeVisible();
  await expect(main.getByText("Échéance dépassée", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Classement" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Classer l'avis" })).toBeVisible();
});

test("rouvrir un avis désigné le repasse « À valider », et son conducteur redevient modifiable", async ({ page }) => {
  const email = await connecterNouveauCompte(page, "reouverture-avis");
  const entreprise_id = await entrepriseDe(email);
  const vehicule = await admin
    .from("vehicule")
    .insert({ entreprise_id, plaque: "AB-123-CD", type: "attitre" })
    .select("id")
    .single();
  if (vehicule.error) throw vehicule.error;
  const karim = await admin.from("conducteur").insert({ entreprise_id, prenom: "Karim", nom: "Benali" }).select("id").single();
  if (karim.error) throw karim.error;
  const ids = await semer(entreprise_id, [
    {
      numero: "6100000001",
      plaque: "AB-123-CD",
      vehicule_id: vehicule.data.id,
      infraction_le: instantParis(ajouterJours(aujourdhui, -5), "08:30"),
      lieu: "A6, Auxerre, sens Paris-Province",
      infraction: "Excès de vitesse inférieur à 20 km/h",
      montant_centimes: 13500,
      date_envoi: ajouterJours(aujourdhui, -2),
      statut: "designe",
      conducteur_id: karim.data.id,
      designe_le: new Date().toISOString(),
    },
  ]);

  await page.goto(`/avis/${ids["6100000001"]}`);
  await expect(page.getByRole("heading", { name: "Désignation" })).toBeVisible();
  await page.getByRole("button", { name: "Rouvrir l'avis" }).click();
  const confirmation = page.getByRole("dialog", { name: "Rouvrir cet avis ?" });
  await expect(confirmation.getByText(/Il repasse « À valider »/)).toBeVisible();
  await confirmation.getByRole("button", { name: "Rouvrir" }).click();

  const main = page.getByRole("main");
  await expect(main.getByText("À valider", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Désignation" })).toHaveCount(0);
  await expect(main.getByText(/Conducteur validé\s*:\s*Karim Benali/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Changer de conducteur" })).toBeVisible();
  // L'échéance reprend son compte à rebours.
  await expect(main.getByText(/^avant le \d{2}\/\d{2}\/\d{4} · J-\d+$/)).toBeVisible();
});
