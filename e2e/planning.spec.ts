import { expect, test, type Locator, type Page } from "@playwright/test";
import { createAdminClient } from "@/lib/supabase/admin";
import { comptesEtEntreprises, connecterNouveauCompte } from "./outils";

// Dates fixes et passées, planning ouvert sur leur semaine : le test ne dépend pas du jour où il tourne.
const SEMAINE = "/flotte/planning?date=2026-03-02";

/** La flotte est semée par l'admin : ce test porte sur les affectations, pas sur l'ajout de véhicules. */
async function semerFlotte(email: string) {
  const admin = createAdminClient();
  const { entreprises } = await comptesEtEntreprises(email);
  const entreprise_id = entreprises[0].id;
  const vehicules = await admin
    .from("vehicule")
    .insert([
      { entreprise_id, plaque: "AB-123-CD", modele: "Renault Master", type: "attitre" },
      { entreprise_id, plaque: "CD-456-EF", modele: "Peugeot Partner", type: "pool" },
      { entreprise_id, plaque: "EF-789-GH", modele: "Citroën Jumpy", type: "attitre" },
    ])
    .select("id, plaque");
  if (vehicules.error) throw vehicules.error;
  const conducteurs = await admin.from("conducteur").insert([
    { entreprise_id, prenom: "Karim", nom: "Benali" },
    { entreprise_id, prenom: "Léa", nom: "Martin" },
  ]);
  if (conducteurs.error) throw conducteurs.error;
  return Object.fromEntries(vehicules.data.map(({ plaque, id }) => [plaque, id]));
}

type Creneau = { vehicule: string; conducteur: string; debut: [string, string]; fin?: [string, string] };

async function remplir(fenetre: Locator, { vehicule, conducteur, debut, fin }: Creneau) {
  await fenetre.getByLabel("Véhicule").selectOption({ label: vehicule });
  await fenetre.getByLabel("Conducteur").selectOption({ label: conducteur });
  await fenetre.getByLabel("Date de début").fill(debut[0]);
  await fenetre.getByLabel("Heure de début").fill(debut[1]);
  // Laissée vide, la fin n'est pas touchée : une erreur affichée à la sortie du champ précéderait celle du serveur.
  if (fin) {
    await fenetre.getByLabel("Date de fin").fill(fin[0]);
    await fenetre.getByLabel("Heure de fin").fill(fin[1]);
  }
}

async function nouvelleAffectation(page: Page, creneau: Creneau) {
  await page.getByRole("button", { name: "Nouvelle affectation" }).click();
  const fenetre = page.getByRole("dialog", { name: "Nouvelle affectation" });
  await remplir(fenetre, creneau);
  await fenetre.getByRole("button", { name: "Enregistrer" }).click();
  return fenetre;
}

const barre = (page: Page, debut: RegExp | string) => page.getByRole("button", { name: debut });

test("affecter, voir le planning, clôturer, archiver et supprimer", async ({ page }) => {
  const email = await connecterNouveauCompte(page, "planning");
  await semerFlotte(email);
  await page.getByRole("navigation", { name: "Navigation principale" }).getByRole("link", { name: "Planning" }).click();
  await expect(page.getByRole("heading", { name: "Planning", level: 1 })).toBeVisible();
  await page.goto(SEMAINE);
  await expect(page.getByRole("heading", { name: "Semaine du 02/03 au 08/03/2026" })).toBeVisible();
  await expect(page.getByText("Aucune affectation sur cette période.")).toBeVisible();

  // 1. Karim sur l'attitré, sans fin : la barre apparaît
  const karim = await nouvelleAffectation(page, {
    vehicule: "AB-123-CD · Renault Master",
    conducteur: "Karim Benali",
    debut: ["03/03/2026", "8h"],
  });
  await expect(karim).toBeHidden();
  await expect(barre(page, "Karim Benali sur AB-123-CD, depuis le 03/03/2026 08:00 · sans fin")).toBeVisible();

  // 2. Léa sur le même véhicule : le conflit est nommé
  const conflit = await nouvelleAffectation(page, {
    vehicule: "AB-123-CD · Renault Master",
    conducteur: "Léa Martin",
    debut: ["04/03/2026", "09:00"],
    fin: ["04/03/2026", "18:00"],
  });
  await expect(conflit.getByText("Conflit avec : Karim B. sur AB-123-CD à partir du 03/03 08:00.")).toBeVisible();
  await page.keyboard.press("Escape");

  // 3. Un véhicule de pool exige une fin ; avec une fin, la barre apparaît
  const pool = await nouvelleAffectation(page, {
    vehicule: "CD-456-EF · Peugeot Partner",
    conducteur: "Léa Martin",
    debut: ["05/03/2026", "08:00"],
  });
  await expect(pool.getByText("Fin obligatoire : un véhicule de pool a toujours une date et une heure de fin.")).toBeVisible();
  await pool.getByLabel("Date de fin").fill("05/03/2026");
  await pool.getByLabel("Heure de fin").fill("1800");
  await pool.getByRole("button", { name: "Enregistrer" }).click();
  await expect(pool).toBeHidden();
  const barreLea = barre(page, /^Léa Martin sur CD-456-EF/);
  await expect(barreLea).toHaveAccessibleName("Léa Martin sur CD-456-EF, du 05/03/2026 08:00 au 05/03/2026 18:00");

  // Modifier : la fin avance d'une heure
  await barreLea.click();
  const detail = page.getByRole("dialog", { name: "Affectation" });
  await detail.getByRole("button", { name: "Modifier" }).click();
  const modification = page.getByRole("dialog", { name: "Modifier l'affectation" });
  await expect(modification.getByLabel("Heure de fin")).toHaveValue("18:00");
  await modification.getByLabel("Heure de fin").fill("17:00");
  await modification.getByRole("button", { name: "Enregistrer" }).click();
  await expect(barreLea).toHaveAccessibleName("Léa Martin sur CD-456-EF, du 05/03/2026 08:00 au 05/03/2026 17:00");

  // 4. Vue Mois, puis filtre sur Léa
  await page.getByRole("link", { name: "Mois", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Mars 2026" })).toBeVisible();
  await expect(barre(page, /^Karim Benali sur AB-123-CD/)).toBeVisible();
  await page.getByLabel("Conducteur").selectOption({ label: "Léa Martin" });
  await expect(barre(page, /^Karim Benali sur AB-123-CD/)).toBeHidden();
  await expect(barreLea).toBeVisible();
  await expect(page).toHaveURL(/vue=mois/);

  // 5. Archiver Karim est refusé tant que son affectation est ouverte
  await page.goto(SEMAINE);
  await barre(page, /^Karim Benali sur AB-123-CD/).click();
  await page.getByRole("dialog", { name: "Affectation" }).getByRole("link", { name: "Karim Benali" }).click();
  await expect(page.getByRole("heading", { name: "Karim Benali", level: 1 })).toBeVisible();
  await expect(page.getByText("Il a un historique : il ne peut pas être supprimé.")).toBeVisible();

  await page.getByRole("button", { name: "Archiver ce conducteur" }).click();
  const archivage = page.getByRole("dialog", { name: "Archiver Karim Benali ?" });
  await archivage.getByRole("button", { name: "Archiver", exact: true }).click();
  await expect(archivage.getByText("Clôturez d'abord l'affectation de Karim B. sur AB-123-CD.")).toBeVisible();
  await page.keyboard.press("Escape");

  // On clôture depuis sa fiche, puis l'archivage passe
  await page.getByRole("button", { name: /^AB-123-CD/ }).click();
  await page.getByRole("dialog", { name: "Affectation" }).getByRole("button", { name: "Clôturer" }).click();
  const cloture = page.getByRole("dialog", { name: "Clôturer l'affectation" });
  // Le jour choisi dans le calendrier du navigateur s'écrit en JJ/MM/AAAA dans le champ.
  await expect(cloture.getByRole("button", { name: "Choisir dans le calendrier" })).toBeVisible();
  await cloture.locator('input[type="date"]').fill("2026-03-06");
  await expect(cloture.getByLabel("Date de fin")).toHaveValue("06/03/2026");
  await cloture.getByLabel("Heure de fin").fill("18:00");
  await cloture.getByRole("button", { name: "Clôturer" }).click();
  await expect(cloture).toBeHidden();
  await expect(page.getByRole("button", { name: /^AB-123-CD/ })).toContainText(
    "du 03/03/2026 08:00 au 06/03/2026 18:00",
  );

  await page.getByRole("button", { name: "Archiver ce conducteur" }).click();
  await archivage.getByRole("button", { name: "Archiver", exact: true }).click();
  await expect(page.getByText(/^Archivé le \d{2}\/\d{2}\/\d{4}$/)).toBeVisible();

  // Archivé, il quitte les sélecteurs, mais sa barre reste dans le planning passé
  await page.goto(SEMAINE);
  await expect(barre(page, "Karim Benali sur AB-123-CD, du 03/03/2026 08:00 au 06/03/2026 18:00")).toBeVisible();
  await expect(page.getByLabel("Conducteur").getByRole("option", { name: "Karim Benali (archivé)" })).toBeAttached();
  await page.getByRole("button", { name: "Nouvelle affectation" }).click();
  const nouvelle = page.getByRole("dialog", { name: "Nouvelle affectation" });
  await expect(nouvelle.getByLabel("Conducteur").getByRole("option")).toHaveText(["Choisir un conducteur", "Léa Martin"]);
  await page.keyboard.press("Escape");

  // 6. Un véhicule sans historique se supprime
  await page.goto("/flotte/vehicules");
  await page.getByRole("link", { name: /EF-789-GH/ }).click();
  await page.getByRole("button", { name: "Supprimer ce véhicule" }).click();
  await page
    .getByRole("dialog", { name: "Supprimer EF-789-GH ?" })
    .getByRole("button", { name: "Supprimer", exact: true })
    .click();
  await expect(page).toHaveURL(/\/flotte\/vehicules$/);
  await expect(page.getByRole("link", { name: /EF-789-GH/ })).toHaveCount(0);
  await expect(page.getByText("2 véhicules")).toBeVisible();
});
