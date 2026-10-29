import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { URL_ANTAI } from "@/lib/avis/recap";
import { ajouterJours, aujourdhuiParis, depuisIso, instantParis } from "@/lib/dates";
import { createAdminClient } from "@/lib/supabase/admin";
import { comptesEtEntreprises, connecterNouveauCompte } from "./outils";

// Le récap ANTAI et le passage en « Désigné » (phase 11). La flotte et la fiche entreprise sont semées hors RLS ;
// l'avis du chemin nominal est déposé puis saisi à la main, comme un avis que l'IA n'a pas su lire.

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const admin = createAdminClient();
const FICHIERS = path.join(__dirname, "fichiers");
const URL_AVIS = /\/avis\/[0-9a-f-]{36}$/;
/** Le dépôt attend la lecture IA quand le serveur a une clé d'API : le faux avis revient alors tout en rouge. */
const APRES_DEPOT = { timeout: 30_000 };
/** Critère de succès du PRD : du dépôt au récap prêt à copier, en moins de 3 minutes. */
const TROIS_MINUTES = 180_000;

const aujourdhui = aujourdhuiParis();

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

const FICHE_KARIM = {
  civilite: "m",
  date_naissance: "1985-03-12",
  adresse: "3 allée des Peupliers",
  code_postal: "93100",
  ville: "Montreuil",
  permis_numero: "090169201087",
  permis_delivre_le: "2004-06-01",
};

/**
 * L'entreprise du compte, un véhicule AB-123-CD et Karim Benali. `complet` : les deux fiches sont complètes, et Karim
 * a le véhicule depuis 30 jours ; sinon, l'entreprise n'a que sa raison sociale, et Karim que son prénom et son nom.
 */
async function semer(email: string, complet: boolean) {
  const { entreprises } = await comptesEtEntreprises(email);
  const entreprise_id = entreprises[0].id as string;

  const fiche = complet ? FICHE_ENTREPRISE : { raison_sociale: FICHE_ENTREPRISE.raison_sociale };
  const entreprise = await admin.from("entreprise").update(fiche).eq("id", entreprise_id);
  if (entreprise.error) throw entreprise.error;
  const vehicule = await admin
    .from("vehicule")
    .insert({ entreprise_id, plaque: "AB-123-CD", modele: "Renault Master", type: "attitre" })
    .select("id")
    .single();
  if (vehicule.error) throw vehicule.error;
  const karim = await admin
    .from("conducteur")
    .insert({ entreprise_id, prenom: "Karim", nom: "Benali", ...(complet && FICHE_KARIM) })
    .select("id")
    .single();
  if (karim.error) throw karim.error;
  if (complet) {
    const affectation = await admin.from("affectation").insert({
      entreprise_id,
      vehicule_id: vehicule.data.id,
      conducteur_id: karim.data.id,
      debut: instantParis(ajouterJours(aujourdhui, -30), "00:00"),
    });
    if (affectation.error) throw affectation.error;
  }
  return { entreprise_id, vehicule: vehicule.data.id as string, karim: karim.data.id as string };
}

const copier = (page: Page, libelle: string) => page.getByRole("button", { name: `Copier ${libelle}`, exact: true });
const copie = (page: Page, libelle: string) => page.getByRole("button", { name: `Copié ${libelle}`, exact: true });
const pressePapiers = (page: Page) => page.evaluate(() => navigator.clipboard.readText());

test("du dépôt au récap en moins de 3 minutes, la copie champ par champ, puis « J'ai désigné sur l'ANTAI »", async ({
  page,
}) => {
  test.setTimeout(TROIS_MINUTES + 60_000);
  const email = await connecterNouveauCompte(page, "recap-nominal");
  await semer(email, true);

  // Le chronomètre part du dépôt.
  const depot = Date.now();
  await page.goto("/avis/nouveau");
  await page.locator('input[type="file"]:not([capture])').setInputFiles(path.join(FICHIERS, "avis.png"));
  await expect(page).toHaveURL(URL_AVIS, APRES_DEPOT);
  const urlAvis = page.url();

  await page.getByLabel("N° d'avis").fill("8803412576");
  await page.getByLabel("Plaque").fill("AB-123-CD");
  await page.getByLabel("Date de l'infraction").fill(depuisIso(ajouterJours(aujourdhui, -3)));
  await page.getByLabel("Heure", { exact: true }).fill("08:30");
  await page.getByLabel("Lieu").fill("A6, Auxerre, sens Paris-Province");
  await page.getByLabel("Infraction", { exact: true }).fill("Excès de vitesse inférieur à 20 km/h");
  await page.getByLabel("Montant (amende forfaitaire)").fill("135");
  await page.getByLabel("Date d'envoi").fill(depuisIso(ajouterJours(aujourdhui, -1)));
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("À valider", { exact: true })).toBeVisible();

  await expect(page.getByText(/Proposé d'après le planning\s*:\s*Karim Benali/)).toBeVisible();
  // Le récap ne se propose qu'une fois le conducteur validé.
  await expect(page.getByRole("link", { name: "Ouvrir le récap ANTAI" })).toHaveCount(0);
  await page.getByRole("button", { name: "Valider ce conducteur" }).click();
  await page.getByRole("link", { name: "Ouvrir le récap ANTAI" }).click();

  await expect(page).toHaveURL(/\/avis\/[0-9a-f-]{36}\/recap$/);
  await expect(page.getByRole("heading", { name: "Récap ANTAI · avis n° 8803412576", level: 1 })).toBeVisible();
  await expect(copier(page, "N° d'avis")).toBeVisible();
  expect(Date.now() - depot).toBeLessThan(TROIS_MINUTES);

  // Les 3 blocs, avec les dates au format JJ/MM/AAAA.
  for (const bloc of ["Avis", "Entreprise", "Conducteur"]) {
    await expect(page.getByRole("heading", { name: bloc, exact: true, level: 2 })).toBeVisible();
  }
  await expect(page.getByText(depuisIso(ajouterJours(aujourdhui, -3)), { exact: true })).toBeVisible();
  await expect(page.getByText("08:30", { exact: true })).toBeVisible();
  await expect(page.getByText("404833048", { exact: true })).toBeVisible();
  await expect(page.getByText("12/03/1985", { exact: true })).toBeVisible();
  await expect(page.getByText("090169201087", { exact: true })).toBeVisible();

  // Un champ copié à la fois : « Copié » passe au champ suivant, puis revient à « Copier » au bout de 1,5 s.
  await copier(page, "N° d'avis").click();
  await expect(copie(page, "N° d'avis")).toHaveText("Copié");
  expect(await pressePapiers(page)).toBe("8803412576");
  await copier(page, "Plaque").click();
  await expect(copie(page, "Plaque")).toBeVisible();
  await expect(copier(page, "N° d'avis")).toHaveText("Copier");
  expect(await pressePapiers(page)).toBe("AB-123-CD");
  await expect(copier(page, "Plaque")).toBeVisible({ timeout: 3_000 });

  const antai = page.getByRole("link", { name: "Ouvrir le site de l'ANTAI" });
  await expect(antai).toHaveAttribute("href", URL_ANTAI);
  await expect(antai).toHaveAttribute("target", "_blank");
  await expect(antai).toHaveAttribute("rel", "noopener noreferrer");

  // Rien n'est désigné avant le clic.
  await expect(page.getByText("À valider", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "J'ai désigné sur l'ANTAI" }).click();
  await expect(page.getByText(new RegExp(`^Désigné le ${depuisIso(aujourdhui)} à \\d{2}:\\d{2}\\.$`))).toBeVisible();
  await expect(page.getByRole("button", { name: "J'ai désigné sur l'ANTAI" })).toHaveCount(0);
  await expect(page.getByRole("main").getByText("Désigné", { exact: true })).toBeVisible();

  // L'avis porte la désignation, et la liste sa pastille verte.
  await page.goto(urlAvis);
  await expect(page.getByRole("link", { name: "Voir le récap ANTAI" })).toBeVisible();
  await expect(page.getByText(/Conducteur désigné\s*:\s*Karim Benali/)).toBeVisible();
  await expect(page.getByText(`Désigné le ${depuisIso(aujourdhui)}`, { exact: true })).toBeVisible();

  await page.goto("/avis");
  const ligne = page.getByRole("link", { name: /8803412576/ });
  await expect(ligne).toContainText(`Désigné le ${depuisIso(aujourdhui).slice(0, 5)}`);
  await expect(ligne).toContainText("Désigné");
});

test("des fiches incomplètes se complètent sur place, sans toucher au reste, puis le récap s'ouvre", async ({
  page,
}) => {
  const email = await connecterNouveauCompte(page, "recap-incomplet");
  const { entreprise_id, vehicule, karim } = await semer(email, false);
  const avis = await admin
    .from("avis")
    .insert({
      entreprise_id,
      fichier: `${entreprise_id}/${crypto.randomUUID()}.png`,
      fichier_type: "image/png",
      numero: "8803412577",
      plaque: "AB-123-CD",
      vehicule_id: vehicule,
      infraction_le: instantParis(ajouterJours(aujourdhui, -5), "08:30"),
      lieu: "A6, Auxerre, sens Paris-Province",
      infraction: "Excès de vitesse inférieur à 20 km/h",
      montant_centimes: 13500,
      date_envoi: ajouterJours(aujourdhui, -2),
      statut: "a_valider",
      conducteur_id: karim,
    })
    .select("id")
    .single();
  if (avis.error) throw avis.error;

  await page.goto(`/avis/${avis.data.id}/recap`);
  await expect(page.getByText(/Pour ouvrir le récap, complétez\s*:/)).toBeVisible();
  await expect(copier(page, "N° d'avis")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "J'ai désigné sur l'ANTAI" })).toHaveCount(0);

  // Seuls les champs manquants sont demandés : ni le prénom, ni le nom, déjà remplis.
  const conducteur = page.getByRole("region", { name: "Fiche de Karim Benali" });
  await expect(conducteur.getByLabel("Prénom")).toHaveCount(0);
  await expect(conducteur.getByLabel("Nom", { exact: true })).toHaveCount(0);
  await expect(conducteur.getByLabel("Email")).toHaveCount(0);
  await conducteur.getByRole("radio", { name: "M." }).check();
  await conducteur.getByLabel("Date de naissance").fill("12/03/1985");
  await conducteur.getByLabel("Adresse", { exact: true }).fill("3 allée des Peupliers");
  await conducteur.getByLabel("Code postal").fill("93100");
  await conducteur.getByLabel("Ville").fill("Montreuil");
  await conducteur.getByLabel("N° de permis").fill("090169201087");
  await conducteur.getByLabel("Date de délivrance").fill("01/06/2004");
  await conducteur.getByRole("button", { name: "Enregistrer" }).click();
  await expect(conducteur).toHaveCount(0);

  const entreprise = page.getByRole("region", { name: "Fiche entreprise" });
  await expect(entreprise.getByLabel("Raison sociale")).toHaveCount(0);
  await entreprise.getByLabel("SIREN").fill("404 833 048");
  await entreprise.getByLabel("SIREN").blur();
  // La TVA est proposée d'après le SIREN.
  await expect(entreprise.getByLabel("N° de TVA intracommunautaire")).toHaveValue("FR83404833048");
  await entreprise.getByLabel("Prénom").fill("Claire");
  await entreprise.getByLabel("Nom", { exact: true }).fill("Martin");
  await entreprise.getByLabel("Fonction").fill("Gérante");
  await entreprise.getByLabel("Adresse", { exact: true }).fill("12 rue des Lilas");
  await entreprise.getByLabel("Code postal").fill("69003");
  await entreprise.getByLabel("Ville").fill("Lyon");
  await entreprise.getByRole("button", { name: "Enregistrer" }).click();

  // Les deux fiches complètes, le récap s'ouvre sur la même page.
  await expect(copier(page, "N° d'avis")).toBeVisible();
  for (const bloc of ["Avis", "Entreprise", "Conducteur"]) {
    await expect(page.getByRole("heading", { name: bloc, exact: true, level: 2 })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "J'ai désigné sur l'ANTAI" })).toBeVisible();

  // Le reste des fiches n'a pas changé.
  const { data: fiche } = await admin
    .from("conducteur")
    .select("prenom, nom, civilite, permis_numero")
    .eq("id", karim)
    .single();
  expect(fiche).toEqual({ prenom: "Karim", nom: "Benali", civilite: "m", permis_numero: "090169201087" });
  const { data: societe } = await admin.from("entreprise").select("raison_sociale, siren, tva").eq("id", entreprise_id).single();
  expect(societe).toEqual({ raison_sociale: "Plomberie Martin SARL", siren: "404833048", tva: "FR83404833048" });
});
