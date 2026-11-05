import { expect, test, type Page } from "@playwright/test";
import { BUCKET_AVIS } from "@/lib/avis/avis";
import { MESSAGES_COMPTE } from "@/lib/compte/regles";
import { createAdminClient } from "@/lib/supabase/admin";
import { attendreNouveauLien, comptesEtEntreprises, connecterNouveauCompte, demanderLien, seConnecterAvec } from "./outils";

// La suppression de compte (phase 20), depuis le menu du compte. L'E2E n'a ni Stripe ni Composio, comme le reste de la
// CI : l'annulation de l'abonnement et la révocation de Gmail sont prouvées par tests/integration/suppression-compte.

const admin = createAdminClient();

// Un PNG de 1 × 1 pixel.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

async function entrepriseDe(email: string) {
  const { entreprises } = await comptesEtEntreprises(email);
  return entreprises[0].id as string;
}

async function fichiersDe(entrepriseId: string) {
  const { data, error } = await admin.storage.from(BUCKET_AVIS).list(entrepriseId);
  if (error) throw error;
  return data;
}

/** Avatar › « Mon compte » › « Supprimer le compte » : la fenêtre de confirmation. */
async function ouvrirSuppression(page: Page) {
  await page.getByRole("button", { name: "Mon compte" }).click();
  await page.getByRole("link", { name: "Mon compte" }).click();
  await expect(page).toHaveURL(/\/parametres\/compte$/);
  await page.getByRole("button", { name: "Supprimer le compte" }).click();
  return page.getByRole("dialog", { name: "Supprimer votre compte ?" });
}

test("supprimer son compte efface l'entreprise et ses fichiers, puis le même email recrée un compte vierge", async ({
  page,
}) => {
  const email = await connecterNouveauCompte(page, "suppression-compte");
  const entreprise_id = await entrepriseDe(email);
  const raisonSociale = "Plomberie Martin";
  const fiche = await admin.from("entreprise").update({ raison_sociale: raisonSociale }).eq("id", entreprise_id);
  if (fiche.error) throw fiche.error;
  const vehicule = await admin.from("vehicule").insert({ entreprise_id, plaque: "SU-123-PP", type: "attitre" });
  if (vehicule.error) throw vehicule.error;
  const fichier = `${entreprise_id}/${crypto.randomUUID()}.png`;
  const envoi = await admin.storage.from(BUCKET_AVIS).upload(fichier, PNG, { contentType: "image/png" });
  if (envoi.error) throw envoi.error;
  const avis = await admin.from("avis").insert({ entreprise_id, fichier, fichier_type: "image/png" });
  if (avis.error) throw avis.error;

  await page.reload();
  const fenetre = await ouvrirSuppression(page);
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  const saisie = fenetre.getByLabel(`Saisissez « ${raisonSociale} » pour confirmer`);
  const supprimer = fenetre.getByRole("button", { name: "Supprimer définitivement" });
  await expect(supprimer).toBeDisabled();
  await saisie.fill("plomberie martin");
  await expect(supprimer).toBeDisabled();
  await saisie.fill(raisonSociale);
  await supprimer.click();

  await expect(page).toHaveURL(/\/connexion\?compte=supprime$/);
  await expect(page.getByText(MESSAGES_COMPTE.supprime)).toBeVisible();
  expect(await comptesEtEntreprises(email)).toEqual({ comptes: [], entreprises: [] });
  expect(await fichiersDe(entreprise_id)).toEqual([]);
  // Cet appareil est déconnecté.
  await page.goto("/tableau-de-bord");
  await expect(page).toHaveURL(/\/connexion/);

  await demanderLien(page, email);
  await seConnecterAvec(page, await attendreNouveauLien(email, 1));
  await expect(page).toHaveURL(/\/tableau-de-bord$/);
  await expect(page.getByRole("region", { name: "Bien démarrer" })).toContainText("0/3");
  const neuve = await entrepriseDe(email);
  expect(neuve).not.toBe(entreprise_id);
});

test("sans raison sociale, la suppression se confirme par l'email", async ({ page }) => {
  const email = await connecterNouveauCompte(page, "suppression-email");

  const fenetre = await ouvrirSuppression(page);
  const supprimer = fenetre.getByRole("button", { name: "Supprimer définitivement" });
  await fenetre.getByLabel(`Saisissez « ${email} » pour confirmer`).fill(email.toUpperCase());
  await supprimer.click();

  await expect(page).toHaveURL(/\/connexion\?compte=supprime$/);
  expect(await comptesEtEntreprises(email)).toEqual({ comptes: [], entreprises: [] });
});
