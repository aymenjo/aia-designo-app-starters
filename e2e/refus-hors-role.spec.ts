import { expect, test } from "@playwright/test";
import { createAdminClient } from "@/lib/supabase/admin";
import { comptesEtEntreprises, connecterNouveauCompte, passerEnPro } from "./outils";

// Demande à Désigno, phase 31 : une demande hors rôle reçoit une phrase de refus et le lien de l'écran où agir. Aucun
// appel à l'API Claude : l'envoi est intercepté, et la route enregistre la demande et la réponse comme le serveur.

const admin = createAdminClient();
const DEMANDE = "Résilie mon abonnement Pro.";
const REFUS =
  "Je ne peux pas résilier votre abonnement. Ouvrez [Abonnement](/parametres/abonnement) : le portail client permet de l'annuler.";

function verifier<T>({ data, error }: { data: T; error: unknown }): NonNullable<T> {
  if (error) throw error;
  return data as NonNullable<T>;
}

test("une demande hors rôle reçoit son refus en une phrase, et le lien ouvre l'écran où agir", async ({ page }) => {
  const email = await connecterNouveauCompte(page, "agent-hors-role");
  await passerEnPro(email);
  const { entreprises } = await comptesEtEntreprises(email);
  const entreprise_id = entreprises[0].id as string;

  await page.goto("/tableau-de-bord");
  await page.getByRole("button", { name: "Demande à Désigno" }).click();
  const panneau = page.getByRole("complementary", { name: "Demande à Désigno" });

  let envoye: unknown = null;
  await page.route("**/api/agent", async (route) => {
    envoye = route.request().postDataJSON();
    const conversation = verifier(
      await admin.from("conversation").insert({ entreprise_id, premiere_demande: DEMANDE }).select("id").single(),
    ).id;
    const [, message] = verifier(
      await admin
        .from("message")
        .insert([
          { conversation_id: conversation, entreprise_id, role: "gestionnaire", contenu: DEMANDE },
          { conversation_id: conversation, entreprise_id, role: "agent", contenu: REFUS },
        ])
        .select("id, role, contenu, erreur, elements_cites, cree_le"),
    );
    const lignes = [{ type: "attente", demandes: 1 }, { type: "message", message }];
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body: lignes.map((ligne) => JSON.stringify(ligne)).join("\n"),
    });
  });
  await panneau.getByLabel("Votre demande").fill(DEMANDE);
  await panneau.getByRole("button", { name: "Envoyer" }).click();
  await expect(panneau.getByText("Je ne peux pas résilier votre abonnement.")).toBeVisible();
  expect(envoye).toEqual({ texte: DEMANDE });

  // L'écran de l'abonnement est un lien autorisé : le clic l'ouvre, et le panneau reste ouvert.
  const lien = panneau.getByRole("link", { name: "Abonnement" });
  await expect(lien).toHaveAttribute("href", "/parametres/abonnement");
  await lien.click();
  await expect(page).toHaveURL(/\/parametres\/abonnement$/);
  await expect(panneau).toBeVisible();
});
