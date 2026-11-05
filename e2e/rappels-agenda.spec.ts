import { expect, test, type Page } from "@playwright/test";
import { FONCTIONS_PRO } from "@/lib/abonnement/plans";
import { MESSAGES_AGENDA } from "@/lib/agenda/regles";
import { createAdminClient } from "@/lib/supabase/admin";
import { idComposio } from "../tests/composio";
import { comptesEtEntreprises, connecterNouveauCompte, passerEnPro } from "./outils";

// Les rappels Google Calendar (phase 22). La connexion est semée avec la clé secrète, comme après « Connecter Google
// Calendar » : les pages de Google et de Composio ne sont jamais ouvertes, et aucun événement n'est posé.

const admin = createAdminClient();

/** La connexion de l'agenda de l'entreprise du compte, active depuis le 26/10/2026 à 09:00. */
async function connecterAgenda(email: string, champs: Record<string, unknown> = {}) {
  const { entreprises } = await comptesEtEntreprises(email);
  const { error } = await admin.from("connexion_google").insert({
    entreprise_id: entreprises[0].id as string,
    service: "agenda",
    compte_id: idComposio("ca"),
    email_compte: "agenda@exemple.fr",
    agenda_id: `designo-${idComposio("ca")}@group.calendar.google.com`,
    active_depuis: "2026-10-26T08:00:00Z",
    ...champs,
  });
  if (error) throw error;
}

const reglages = (page: Page) => page.getByRole("navigation", { name: "Réglages" });
const carte = (page: Page) => page.getByRole("region", { name: "Rappels Google Calendar" });
const EXPLICATION = FONCTIONS_PRO.find(({ nom }) => nom === "Rappels Google Calendar")!.explication;

test("en Free, les rappels Google Calendar sont cadenassés", async ({ page }) => {
  await connecterNouveauCompte(page, "agenda-free");
  await reglages(page).getByRole("link", { name: "Intégrations" }).click();
  await expect(page.getByRole("heading", { name: "Intégrations", level: 1 })).toBeVisible();
  const cadenas = carte(page).getByRole("group", { name: "Rappels Google Calendar" });
  await expect(cadenas).toContainText(EXPLICATION);
  await expect(cadenas.getByRole("link", { name: "Passer en Pro" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Connecter Google Calendar" })).toHaveCount(0);
});

test("en Free, un agenda resté connecté est en pause, avec la déconnexion", async ({ page }) => {
  const email = await connecterNouveauCompte(page, "agenda-pause");
  await connecterAgenda(email);
  await page.goto("/parametres/integrations");
  await expect(carte(page).getByRole("group", { name: "Rappels en pause" })).toContainText(MESSAGES_AGENDA.pause);
  await expect(carte(page).getByRole("button", { name: "Déconnecter Google Calendar" })).toBeVisible();
});

test("en Pro, la carte montre le compte et l'agenda « Désigno », avec la déconnexion", async ({ page }) => {
  const email = await connecterNouveauCompte(page, "agenda-actif");
  await passerEnPro(email);
  await connecterAgenda(email);
  await page.goto("/parametres/integrations");
  await expect(carte(page)).toContainText("agenda@exemple.fr");
  await expect(carte(page)).toContainText("« Désigno »");
  await expect(carte(page)).toContainText("Rappels actifs depuis le");
  await expect(carte(page)).toContainText("26/10/2026 à 09:00");
  await expect(carte(page).getByRole("button", { name: "Reconnecter Google Calendar" })).toHaveCount(0);

  await carte(page).getByRole("button", { name: "Déconnecter Google Calendar" }).click();
  const fenetre = page.getByRole("dialog", { name: "Déconnecter Google Calendar ?" });
  await expect(fenetre).toContainText(MESSAGES_AGENDA.deconnexion);
});

test("des rappels interrompus se voient sur la carte, sans bandeau, avec « Reconnecter Google Calendar »", async ({ page }) => {
  const email = await connecterNouveauCompte(page, "agenda-interrompu");
  await passerEnPro(email);
  await connecterAgenda(email, { interrompue_le: "2026-10-28T07:30:00Z" });
  await page.goto("/parametres/integrations");
  await expect(carte(page)).toContainText("Rappels interrompus depuis le");
  await expect(carte(page)).toContainText("28/10/2026 à 08:30");
  await expect(carte(page).getByRole("alert")).toContainText(MESSAGES_AGENDA.interrompus);
  await expect(carte(page).getByRole("button", { name: "Reconnecter Google Calendar" })).toBeVisible();

  // Aucun bandeau ailleurs : les alertes par email continuent.
  await page.goto("/tableau-de-bord");
  await expect(page.getByText("Les rappels sont interrompus")).toHaveCount(0);
});
