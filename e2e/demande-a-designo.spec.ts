import { expect, test } from "@playwright/test";
import { FONCTIONS_PRO } from "@/lib/abonnement/plans";
import { EXEMPLES, MESSAGES_AGENT } from "@/lib/agent/regles";
import { createAdminClient } from "@/lib/supabase/admin";
import { comptesEtEntreprises, connecterNouveauCompte, passerEnPro } from "./outils";

// Demande à Désigno (phase 26) : le panneau, ses exemples, les liens d'une réponse et « Nouvelle conversation ». Aucun
// appel à l'API Claude : la conversation est semée hors RLS, et l'envoi d'un exemple est intercepté.

const admin = createAdminClient();
const PRO = FONCTIONS_PRO.find(({ nom }) => nom === "Demande à Désigno")!;
const QUESTION = "Qui conduisait AB-123-CD le 12/03 ?";

async function entrepriseDe(email: string) {
  const { entreprises } = await comptesEtEntreprises(email);
  return entreprises[0].id as string;
}

function verifier<T>({ data, error }: { data: T; error: unknown }): NonNullable<T> {
  if (error) throw error;
  return data as NonNullable<T>;
}

test("en Pro, le panneau s'ouvre sans changer d'écran, envoie un exemple d'un clic, et les liens de ses réponses ouvrent la bonne fiche", async ({
  page,
}) => {
  const email = await connecterNouveauCompte(page, "agent-pro");
  await passerEnPro(email);
  const entreprise_id = await entrepriseDe(email);
  const vehicule = verifier(
    await admin.from("vehicule").insert({ entreprise_id, plaque: "AB-123-CD", modele: "Renault Master", type: "attitre" }).select("id").single(),
  ).id;
  const conducteur = verifier(
    await admin.from("conducteur").insert({ entreprise_id, prenom: "Karim", nom: "Benali" }).select("id").single(),
  ).id;

  // Le bouton est sur chaque écran de l'application.
  for (const ecran of ["/tableau-de-bord", "/avis", "/parametres/entreprise"]) {
    await page.goto(ecran);
    await expect(page.getByRole("button", { name: "Demande à Désigno" })).toBeVisible();
  }

  await page.goto("/flotte/vehicules");
  await page.getByRole("button", { name: "Demande à Désigno" }).click();
  const panneau = page.getByRole("complementary", { name: "Demande à Désigno" });
  await expect(panneau).toBeVisible();
  await expect(page).toHaveURL(/\/flotte\/vehicules$/);
  await expect(page.getByRole("button", { name: "Demande à Désigno" })).toHaveAttribute("aria-pressed", "true");
  for (const exemple of EXEMPLES) await expect(panneau.getByRole("button", { name: exemple })).toBeVisible();

  // Un exemple part d'un clic ; refusé, il revient dans la saisie.
  let envoye: unknown = null;
  await page.route("**/api/agent", async (route) => {
    envoye = route.request().postDataJSON();
    await route.fulfill({ status: 503, json: { erreur: MESSAGES_AGENT.indisponible } });
  });
  await panneau.getByRole("button", { name: EXEMPLES[1] }).click();
  await expect.poll(() => envoye).toEqual({ texte: EXEMPLES[1] });
  await expect(panneau.getByRole("alert")).toHaveText(MESSAGES_AGENT.indisponible);
  await expect(panneau.getByLabel("Votre demande")).toHaveValue(EXEMPLES[1]);
  await page.unroute("**/api/agent");

  // Une conversation, avec une réponse qui cite un conducteur, un véhicule et une affectation.
  const conversation = verifier(
    await admin.from("conversation").insert({ entreprise_id, premiere_demande: QUESTION }).select("id").single(),
  ).id;
  const planning = `/flotte/planning?date=2026-03-12&vehicule=${vehicule}`;
  verifier(
    await admin.from("message").insert([
      { conversation_id: conversation, entreprise_id, role: "gestionnaire", contenu: QUESTION },
      {
        conversation_id: conversation,
        entreprise_id,
        role: "agent",
        contenu:
          `[Karim Benali](/flotte/conducteurs/${conducteur}) conduisait [AB-123-CD](/flotte/vehicules/${vehicule}) ` +
          `le 12/03/2026 à 08:00 ([voir le planning](${planning})).\n\n| Plaque | Conducteur |\n|---|---|\n| AB-123-CD | Karim Benali |\n\n` +
          "[lien piégé](https://exemple.fr) <b>gras brut</b>",
      },
    ]),
  );
  await panneau.getByRole("button", { name: "Fermer" }).click();
  await expect(panneau).toBeHidden();
  await page.getByRole("button", { name: "Demande à Désigno" }).click();
  await expect(panneau.getByText(QUESTION)).toBeVisible();
  await expect(panneau.getByRole("cell", { name: "Karim Benali" })).toBeVisible();
  // Un lien hors de Désigno n'est que du texte, et le HTML brut n'est pas rendu.
  await expect(panneau.getByText("lien piégé")).toBeVisible();
  await expect(panneau.getByRole("link", { name: "lien piégé" })).toHaveCount(0);
  await expect(panneau.locator("b")).toHaveCount(0);

  // Chaque lien ouvre la bonne fiche, et le panneau reste ouvert d'un écran à l'autre.
  await panneau.getByRole("link", { name: "Karim Benali" }).click();
  await expect(page).toHaveURL(new RegExp(`/flotte/conducteurs/${conducteur}$`));
  await expect(panneau).toBeVisible();
  await panneau.getByRole("link", { name: "voir le planning" }).click();
  await expect(page).toHaveURL(new RegExp(`/flotte/planning\\?date=2026-03-12&vehicule=${vehicule}$`));
  await panneau.getByRole("link", { name: "AB-123-CD" }).click();
  await expect(page).toHaveURL(new RegExp(`/flotte/vehicules/${vehicule}$`));

  // « Nouvelle conversation » repart à zéro, avec les exemples.
  await panneau.getByRole("button", { name: "Nouvelle conversation" }).click();
  await expect(panneau.getByRole("button", { name: EXEMPLES[0] })).toBeVisible();
  await expect(panneau.getByText(QUESTION)).toHaveCount(0);
  const terminee = verifier(await admin.from("conversation").select("terminee_le").eq("id", conversation).single());
  expect(terminee.terminee_le).not.toBeNull();
});

test("en Free, le bouton porte un cadenas, le panneau explique la fonction, et le serveur ne traite aucune demande", async ({
  page,
}) => {
  await connecterNouveauCompte(page, "agent-free");
  await page.getByRole("button", { name: /Demande à Désigno/ }).click();
  const panneau = page.getByRole("complementary", { name: "Demande à Désigno" });
  const cadenas = panneau.getByRole("group", { name: PRO.nom });
  await expect(cadenas).toBeVisible();
  await expect(cadenas).toContainText(PRO.explication);
  await expect(cadenas.getByRole("link", { name: "Passer en Pro" })).toBeVisible();
  await expect(panneau.getByLabel("Votre demande")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Demande à Désigno\s*, fonction Pro$/ })).toBeVisible();

  const reponse = await page.request.post("/api/agent", { data: { texte: "Qui avait AB-123-CD le 12/03 à 8 h ?" } });
  expect(reponse.status()).toBe(403);
  expect(await reponse.json()).toEqual({ erreur: MESSAGES_AGENT.pro });
});

test("sur téléphone, Demande à Désigno n'existe pas", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const email = await connecterNouveauCompte(page, "agent-mobile");
  await passerEnPro(email);
  await page.reload();
  await expect(page.getByRole("link", { name: "Déposer", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Demande à Désigno/ })).toBeHidden();
});
