import { expect, test, type Page } from "@playwright/test";
import { ajouterJours, aujourdhuiParis, instantParis } from "@/lib/dates";
import { createAdminClient } from "@/lib/supabase/admin";
import { comptesEtEntreprises, connecterNouveauCompte, passerEnPro } from "./outils";

// Le tableau de bord (phase 15). Les données sont semées hors RLS, sans fichier dans le bucket.

const admin = createAdminClient();
const aujourdhui = aujourdhuiParis();
/** La date d'envoi d'un avis dont l'échéance tombe à J-n : négatif une fois dépassée. */
const envoiPourJ = (jours: number) => ajouterJours(aujourdhui, jours - 45);

const FICHE_ENTREPRISE = {
  raison_sociale: "Plomberie Martin SARL",
  siren: "404833048",
  tva: "FR83404833048",
  representant_prenom: "Claire",
  representant_nom: "Martin",
  representant_fonction: "Gérante",
  siege_adresse: "12 rue des Lilas",
  siege_code_postal: "69003",
  siege_ville: "Lyon",
};

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

/** Un véhicule AB-123-CD et Karim Benali, le conducteur des avis désignés. */
async function semerFlotte(entreprise_id: string) {
  const vehicule = await admin
    .from("vehicule")
    .insert({ entreprise_id, plaque: "AB-123-CD", type: "attitre" })
    .select("id")
    .single();
  if (vehicule.error) throw vehicule.error;
  const karim = await admin.from("conducteur").insert({ entreprise_id, prenom: "Karim", nom: "Benali" }).select("id").single();
  if (karim.error) throw karim.error;
  return { vehicule_id: vehicule.data.id as string, conducteur_id: karim.data.id as string };
}

/** Un avis aux champs remplis, sur AB-123-CD. */
const complet = (vehicule_id: string) => ({
  plaque: "AB-123-CD",
  vehicule_id,
  infraction_le: instantParis(ajouterJours(aujourdhui, -60), "08:30"),
  lieu: "A6, Auxerre, sens Paris-Province",
  infraction: "Excès de vitesse inférieur à 20 km/h",
  montant_centimes: 13500,
});

const tuile = (page: Page, libelle: string) => page.getByRole("group", { name: libelle, exact: true });
/** Le chiffre d'une tuile, sous son libellé. */
const chiffre = (page: Page, libelle: string) => tuile(page, libelle).getByRole("paragraph").nth(1);

test("la liste de démarrage se coche d'elle-même, puis disparaît une fois terminée", async ({ page }) => {
  const email = await connecterNouveauCompte(page, "demarrage");
  const entreprise_id = await entrepriseDe(email);
  const demarrage = page.getByRole("region", { name: "Bien démarrer" });

  await expect(page.getByRole("heading", { name: "Tableau de bord", level: 1 })).toBeVisible();
  await expect(demarrage).toContainText("0/3");
  await expect(demarrage.getByRole("link", { name: "Compléter la fiche" })).toBeVisible();
  await expect(page.getByText("Aucun avis pour l'instant.", { exact: true })).toBeVisible();
  await expect(chiffre(page, "Amendes de non-désignation évitées")).toHaveText("0\u00a0€");

  const fiche = await admin.from("entreprise").update(FICHE_ENTREPRISE).eq("id", entreprise_id);
  if (fiche.error) throw fiche.error;
  await page.reload();
  await expect(demarrage).toContainText("1/3");
  await expect(demarrage.getByRole("link", { name: "Compléter la fiche" })).toHaveCount(0);
  await expect(demarrage.getByRole("link", { name: "Importer un fichier" })).toBeVisible();

  await semerFlotte(entreprise_id);
  await page.reload();
  await expect(demarrage).toContainText("2/3");
  await expect(demarrage.getByRole("link", { name: "Déposer un avis" })).toBeVisible();

  await semer(entreprise_id, [{ numero: "7000000001", statut: "a_traiter" }]);
  await page.reload();
  await expect(page.getByText("1 avis sans échéance")).toBeVisible();
  await expect(demarrage).toHaveCount(0);
});

test("les tuiles chiffrent le suivi, les euros évités se recalculent quand on rouvre un avis", async ({ page }) => {
  const email = await connecterNouveauCompte(page, "tableau-de-bord");
  // 8 avis ce mois-ci, dont 2 désignés au-delà du 5e : en Free, ils seraient verrouillés.
  await passerEnPro(email);
  const entreprise_id = await entrepriseDe(email);
  const { vehicule_id, conducteur_id } = await semerFlotte(entreprise_id);
  const ids = await semer(entreprise_id, [
    { numero: "7100000001", statut: "a_traiter", date_envoi: envoiPourJ(1) },
    { numero: "7100000002", statut: "a_traiter", date_envoi: envoiPourJ(10) },
    { numero: "7100000003", statut: "a_traiter", date_envoi: envoiPourJ(-3) },
    { numero: "7100000004", statut: "a_traiter" },
    { numero: "7100000005", statut: "a_valider", ...complet(vehicule_id), date_envoi: envoiPourJ(30), conducteur_id },
    // Désigné à temps : 675 € évités. Puis désigné après son échéance : rien.
    {
      numero: "7100000006",
      statut: "designe",
      ...complet(vehicule_id),
      date_envoi: envoiPourJ(35),
      conducteur_id,
      designe_le: new Date().toISOString(),
    },
    {
      numero: "7100000007",
      statut: "designe",
      ...complet(vehicule_id),
      date_envoi: envoiPourJ(-5),
      conducteur_id,
      designe_le: new Date().toISOString(),
    },
    {
      numero: "7100000008",
      statut: "classe",
      date_envoi: envoiPourJ(5),
      classe_le: new Date().toISOString(),
      motif_classement: "conteste",
    },
  ]);

  await page.goto("/tableau-de-bord");
  await expect(chiffre(page, "Avis à traiter")).toHaveText("5");
  await expect(tuile(page, "Avis à traiter")).toContainText("4 à traiter · 1 à valider");
  await expect(chiffre(page, "Échéances proches")).toHaveText("3");
  await expect(tuile(page, "Échéances proches")).toContainText("15 jours ou moins · 1 à J-2 ou moins · 1 dépassée");
  await expect(chiffre(page, "Avis désignés")).toHaveText("2");
  await expect(tuile(page, "Avis désignés")).toContainText("dont 2 ce mois-ci");
  const euros = tuile(page, "Amendes de non-désignation évitées");
  await expect(chiffre(page, "Amendes de non-désignation évitées")).toHaveText("675\u00a0€");
  await expect(euros).toContainText("ce mois-ci · 675\u00a0€ en cumul");

  // Les avis ouverts, l'échéance la plus proche d'abord ; l'avis sans date d'envoi est signalé sous la liste.
  const prochaines = page.getByRole("region", { name: "Prochaines échéances" });
  const lignes = prochaines.getByRole("listitem");
  await expect(lignes).toHaveText([/J\+3/, /J-1(?!\d)/, /J-10/, /J-30/]);
  await expect(lignes.first()).toContainText("Échéance dépassée");
  await expect(lignes.nth(3)).toContainText("Karim B.");
  await expect(lignes.nth(3)).toContainText("Excès de vitesse inférieur à 20 km/h");
  await expect(lignes.nth(3)).toContainText("A6, Auxerre, sens Paris-Province · 135,00\u00a0€");
  await expect(prochaines.getByText("1 avis sans échéance")).toBeVisible();

  // Rouvert, l'avis désigné à temps n'évite plus rien.
  await page.goto(`/avis/${ids["7100000006"]}`);
  await page.getByRole("button", { name: "Rouvrir l'avis" }).click();
  await page.getByRole("dialog", { name: "Rouvrir cet avis ?" }).getByRole("button", { name: "Rouvrir" }).click();
  await expect(page.getByRole("main").getByText("À valider", { exact: true })).toBeVisible();

  await page.goto("/tableau-de-bord");
  await expect(chiffre(page, "Amendes de non-désignation évitées")).toHaveText("0\u00a0€");
  await expect(chiffre(page, "Avis désignés")).toHaveText("1");
  await expect(euros).toContainText("ce mois-ci · 0\u00a0€ en cumul");
  await expect(tuile(page, "Avis désignés")).toContainText("dont 1 ce mois-ci");
  await expect(tuile(page, "Avis à traiter")).toContainText("4 à traiter · 2 à valider");
});

test.describe("sur téléphone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("les tuiles passent en 2×2 et les échéances s'empilent, sans défilement horizontal", async ({ page }) => {
    const email = await connecterNouveauCompte(page, "tableau-de-bord-mobile");
    const entreprise_id = await entrepriseDe(email);
    const { vehicule_id, conducteur_id } = await semerFlotte(entreprise_id);
    await semer(entreprise_id, [
      // La pastille la plus large, avec son badge, et une plaque inconnue de la flotte.
      {
        numero: "7200000001",
        statut: "a_valider",
        ...complet(vehicule_id),
        plaque: "ZZ-999-ZZ",
        vehicule_id: null,
        infraction: "Circulation sur une voie réservée aux véhicules de transport public de voyageurs",
        date_envoi: envoiPourJ(-12),
      },
      { numero: "7200000002", statut: "a_valider", ...complet(vehicule_id), date_envoi: envoiPourJ(2), conducteur_id },
      {
        numero: "7200000003",
        statut: "designe",
        ...complet(vehicule_id),
        date_envoi: envoiPourJ(20),
        conducteur_id,
        designe_le: new Date().toISOString(),
      },
    ]);

    await page.reload();
    const tuiles = page.getByRole("group");
    await expect(tuiles).toHaveCount(4);
    for (const une of await tuiles.all()) await expect(une).toBeVisible();
    // 2×2 : les deux premières tuiles sur la même rangée, la troisième dessous.
    const [premiere, deuxieme, troisieme] = await Promise.all([0, 1, 2].map((i) => tuiles.nth(i).boundingBox()));
    expect(premiere!.y).toBe(deuxieme!.y);
    expect(troisieme!.y).toBeGreaterThan(premiere!.y);

    const lignes = page.getByRole("region", { name: "Prochaines échéances" }).getByRole("listitem");
    await expect(lignes).toHaveCount(2);
    await expect(lignes.first()).toContainText("Véhicule inconnu");
    await expect(lignes.first()).toContainText("À choisir");
    await expect(lignes.nth(1)).toContainText("Karim B.");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
