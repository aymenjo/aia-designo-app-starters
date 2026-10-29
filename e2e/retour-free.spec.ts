import { expect, test, type APIRequestContext } from "@playwright/test";
import { SUJET_IMPAYE } from "@/lib/abonnement/email-impaye";
import { LIMITES_FREE } from "@/lib/abonnement/plans";
import { createAdminClient } from "@/lib/supabase/admin";
import { abonnement, evenement, idStripe, secondes, signer } from "../tests/stripe";
import { comptesEtEntreprises, connecterNouveauCompte, emailsRecus } from "./outils";

// Échec de paiement et retour en Free (phase 19). Comme pour le passage en Pro, le webhook reçoit des événements signés
// avec le secret local : les pages de Stripe ne sont jamais ouvertes, et la tâche des impayés a ses tests d'intégration.

const admin = createAdminClient();
const WEBHOOK = "/api/webhooks/stripe";
// Le 25/10/2026 à Paris : la date limite de l'impayé est le 01/11/2026.
const T = secondes("2026-10-25T09:00:00Z");

/** L'entreprise du compte et son client Stripe, comme « Passer en Pro » l'aurait enregistré. */
async function preparerEntreprise(email: string) {
  const { entreprises } = await comptesEtEntreprises(email);
  const entreprise_id = entreprises[0].id as string;
  const client = idStripe("cus");
  const { error } = await admin
    .from("entreprise")
    .update({ raison_sociale: "Plomberie Martin SARL", stripe_client_id: client })
    .eq("id", entreprise_id);
  if (error) throw error;
  return { entreprise_id, client };
}

/** Poste l'événement comme Stripe : le corps brut, signé. */
async function poster(request: APIRequestContext, evenementStripe: unknown) {
  const { corps, signature } = signer(evenementStripe);
  const reponse = await request.post(WEBHOOK, {
    data: corps,
    headers: { "content-type": "application/json", "stripe-signature": signature },
  });
  expect(reponse.status()).toBe(200);
}

test("un paiement en échec affiche le bandeau, et envoie un seul email avec la date limite", async ({ page, request }) => {
  const email = await connecterNouveauCompte(page, "retour-free-impaye");
  const { client } = await preparerEntreprise(email);
  const sub = idStripe("sub");
  await poster(request, evenement("customer.subscription.created", abonnement({ id: sub, client }), { cree: T - 60 }));

  const echec = evenement(
    "customer.subscription.updated",
    abonnement({ id: sub, client, statut: "past_due", derniereFacture: idStripe("in") }),
    { cree: T },
  );
  await poster(request, echec);
  // Stripe relance le même événement : l'impayé est déjà signalé.
  await poster(request, echec);

  await page.goto("/tableau-de-bord");
  const bandeau = page.getByRole("alert").filter({ hasText: "Le paiement de votre abonnement Pro a échoué." });
  await expect(bandeau).toContainText("Mettez à jour votre carte d'ici le 01/11/2026");
  await expect(bandeau.getByRole("button", { name: "Mettre à jour ma carte" })).toBeVisible();
  // Il reste sur chaque écran, sans bouton pour le fermer.
  await page.goto("/avis");
  await expect(bandeau).toBeVisible();

  await page.goto("/parametres/abonnement");
  const bloc = page.locator("section").filter({ has: page.getByRole("heading", { level: 2, name: "Votre abonnement" }) });
  await expect(bloc).toContainText("Paiement en échec");
  await expect(bloc).toContainText("à régulariser d'ici le 01/11/2026");
  await expect(bloc.getByRole("button", { name: "Mettre à jour ma carte" })).toBeVisible();

  const impayes = async () => (await emailsRecus(email)).filter(({ sujet }) => sujet === SUJET_IMPAYE);
  await expect.poll(async () => (await impayes()).length).toBe(1);
  const [recu] = await impayes();
  expect(recu.html).toContain("01/11/2026");
  // Le temps d'un éventuel second envoi : il ne doit pas arriver.
  await page.waitForTimeout(1_000);
  expect(await impayes()).toHaveLength(1);

  // Régularisé depuis le portail : le bandeau disparaît.
  await poster(request, evenement("customer.subscription.updated", abonnement({ id: sub, client }), { cree: T + 3_600 }));
  await page.goto("/tableau-de-bord");
  await expect(page.getByText("Le paiement de votre abonnement Pro a échoué.")).toHaveCount(0);
});

test("au retour en Free, chaque écran mène au choix des véhicules actifs ; les autres passent en lecture seule", async ({
  page,
  request,
}) => {
  const email = await connecterNouveauCompte(page, "retour-free-choix");
  const { entreprise_id, client } = await preparerEntreprise(email);
  const sub = idStripe("sub");
  await poster(request, evenement("customer.subscription.created", abonnement({ id: sub, client }), { cree: T }));

  // En Pro, 5 véhicules : un de plus que la limite Free, et un archivé.
  const plaques = Array.from({ length: LIMITES_FREE.vehicules + 2 }, (_, n) => `RL-${101 + n}-AA`);
  const { data: vehicules, error } = await admin
    .from("vehicule")
    .insert(plaques.map((plaque) => ({ entreprise_id, plaque, type: "attitre" })))
    .select("id, plaque");
  if (error) throw error;
  const id = (plaque: string) => vehicules.find((vehicule) => vehicule.plaque === plaque)!.id as string;
  const archive = plaques.at(-1)!;
  await admin.from("vehicule").update({ archive_le: new Date().toISOString() }).eq("id", id(archive));

  // Annulé depuis le portail, à la fin de la période : le compte repasse en Free.
  const fini = abonnement({ id: sub, client, statut: "canceled", annulationFinPeriode: true });
  await poster(request, evenement("customer.subscription.deleted", fini, { cree: T + 60 }));

  await page.goto("/avis");
  await expect(page).toHaveURL(/\/flotte\/vehicules-actifs$/);
  await expect(page.getByRole("heading", { name: `Choisissez vos ${LIMITES_FREE.vehicules} véhicules actifs` })).toBeVisible();
  // Sans barre latérale.
  await expect(page.getByRole("navigation", { name: "Navigation principale" })).toHaveCount(0);
  // L'écran Abonnement reste ouvert : on y repasse en Pro.
  await page.goto("/parametres/abonnement");
  await expect(page).toHaveURL(/\/parametres\/abonnement$/);
  // L'écran Compte aussi, depuis le menu de l'étape : la suppression du compte n'attend pas ce choix.
  await page.goto("/flotte/vehicules-actifs");
  await page.getByRole("button", { name: "Mon compte" }).click();
  await page.getByRole("link", { name: "Mon compte" }).click();
  await expect(page).toHaveURL(/\/parametres\/compte$/);
  await expect(page.getByRole("heading", { name: "Supprimer le compte" })).toBeVisible();

  await page.goto("/flotte/vehicules-actifs");
  const garder = page.getByRole("button", { name: `Garder ces ${LIMITES_FREE.vehicules} véhicules` });
  await expect(garder).toBeDisabled();
  // L'archivé n'est pas proposé.
  await expect(page.getByRole("checkbox")).toHaveCount(LIMITES_FREE.vehicules + 1);
  const [gardees, enTrop] = [plaques.slice(0, LIMITES_FREE.vehicules), plaques[LIMITES_FREE.vehicules]];
  for (const plaque of gardees) await page.getByRole("checkbox", { name: plaque }).check();
  await expect(page.getByText(`${LIMITES_FREE.vehicules}/${LIMITES_FREE.vehicules} choisis`)).toBeVisible();
  await expect(page.getByRole("checkbox", { name: enTrop })).toBeDisabled();
  await garder.click();
  await expect(page).toHaveURL(/\/tableau-de-bord$/);

  // Le véhicule non choisi reste visible, en lecture seule.
  await page.goto("/flotte/vehicules");
  const ligne = (plaque: string) => page.getByRole("listitem").filter({ hasText: plaque });
  await expect(ligne(enTrop)).toContainText("Lecture seule");
  await expect(ligne(gardees[0])).not.toContainText("Lecture seule");
  await ligne(enTrop).getByRole("link").click();
  await expect(page.getByRole("main").getByText("Lecture seule", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Nouvelle affectation" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Archiver ce véhicule" })).toBeVisible();
  // Les 3 places actives sont prises : il ne se rend pas actif.
  await expect(page.getByRole("button", { name: "Rendre actif" })).toHaveCount(0);

  // Un avis déposé depuis, sur ce véhicule : il est bloqué.
  const { data: avis, error: erreurAvis } = await admin
    .from("avis")
    .insert({
      entreprise_id,
      fichier: `${entreprise_id}/${crypto.randomUUID()}.png`,
      fichier_type: "image/png",
      numero: "8900000001",
      plaque: enTrop,
      vehicule_id: id(enTrop),
      infraction_le: "2026-10-03T06:30:00Z",
      lieu: "A6, Auxerre",
      infraction: "Excès de vitesse inférieur à 20 km/h",
      montant_centimes: 13_500,
      date_envoi: "2026-10-06",
      statut: "a_valider",
    })
    .select("id")
    .single();
  if (erreurAvis) throw erreurAvis;
  await page.goto(`/avis/${avis.id}`);
  await expect(page.getByRole("main").getByText("Verrouillé", { exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: "Conducteur proposé et récap ANTAI" })).toContainText(
    `Le véhicule ${enTrop} est en lecture seule`,
  );
  await expect(page.getByRole("button", { name: "Valider ce conducteur" })).toHaveCount(0);

  // Repasser en Pro remet tout actif, et débloque l'avis.
  await poster(
    request,
    evenement("customer.subscription.created", abonnement({ id: idStripe("sub"), client }), { cree: T + 3_600 }),
  );
  await page.goto("/flotte/vehicules");
  await expect(page.getByText("Lecture seule", { exact: true })).toHaveCount(0);
  await page.goto(`/avis/${avis.id}`);
  await expect(page.getByRole("main").getByText("Verrouillé", { exact: true })).toHaveCount(0);
});
