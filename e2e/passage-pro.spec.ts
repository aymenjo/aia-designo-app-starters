import { expect, test, type APIRequestContext } from "@playwright/test";
import { LIMITES_FREE } from "@/lib/abonnement/plans";
import { CHAMPS_REQUIS, LIBELLES_CHAMP } from "@/lib/entreprise/regles";
import { createAdminClient } from "@/lib/supabase/admin";
import { abonnement, evenement, facture, idStripe, secondes, signer } from "../tests/stripe";
import { comptesEtEntreprises, connecterNouveauCompte, emailsRecus } from "./outils";

// Passage en Pro (phase 18). Les pages de Stripe ne sont jamais ouvertes : le retour de Checkout est simulé par son
// adresse, et le webhook reçoit des événements signés avec le secret local, comme Stripe les enverrait. Le vrai
// parcours en mode test se fait en recette manuelle, avec la Stripe CLI (docs/DEPLOIEMENT.md).

const admin = createAdminClient();
const WEBHOOK = "/api/webhooks/stripe";

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

/** L'entreprise du compte, sa fiche complète et son client Stripe, comme « Passer en Pro » l'aurait enregistré. */
async function preparerEntreprise(email: string) {
  const { entreprises } = await comptesEtEntreprises(email);
  const entreprise_id = entreprises[0].id as string;
  const client = idStripe("cus");
  const { error } = await admin
    .from("entreprise")
    .update({ ...FICHE_ENTREPRISE, stripe_client_id: client })
    .eq("id", entreprise_id);
  if (error) throw error;
  return { entreprise_id, client };
}

/** Poste l'événement comme Stripe : le corps brut, signé. */
async function poster(request: APIRequestContext, evenementStripe: unknown) {
  const { corps, signature } = signer(evenementStripe);
  return request.post(WEBHOOK, {
    data: corps,
    headers: { "content-type": "application/json", "stripe-signature": signature },
  });
}

test("une fiche incomplète désactive « Passer en Pro », et se complète sur place", async ({ page }) => {
  await connecterNouveauCompte(page, "passage-pro-fiche");
  await page.goto("/parametres/abonnement");

  await expect(page.getByRole("button", { name: "Passer en Pro" })).toBeDisabled();
  const manquants = page.getByRole("main").getByRole("status").filter({ hasText: "Pour passer en Pro, complétez" });
  await expect(manquants.getByRole("listitem")).toHaveText(CHAMPS_REQUIS.map((champ) => LIBELLES_CHAMP[champ]));
  expect(CHAMPS_REQUIS).toHaveLength(9);

  const fiche = page.getByRole("region", { name: "Fiche entreprise" });
  await fiche.getByLabel("Raison sociale").fill(FICHE_ENTREPRISE.raison_sociale);
  await fiche.getByLabel("SIREN").fill("404 833 048");
  await fiche.getByLabel("SIREN").blur();
  // La TVA est proposée d'après le SIREN.
  await expect(fiche.getByLabel("N° de TVA intracommunautaire")).toHaveValue(FICHE_ENTREPRISE.tva);
  await fiche.getByLabel("Prénom").fill(FICHE_ENTREPRISE.representant_prenom);
  await fiche.getByLabel("Nom", { exact: true }).fill(FICHE_ENTREPRISE.representant_nom);
  await fiche.getByLabel("Fonction").fill(FICHE_ENTREPRISE.representant_fonction);
  await fiche.getByLabel("Adresse", { exact: true }).fill(FICHE_ENTREPRISE.siege_adresse);
  await fiche.getByLabel("Code postal").fill(FICHE_ENTREPRISE.siege_code_postal);
  await fiche.getByLabel("Ville").fill(FICHE_ENTREPRISE.siege_ville);
  await fiche.getByRole("button", { name: "Enregistrer" }).click();

  // Le bouton s'active, sans être cliqué : il ouvrirait la page de Stripe.
  await expect(page.getByRole("button", { name: "Passer en Pro" })).toBeEnabled();
  await expect(page.getByText(`la facture au nom de ${FICHE_ENTREPRISE.raison_sociale} arrive par email`)).toBeVisible();
  await expect(fiche).toHaveCount(0);
});

test("au retour du paiement, le webhook passe le compte en Pro et débloque les avis verrouillés", async ({
  page,
  request,
}) => {
  const email = await connecterNouveauCompte(page, "passage-pro");
  const { entreprise_id, client } = await preparerEntreprise(email);
  const { data: semes, error } = await admin
    .from("avis")
    .insert(
      Array.from({ length: LIMITES_FREE.avisParMois + 1 }, (_, n) => ({
        entreprise_id,
        fichier: `${entreprise_id}/${crypto.randomUUID()}.png`,
        fichier_type: "image/png",
        plaque: n === LIMITES_FREE.avisParMois ? "PP-618-AA" : null,
      })),
    )
    .select("id, verrouille, plaque");
  if (error) throw error;
  const verrouille = semes.find(({ plaque }) => plaque === "PP-618-AA")!;
  expect(verrouille.verrouille).toBe(true);

  // Le retour de Checkout, avant que Stripe ait appelé le webhook.
  await page.goto("/parametres/abonnement?paiement=reussi");
  await expect(page.getByText("Activation du Pro…")).toBeVisible();
  await expect(page.getByRole("button", { name: "Passer en Pro" })).toHaveCount(0);

  // Un appel qui n'est pas signé par Stripe est refusé.
  const sub = idStripe("sub");
  const finPeriode = secondes("2026-11-25T09:00:00Z");
  const actif = evenement(
    "customer.subscription.created",
    abonnement({ id: sub, client, entrepriseId: entreprise_id, finPeriode }),
  );
  const falsifie = await request.post(WEBHOOK, {
    data: JSON.stringify(actif),
    headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=falsifiee" },
  });
  expect(falsifie.status()).toBe(400);

  const reponse = await poster(request, actif);
  expect(reponse.status()).toBe(200);

  // Sans recharger : l'écran se relit tout seul.
  await expect(page.getByText("Bienvenue en Pro")).toBeVisible({ timeout: 10_000 });
  const blocAbonnement = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { level: 2, name: "Votre abonnement" }) });
  await expect(blocAbonnement).toContainText("Prochain prélèvement");
  await expect(blocAbonnement).toContainText("25/11/2026 · 58,80 € TTC");
  await expect(blocAbonnement.getByRole("button", { name: "Gérer mon abonnement" })).toBeEnabled();
  await expect(page.getByRole("banner").getByRole("link", { name: "Plan Pro" })).toBeVisible();

  await page.goto(`/avis/${verrouille.id}`);
  await expect(page.getByRole("main").getByText("Verrouillé", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Plaque")).toHaveValue("PP-618-AA");

  // Annulé depuis le portail : le Pro reste jusqu'à la fin de la période payée.
  const annule = abonnement({ id: sub, client, finPeriode, annulationFinPeriode: true });
  const plusTard = { cree: actif.created + 60 };
  const annulation = await poster(request, evenement("customer.subscription.updated", annule, plusTard));
  expect(annulation.status()).toBe(200);
  await page.goto("/parametres/abonnement");
  await expect(blocAbonnement).toContainText("Fin de l'abonnement");
  await expect(blocAbonnement).toContainText("25/11/2026");
  await expect(blocAbonnement).toContainText("Vous repasserez alors en Free, sans perdre aucune donnée.");
});

test("une facture payée, reçue deux fois, n'envoie qu'un email", async ({ page, request }) => {
  const email = await connecterNouveauCompte(page, "passage-pro-facture");
  const { client } = await preparerEntreprise(email);

  const paye = evenement(
    "invoice.paid",
    facture({ client, numero: "DESIGNO-E2E1", nomClient: FICHE_ENTREPRISE.raison_sociale }),
  );
  expect((await poster(request, paye)).status()).toBe(200);
  // Stripe relance le même événement : il est déjà envoyé.
  expect((await poster(request, paye)).status()).toBe(200);

  const factures = async () =>
    (await emailsRecus(email)).filter(({ sujet }) => sujet.startsWith("Votre facture Désigno Pro"));
  await expect.poll(async () => (await factures()).length).toBe(1);
  // Le temps d'un éventuel second envoi : il ne doit pas arriver.
  await page.waitForTimeout(1_000);
  const [recue] = await factures();
  expect(recue.sujet).toBe("Votre facture Désigno Pro · octobre 2026");
  expect(recue.html).toContain("DESIGNO-E2E1");
  expect(recue.html).toContain(FICHE_ENTREPRISE.raison_sociale);
  expect(await factures()).toHaveLength(1);
});
