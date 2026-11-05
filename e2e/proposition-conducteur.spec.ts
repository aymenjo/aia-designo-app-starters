import { expect, test, type Page } from "@playwright/test";
import { MESSAGES_AVIS } from "@/lib/avis/regles";
import { ajouterJours, aujourdhuiParis, instantParis } from "@/lib/dates";
import { createAdminClient } from "@/lib/supabase/admin";
import { comptesEtEntreprises, connecterNouveauCompte } from "./outils";

// La proposition du conducteur et sa validation, sur un avis « À valider » rattaché à un véhicule.
// La flotte et l'avis sont semés hors RLS : ce qui compte ici est l'écran de l'avis.

const admin = createAdminClient();
const aujourdhui = aujourdhuiParis();
const INFRACTION = instantParis(ajouterJours(aujourdhui, -5), "08:30")!;

type Semis = { avis: string; conducteurs: Record<string, string> };

/**
 * Un véhicule AB-123-CD, Karim Benali, Léa Martin et Paul Durand (archivé), et un avis « À valider » rattaché.
 * `conduisait` : le conducteur de l'affectation qui couvre l'infraction, s'il y en a une.
 */
async function semer(email: string, conduisait?: "Karim" | "Paul"): Promise<Semis> {
  const { entreprises } = await comptesEtEntreprises(email);
  const entreprise_id = entreprises[0].id as string;

  const vehicule = await admin
    .from("vehicule")
    .insert({ entreprise_id, plaque: "AB-123-CD", modele: "Renault Master", type: "attitre" })
    .select("id")
    .single();
  if (vehicule.error) throw vehicule.error;
  const conducteurs = await admin
    .from("conducteur")
    .insert([
      { entreprise_id, prenom: "Karim", nom: "Benali" },
      { entreprise_id, prenom: "Léa", nom: "Martin" },
      { entreprise_id, prenom: "Paul", nom: "Durand", archive_le: new Date().toISOString() },
    ])
    .select("id, prenom");
  if (conducteurs.error) throw conducteurs.error;
  const ids = Object.fromEntries(conducteurs.data.map(({ prenom, id }) => [prenom, id as string]));

  if (conduisait) {
    const affectation = await admin.from("affectation").insert({
      entreprise_id,
      vehicule_id: vehicule.data.id,
      conducteur_id: ids[conduisait],
      debut: instantParis(ajouterJours(aujourdhui, -10), "08:00"),
      fin: instantParis(ajouterJours(aujourdhui, -1), "18:00"),
    });
    if (affectation.error) throw affectation.error;
  }

  const avis = await admin
    .from("avis")
    .insert({
      entreprise_id,
      fichier: `${entreprise_id}/${crypto.randomUUID()}.png`,
      fichier_type: "image/png",
      numero: "8100000001",
      plaque: "AB-123-CD",
      vehicule_id: vehicule.data.id,
      infraction_le: INFRACTION,
      lieu: "A6, Auxerre, sens Paris-Province",
      infraction: "Excès de vitesse inférieur à 20 km/h",
      montant_centimes: 13500,
      date_envoi: ajouterJours(aujourdhui, -2),
      statut: "a_valider",
    })
    .select("id")
    .single();
  if (avis.error) throw avis.error;
  return { avis: avis.data.id, conducteurs: ids };
}

const valider = (page: Page) => page.getByRole("button", { name: "Valider ce conducteur" });
const liste = (page: Page) => page.getByLabel("Conducteur", { exact: true });

test("le conducteur de l'affectation est proposé, validé d'un clic, puis changé", async ({ page }) => {
  const email = await connecterNouveauCompte(page, "proposition-nominal");
  const { avis } = await semer(email, "Karim");
  await page.goto(`/avis/${avis}`);

  await expect(page.getByText(/Proposé d'après le planning\s*:\s*Karim Benali/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Voir dans le planning" })).toBeVisible();
  // Rien n'est validé d'office : la proposition attend le clic.
  await expect(page.getByText(/Conducteur validé\s*:/)).toHaveCount(0);
  await expect(liste(page)).toHaveCount(0);

  await valider(page).click();
  await expect(page.getByText("Conducteur validé.", { exact: true })).toBeVisible();
  await expect(page.getByText(/Conducteur validé\s*:\s*Karim Benali/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Conducteur validé\s*:\s*Karim Benali/)).toBeVisible();
  await expect(valider(page)).toHaveCount(0);

  // Changer de conducteur : un seul bouton « Valider ce conducteur » à la fois.
  await page.getByRole("button", { name: "Changer de conducteur" }).click();
  await expect(valider(page)).toHaveCount(1);
  await liste(page).selectOption({ label: "Léa Martin" });
  await valider(page).click();
  await expect(page.getByText(/Conducteur validé\s*:\s*Léa Martin/)).toBeVisible();
  await expect(liste(page)).toHaveCount(0);
  await page.reload();
  await expect(page.getByText(/Conducteur validé\s*:\s*Léa Martin/)).toBeVisible();
});

test("sans affectation, le choix est ouvert d'emblée, parmi les conducteurs actifs", async ({ page }) => {
  const email = await connecterNouveauCompte(page, "proposition-aucune");
  const { avis } = await semer(email);
  await page.goto(`/avis/${avis}`);

  await expect(page.getByText(`${MESSAGES_AVIS.aucuneAffectation}.`)).toBeVisible();
  await expect(liste(page)).toBeVisible();
  await expect(liste(page).getByRole("option")).toHaveText(["Choisir un conducteur", "Karim Benali", "Léa Martin"]);

  // Valider sans choisir est refusé, sur la liste.
  await valider(page).click();
  await expect(page.getByText(MESSAGES_AVIS.conducteurVide)).toBeVisible();

  await liste(page).selectOption({ label: "Léa Martin" });
  await valider(page).click();
  await expect(page.getByText(/Conducteur validé\s*:\s*Léa Martin/)).toBeVisible();
});

test("le conducteur archivé de l'affectation est nommé, mais pas proposé à la validation", async ({ page }) => {
  const email = await connecterNouveauCompte(page, "proposition-archive");
  const { avis, conducteurs } = await semer(email, "Paul");
  await page.goto(`/avis/${avis}`);

  const message = MESSAGES_AVIS.conducteurArchivePropose("Paul Durand", "AB-123-CD");
  await expect(page.getByText(message)).toBeVisible();
  // Le lien du message, et non celui du véhicule, plus haut.
  const alerte = page.getByRole("status").filter({ hasText: message });
  await expect(alerte.getByRole("link", { name: "Ouvrir sa fiche" })).toHaveAttribute(
    "href",
    `/flotte/conducteurs/${conducteurs.Paul}`,
  );
  // Pas de validation d'un clic : seul le choix parmi les conducteurs actifs reste.
  await expect(page.getByRole("button", { name: "Choisir un autre conducteur" })).toHaveCount(0);
  await expect(valider(page)).toHaveCount(1);
  await expect(liste(page).getByRole("option", { name: "Paul Durand" })).toHaveCount(0);
});
