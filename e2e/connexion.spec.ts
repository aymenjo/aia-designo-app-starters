import { expect, test } from "@playwright/test";
import {
  attendreNouveauLien,
  comptesEtEntreprises,
  demanderLien,
  nouvelEmail,
  seConnecterAvec,
} from "./outils";

test("un nouvel email crée le compte et l'entreprise, puis le même email rouvre le même compte", async ({
  browser,
}) => {
  const email = nouvelEmail("inscription");

  const premier = await browser.newPage();
  await demanderLien(premier, email);
  await seConnecterAvec(premier, await attendreNouveauLien(email, 0));
  await expect(premier).toHaveURL(/\/tableau-de-bord$/);
  await expect(premier.getByRole("heading", { name: "Tableau de bord" })).toBeVisible();

  const apresInscription = await comptesEtEntreprises(email);
  expect(apresInscription.comptes).toHaveLength(1);
  expect(apresInscription.entreprises).toHaveLength(1);

  // Un autre appareil, le même email.
  const second = await browser.newPage();
  await demanderLien(second, email);
  await seConnecterAvec(second, await attendreNouveauLien(email, 1));
  await expect(second).toHaveURL(/\/tableau-de-bord$/);

  const apresConnexion = await comptesEtEntreprises(email);
  expect(apresConnexion.comptes.map((c) => c.id)).toEqual(apresInscription.comptes.map((c) => c.id));
  expect(apresConnexion.entreprises).toEqual(apresInscription.entreprises);
});

test("un lien déjà utilisé mène à lien-invalide, d'où un nouveau lien part en un clic", async ({ page }) => {
  const email = nouvelEmail("reutilise");
  await demanderLien(page, email);
  const lien = await attendreNouveauLien(email, 0);
  await seConnecterAvec(page, lien);
  await expect(page).toHaveURL(/\/tableau-de-bord$/);

  await seConnecterAvec(page, lien);
  await expect(page).toHaveURL(/\/connexion\/lien-invalide$/);
  await expect(page.getByRole("heading", { name: "Ce lien a expiré ou a déjà servi" })).toBeVisible();

  const [local, domaine] = email.split("@");
  await page.getByRole("button", { name: `Recevoir un nouveau lien à ${local[0]}…@${domaine}` }).click();
  await expect(page.getByRole("heading", { name: "Vérifiez votre boîte mail" })).toBeVisible();

  const nouveau = await attendreNouveauLien(email, 1);
  expect(nouveau).not.toEqual(lien);
});

test("un lien sans jeton ou au jeton inconnu mène à lien-invalide, avec le champ email", async ({ page }) => {
  await page.goto("/connexion/confirmer");
  await expect(page).toHaveURL(/\/connexion\/lien-invalide$/);

  await seConnecterAvec(page, "/connexion/confirmer?token_hash=inconnu&type=email");
  await expect(page).toHaveURL(/\/connexion\/lien-invalide$/);
  await expect(page.getByLabel("Adresse email")).toBeVisible();
  await expect(page.getByRole("button", { name: "Recevoir un nouveau lien" })).toBeVisible();
});

test("sans session, l'application redirige vers /connexion puis rouvre la page demandée", async ({ page }) => {
  await page.goto("/tableau-de-bord");
  await expect(page).toHaveURL(/\/connexion$/);

  await page.goto("/");
  await expect(page).toHaveURL(/\/connexion$/);

  await page.goto("/connexion?suivant=%2Ftableau-de-bord%3Fbienvenue%3D1");
  const email = nouvelEmail("suivant");
  await page.getByLabel("Adresse email").fill(email);
  await page.getByRole("button", { name: "Recevoir mon lien" }).click();
  await seConnecterAvec(page, await attendreNouveauLien(email, 0));
  await expect(page).toHaveURL(/\/tableau-de-bord\?bienvenue=1$/);
});

test("une adresse mal formée est signalée sans envoyer de lien", async ({ page }) => {
  await page.goto("/connexion");
  await page.getByLabel("Adresse email").fill("pas-une-adresse");
  await page.getByRole("button", { name: "Recevoir mon lien" }).click();
  await expect(page.getByText("Cette adresse email n'est pas valide.")).toBeVisible();
});

test("la déconnexion ramène sur /connexion et ferme l'accès", async ({ page }) => {
  const email = nouvelEmail("deconnexion");
  await demanderLien(page, email);
  await seConnecterAvec(page, await attendreNouveauLien(email, 0));
  await expect(page).toHaveURL(/\/tableau-de-bord$/);

  await page.getByRole("button", { name: "Mon compte" }).click();
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await expect(page).toHaveURL(/\/connexion$/);

  await page.goto("/tableau-de-bord");
  await expect(page).toHaveURL(/\/connexion$/);
});
