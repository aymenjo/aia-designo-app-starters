import { expect, test, type Page } from "@playwright/test";
import { MESSAGES_AVIS } from "@/lib/avis/regles";
import { ajouterJours, aujourdhuiParis, instantParis } from "@/lib/dates";
import { formaterDateHeure } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { comptesEtEntreprises, connecterNouveauCompte } from "./outils";

// Les cas dégradés de la proposition (phase 13) : sans affectation à la date de l'infraction, et sur une plaque
// inconnue. La flotte et l'avis sont semés hors RLS : ce qui compte ici est l'écran de l'avis.

const admin = createAdminClient();
const aujourdhui = aujourdhuiParis();
const INFRACTION = instantParis(ajouterJours(aujourdhui, -5), "08:30")!;
// Karim a eu le véhicule avant l'infraction, Léa l'aura après : aucune affectation ne la couvre.
const FIN_KARIM = instantParis(ajouterJours(aujourdhui, -6), "18:00")!;
const DEBUT_LEA = instantParis(ajouterJours(aujourdhui, -3), "08:00")!;

/**
 * Karim Benali et Léa Martin, et un avis « À valider » sur `plaque`. `vehicule` : la plaque est celle d'un véhicule
 * de la flotte, avec les affectations de Karim (avant) et de Léa (après) ; sinon, aucun véhicule ne la porte.
 */
async function semer(email: string, { plaque, vehicule }: { plaque: string; vehicule: boolean }) {
  const { entreprises } = await comptesEtEntreprises(email);
  const entreprise_id = entreprises[0].id as string;

  const conducteurs = await admin
    .from("conducteur")
    .insert([
      { entreprise_id, prenom: "Karim", nom: "Benali" },
      { entreprise_id, prenom: "Léa", nom: "Martin" },
    ])
    .select("id, prenom");
  if (conducteurs.error) throw conducteurs.error;
  const ids = Object.fromEntries(conducteurs.data.map(({ prenom, id }) => [prenom, id as string]));

  let vehiculeId: string | null = null;
  if (vehicule) {
    const cree = await admin
      .from("vehicule")
      .insert({ entreprise_id, plaque, modele: "Renault Master", type: "attitre" })
      .select("id")
      .single();
    if (cree.error) throw cree.error;
    vehiculeId = cree.data.id;
    const affectations = await admin.from("affectation").insert([
      {
        entreprise_id,
        vehicule_id: vehiculeId,
        conducteur_id: ids.Karim,
        debut: instantParis(ajouterJours(aujourdhui, -10), "08:00"),
        fin: FIN_KARIM,
      },
      {
        entreprise_id,
        vehicule_id: vehiculeId,
        conducteur_id: ids.Léa,
        debut: DEBUT_LEA,
        fin: instantParis(ajouterJours(aujourdhui, -1), "18:00"),
      },
    ]);
    if (affectations.error) throw affectations.error;
  }

  const avis = await admin
    .from("avis")
    .insert({
      entreprise_id,
      fichier: `${entreprise_id}/${crypto.randomUUID()}.png`,
      fichier_type: "image/png",
      numero: "8200000001",
      plaque,
      vehicule_id: vehiculeId,
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
  return avis.data.id as string;
}

/** Le badge de l'en-tête de l'avis : le titre du bloc « Véhicule inconnu » dit la même chose. */
const badgeEnTete = (page: Page) => page.getByRole("main").locator("header").getByText("Véhicule inconnu");
const enregistrer = (page: Page) => page.getByRole("button", { name: "Enregistrer l'affectation", exact: true });

test("sans affectation, les indices aident à choisir, puis l'affectation manquante s'enregistre d'un clic", async ({
  page,
}) => {
  const email = await connecterNouveauCompte(page, "cas-degrades-affectation");
  const avis = await semer(email, { plaque: "AB-123-CD", vehicule: true });
  await page.goto(`/avis/${avis}`);

  await expect(page.getByText(`${MESSAGES_AVIS.aucuneAffectation}.`)).toBeVisible();
  await expect(page.getByText(`Avant : Karim Benali, jusqu'au ${formaterDateHeure(FIN_KARIM)}`)).toBeVisible();
  await expect(page.getByText(`Après : Léa Martin, à partir du ${formaterDateHeure(DEBUT_LEA)}`)).toBeVisible();
  // Rien à enregistrer tant que le conducteur n'est pas validé.
  await expect(enregistrer(page)).toHaveCount(0);

  await page.getByLabel("Conducteur", { exact: true }).selectOption({ label: "Léa Martin" });
  await page.getByRole("button", { name: "Valider ce conducteur" }).click();
  await expect(page.getByText(/Conducteur validé\s*:\s*Léa Martin/)).toBeVisible();
  await expect(page.getByText(MESSAGES_AVIS.affectationManquante("Léa Martin"))).toBeVisible();

  await enregistrer(page).click();
  await expect(page.getByText("Affectation enregistrée dans le planning.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Proposé d'après le planning\s*:\s*Léa Martin/)).toBeVisible();
  await expect(page.getByText(/Conducteur validé\s*:\s*Léa Martin/)).toBeVisible();
  await expect(enregistrer(page)).toHaveCount(0);
});

test("plaque inconnue : le véhicule se crée depuis l'avis, qui retrouve alors le bloc Conducteur", async ({ page }) => {
  const email = await connecterNouveauCompte(page, "cas-degrades-vehicule");
  const avis = await semer(email, { plaque: "EF-456-GH", vehicule: false });

  await page.goto("/avis");
  const ligne = page.getByRole("main").getByRole("listitem").filter({ hasText: "8200000001" });
  await expect(ligne.getByText("Véhicule inconnu", { exact: true })).toBeVisible();

  await ligne.getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/avis/${avis}$`));
  await expect(badgeEnTete(page)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Véhicule inconnu" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Conducteur", exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Créer le véhicule" }).click();
  const fenetre = page.getByRole("dialog", { name: "Créer le véhicule" });
  // La plaque est celle de l'avis : elle ne se saisit pas.
  await expect(fenetre.getByText("EF-456-GH", { exact: true })).toBeVisible();
  await expect(fenetre.getByLabel("Plaque")).toHaveCount(0);
  await fenetre.getByLabel("Modèle").fill("Peugeot Partner");
  await fenetre.getByRole("button", { name: "Créer", exact: true }).click();
  await expect(fenetre).toBeHidden();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Conducteur", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Véhicule inconnu" })).toHaveCount(0);
  await expect(badgeEnTete(page)).toHaveCount(0);
  await expect(page.getByText("Peugeot Partner")).toBeVisible();
});

test("plaque inconnue : l'avis se classe depuis le bloc « Véhicule inconnu »", async ({ page }) => {
  const email = await connecterNouveauCompte(page, "cas-degrades-classer");
  const avis = await semer(email, { plaque: "EF-456-GH", vehicule: false });
  await page.goto(`/avis/${avis}`);

  const bloc = page.locator("section").filter({ has: page.getByRole("heading", { name: "Véhicule inconnu" }) });
  await bloc.getByRole("button", { name: "Classer l'avis" }).click();
  const fenetre = page.getByRole("dialog", { name: "Classer cet avis" });
  await fenetre.getByRole("radio", { name: "Véhicule volé ou plaque usurpée" }).check();
  await fenetre.getByRole("button", { name: "Classer" }).click();
  await expect(fenetre).toBeHidden();

  await page.reload();
  const main = page.getByRole("main");
  await expect(main.locator("header").getByText("Classé", { exact: true })).toBeVisible();
  await expect(main.getByText("Véhicule volé ou plaque usurpée")).toBeVisible();
  await expect(badgeEnTete(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Véhicule inconnu" })).toHaveCount(0);
});
