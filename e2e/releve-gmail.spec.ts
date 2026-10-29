import path from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { FONCTIONS_PRO } from "@/lib/abonnement/plans";
import { SUJET_INTERRUPTION } from "@/lib/gmail/email-interruption";
import { MESSAGES_GMAIL } from "@/lib/gmail/regles";
import { createAdminClient } from "@/lib/supabase/admin";
import { evenementEmail, evenementExpiration, idComposio, signer } from "../tests/composio";
import { comptesEtEntreprises, connecterNouveauCompte, emailsRecus, passerEnPro } from "./outils";

// La relève Gmail (phase 23). La connexion est semée avec la clé secrète, comme après « Connecter Gmail » : les pages de
// Google et de Composio ne sont jamais ouvertes. Le webhook reçoit des événements signés avec le secret local.

const admin = createAdminClient();
const WEBHOOK = "/api/webhooks/composio";
const FICHIERS = path.join(__dirname, "fichiers");
const URL_AVIS = /\/avis\/[0-9a-f-]{36}$/;

/** La connexion de l'entreprise du compte : boîte connectée, libellé « Avis » relevé. */
async function connecterGmail(email: string, champs: Record<string, unknown> = {}) {
  const { entreprises } = await comptesEtEntreprises(email);
  const connexion = {
    entreprise_id: entreprises[0].id as string,
    service: "gmail",
    compte_id: idComposio("ca"),
    email_compte: "boite@exemple.fr",
    libelle_id: "Label_avis",
    libelle_nom: "Avis",
    declencheur_id: idComposio("ti"),
    active_depuis: "2026-10-26T08:00:00Z",
    ...champs,
  };
  const { error } = await admin.from("connexion_google").insert(connexion);
  if (error) throw error;
  return connexion;
}

/** Poste l'événement comme Composio : le corps brut, signé. */
async function poster(request: APIRequestContext, evenement: unknown, secret?: string) {
  const { corps, entetes } = signer(evenement, secret);
  return request.post(WEBHOOK, { data: corps, headers: { "content-type": "application/json", ...Object.fromEntries(entetes) } });
}

const reglages = (page: Page) => page.getByRole("navigation", { name: "Réglages" });
const EXPLICATION = FONCTIONS_PRO.find(({ nom }) => nom === "Relève Gmail")!.explication;

test("en Free, la relève Gmail est cadenassée", async ({ page }) => {
  await connecterNouveauCompte(page, "gmail-free");
  await reglages(page).getByRole("link", { name: "Intégrations" }).click();
  await expect(page.getByRole("heading", { name: "Intégrations", level: 1 })).toBeVisible();
  const cadenas = page.getByRole("group", { name: "Relève Gmail" });
  await expect(cadenas).toContainText(EXPLICATION);
  await expect(cadenas.getByRole("link", { name: "Passer en Pro" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Connecter Gmail" })).toHaveCount(0);
});

test("en Pro, la carte montre la boîte et le libellé relevés", async ({ page }) => {
  const email = await connecterNouveauCompte(page, "gmail-active");
  await passerEnPro(email);
  await connecterGmail(email);
  await page.goto("/parametres/integrations");
  const carte = page.getByRole("region", { name: "Relève Gmail" });
  await expect(carte).toContainText("boite@exemple.fr");
  await expect(carte).toContainText("« Avis »");
  await expect(carte).toContainText("26/10/2026 à 09:00");
  await expect(carte.getByRole("button", { name: "Déconnecter Gmail" })).toBeVisible();
});

test("un email sans pièce jointe va dans les non exploitables, puis « Ignorer » le retire", async ({ page, request }) => {
  const email = await connecterNouveauCompte(page, "gmail-ignorer");
  await passerEnPro(email);
  const connexion = await connecterGmail(email);
  const evenement = evenementEmail({
    declencheur: connexion.declencheur_id,
    compte: connexion.compte_id,
    objet: "Avis de contravention n° 1",
  });
  expect((await poster(request, evenement)).status()).toBe(200);

  await page.goto("/avis");
  await page.getByRole("link", { name: "Emails non exploitables · 1" }).click();
  await expect(page.getByRole("heading", { name: "Emails non exploitables", level: 1 })).toBeVisible();
  const ligne = page.getByRole("listitem").filter({ hasText: "Avis de contravention n° 1" });
  await expect(ligne).toContainText(MESSAGES_GMAIL.sansPieceJointe);
  await expect(ligne.getByRole("link", { name: "Ouvrir dans Gmail" })).toHaveAttribute(
    "href",
    `https://mail.google.com/mail/u/boite%40exemple.fr/#all/${evenement.data.id}`,
  );

  await ligne.getByRole("button", { name: "Ignorer" }).click();
  await expect(page.getByText("Aucun email non exploitable")).toBeVisible();
  await page.goto("/avis");
  await expect(page.getByRole("link", { name: /Emails non exploitables/ })).toHaveCount(0);
});

test("« Déposer manuellement » donne un avis rattaché à son email", async ({ page, request }) => {
  const email = await connecterNouveauCompte(page, "gmail-deposer");
  await passerEnPro(email);
  const connexion = await connecterGmail(email);
  const evenement = evenementEmail({
    declencheur: connexion.declencheur_id,
    compte: connexion.compte_id,
    objet: "Photo de l'avis",
    expediteur: "Karim <karim@exemple.fr>",
  });
  expect((await poster(request, evenement)).status()).toBe(200);

  await page.goto("/avis/emails-non-exploitables");
  await page.getByRole("link", { name: "Déposer manuellement" }).click();
  const rappel = page.getByRole("region", { name: "Email d'origine" });
  await expect(rappel).toContainText("Photo de l'avis");
  await expect(rappel).toContainText("Karim <karim@exemple.fr>");

  await page.locator('input[type="file"]:not([capture])').setInputFiles(path.join(FICHIERS, "avis.png"));
  await expect(page).toHaveURL(URL_AVIS, { timeout: 30_000 });
  const bloc = page.locator("section").filter({ has: page.getByRole("heading", { name: "Reçu par Gmail" }) });
  await expect(bloc).toContainText("Photo de l'avis");
  await expect(bloc).toContainText("Karim <karim@exemple.fr>");
  await expect(bloc.getByRole("link", { name: "Ouvrir dans Gmail" })).toBeVisible();

  await page.goto("/avis/emails-non-exploitables");
  await expect(page.getByText("Aucun email non exploitable")).toBeVisible();
});

test("un compte expiré affiche le bandeau sur chaque écran, et envoie un seul email", async ({ page, request }) => {
  const email = await connecterNouveauCompte(page, "gmail-expire");
  await passerEnPro(email);
  const connexion = await connecterGmail(email);
  const expiration = evenementExpiration(connexion.compte_id);
  expect((await poster(request, expiration)).status()).toBe(200);
  // Composio relance le même événement : l'interruption est déjà signalée.
  expect((await poster(request, expiration)).status()).toBe(200);

  await page.goto("/tableau-de-bord");
  const bandeau = page.getByRole("alert").filter({ hasText: "La relève Gmail est interrompue" });
  await expect(bandeau).toContainText("« Avis »");
  await expect(bandeau.getByRole("button", { name: "Reconnecter Gmail" })).toBeVisible();
  await page.goto("/avis");
  await expect(bandeau).toBeVisible();
  await page.goto("/parametres/integrations");
  await expect(bandeau).toBeVisible();

  await expect.poll(async () => (await emailsRecus(email)).filter(({ sujet }) => sujet === SUJET_INTERRUPTION).length).toBe(1);
});

test("une signature forgée est refusée", async ({ request }) => {
  const reponse = await poster(request, evenementExpiration(idComposio("ca")), "forge");
  expect(reponse.status()).toBe(400);
});
