import { expect, test, type Page } from "@playwright/test";
import { ajouterJours, aujourdhuiParis, depuisIso, instantParis } from "@/lib/dates";
import { createAdminClient } from "@/lib/supabase/admin";
import { comptesEtEntreprises, connecterNouveauCompte, emailsRecus, nouvelEmail, passerEnPro } from "./outils";

// L'email au conducteur (phase 21), depuis le récap ANTAI : la case « Prévenir … par email », cochée par défaut en
// Pro, l'aperçu, puis l'envoi au clic sur « J'ai désigné sur l'ANTAI ». Les emails arrivent dans Mailpit. La flotte,
// la fiche entreprise et l'avis « À valider », conducteur validé, sont semés hors RLS.

const admin = createAdminClient();
const aujourdhui = aujourdhuiParis();
const infraction = ajouterJours(aujourdhui, -5);
const SUJET = `Vous avez été désigné conducteur – infraction du ${depuisIso(infraction)} (AB-123-CD)`;

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
  prenom: "Karim",
  nom: "Benali",
  date_naissance: "1985-03-12",
  adresse: "3 allée des Peupliers",
  code_postal: "93100",
  ville: "Montreuil",
  permis_numero: "090169201087",
  permis_delivre_le: "2004-06-01",
};

/** Les deux fiches complètes, AB-123-CD et Karim Benali, avec son email s'il est donné, et l'avis à désigner. */
async function semer(email: string, emailKarim: string | null) {
  const { entreprises } = await comptesEtEntreprises(email);
  const entreprise_id = entreprises[0].id as string;

  const entreprise = await admin.from("entreprise").update(FICHE_ENTREPRISE).eq("id", entreprise_id);
  if (entreprise.error) throw entreprise.error;
  const vehicule = await admin
    .from("vehicule")
    .insert({ entreprise_id, plaque: "AB-123-CD", modele: "Renault Master", type: "attitre" })
    .select("id")
    .single();
  if (vehicule.error) throw vehicule.error;
  const karim = await admin
    .from("conducteur")
    .insert({ entreprise_id, ...FICHE_KARIM, email: emailKarim })
    .select("id")
    .single();
  if (karim.error) throw karim.error;
  const avis = await admin
    .from("avis")
    .insert({
      entreprise_id,
      fichier: `${entreprise_id}/${crypto.randomUUID()}.png`,
      fichier_type: "image/png",
      numero: "8803412578",
      plaque: "AB-123-CD",
      vehicule_id: vehicule.data.id,
      infraction_le: instantParis(infraction, "08:30"),
      lieu: "A6, Auxerre, sens Paris-Province",
      infraction: "Excès de vitesse inférieur à 20 km/h",
      montant_centimes: 13500,
      date_envoi: ajouterJours(aujourdhui, -2),
      statut: "a_valider",
      conducteur_id: karim.data.id,
    })
    .select("id")
    .single();
  if (avis.error) throw avis.error;
  return avis.data.id as string;
}

const caseEmail = (page: Page) => page.getByRole("checkbox", { name: "Prévenir Karim Benali par email" });
const apercu = (page: Page) => page.getByRole("region", { name: "Aperçu de l'email" });

test("en Pro, la case est cochée avec l'aperçu, et l'email part au conducteur au clic", async ({ page }) => {
  const email = await connecterNouveauCompte(page, "email-conducteur");
  await passerEnPro(email);
  const emailKarim = nouvelEmail("karim");
  const id = await semer(email, emailKarim);

  await page.goto(`/avis/${id}/recap`);
  await expect(caseEmail(page)).toBeChecked();
  await expect(apercu(page)).toContainText(emailKarim);
  await expect(apercu(page)).toContainText(SUJET);
  await expect(apercu(page)).toContainText(email);
  await expect(apercu(page)).toContainText("Bonjour Karim,");
  await expect(apercu(page)).toContainText("135,00");

  // Décochée, l'aperçu disparaît ; recochée, il revient.
  await caseEmail(page).uncheck();
  await expect(apercu(page)).toHaveCount(0);
  await caseEmail(page).check();
  await expect(apercu(page)).toBeVisible();

  await page.getByRole("button", { name: "J'ai désigné sur l'ANTAI" }).click();
  await expect(
    page.getByText(
      new RegExp(`^Désigné le ${depuisIso(aujourdhui)} à \\d{2}:\\d{2}\\. Karim Benali a été prévenu par email\\.$`),
    ),
  ).toBeVisible();
  await expect(caseEmail(page)).toHaveCount(0);

  // Un seul email, au nom de l'entreprise, et les réponses vont au gestionnaire.
  await expect.poll(async () => (await emailsRecus(emailKarim)).length).toBe(1);
  const [recu] = await emailsRecus(emailKarim);
  expect(recu).toMatchObject({ sujet: SUJET, expediteur: "Plomberie Martin SARL via Désigno", repondreA: [email] });
  expect(recu.texte).toContain("Véhicule : AB-123-CD · Renault Master");
  expect(recu.html).not.toContain("href");

  // L'avis garde la trace de l'email.
  await page.goto(`/avis/${id}`);
  await expect(page.getByText("Karim Benali a été prévenu par email.", { exact: true })).toBeVisible();
});

test("sans email, la case est désactivée, puis l'email s'ajoute sur place et la case s'active, cochée", async ({
  page,
}) => {
  const email = await connecterNouveauCompte(page, "email-conducteur-manquant");
  await passerEnPro(email);
  const id = await semer(email, null);

  await page.goto(`/avis/${id}/recap`);
  await expect(caseEmail(page)).toBeDisabled();
  await expect(caseEmail(page)).not.toBeChecked();
  await expect(page.getByText(/email manquant/)).toBeVisible();
  await expect(apercu(page)).toHaveCount(0);

  await page.getByRole("button", { name: "Ajouter son email" }).click();
  const fenetre = page.getByRole("dialog", { name: "Email de Karim Benali" });
  await fenetre.getByLabel("Email").fill("karim.benali@exemple.fr");
  await fenetre.getByRole("button", { name: "Enregistrer" }).click();
  await expect(fenetre).toHaveCount(0);

  await expect(caseEmail(page)).toBeEnabled();
  await expect(caseEmail(page)).toBeChecked();
  await expect(apercu(page)).toContainText("karim.benali@exemple.fr");
});

test("en Free, le cadenas « Email au conducteur » remplace la case", async ({ page }) => {
  const email = await connecterNouveauCompte(page, "email-conducteur-free");
  const id = await semer(email, nouvelEmail("karim-free"));

  await page.goto(`/avis/${id}/recap`);
  const cadenas = page.getByRole("group", { name: "Email au conducteur" });
  await expect(cadenas).toBeVisible();
  await expect(cadenas.getByRole("link", { name: "Passer en Pro" })).toBeVisible();
  await expect(caseEmail(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "J'ai désigné sur l'ANTAI" })).toBeVisible();
});
