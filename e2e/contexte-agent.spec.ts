import { expect, test } from "@playwright/test";
import { MESSAGES_AGENT } from "@/lib/agent/regles";
import { createAdminClient } from "@/lib/supabase/admin";
import { comptesEtEntreprises, connecterNouveauCompte, passerEnPro } from "./outils";

// Demande à Désigno, phase 28 : la pilule « Sur : … » qui suit l'écran, la demande qui part avec son élément, l'étape
// en cours et « Arrêter ». Aucun appel à l'API Claude : l'envoi est intercepté, et la demande en cours est semée hors
// RLS, comme le serveur la laisserait après une coupure.

const admin = createAdminClient();
const ETAPE = "Je consulte le planning de AB-123-CD…";

function verifier<T>({ data, error }: { data: T; error: unknown }): NonNullable<T> {
  if (error) throw error;
  return data as NonNullable<T>;
}

async function compteProOuvert(page: Parameters<typeof connecterNouveauCompte>[0], prefixe: string) {
  const email = await connecterNouveauCompte(page, prefixe);
  await passerEnPro(email);
  const { entreprises } = await comptesEtEntreprises(email);
  return entreprises[0].id as string;
}

test("la pilule « Sur : … » suit l'écran, la demande part avec son élément, et la bulle le rappelle", async ({ page }) => {
  const entreprise_id = await compteProOuvert(page, "agent-contexte");
  const vehicule = verifier(
    await admin.from("vehicule").insert({ entreprise_id, plaque: "AB-123-CD", modele: "Renault Master", type: "attitre" }).select("id").single(),
  ).id;
  const numero = String(Date.now()).slice(-10);
  // Un avis déjà lu : son ouverture ne relance pas la lecture par l'IA.
  const avis = verifier(
    await admin
      .from("avis")
      .insert({
        entreprise_id,
        numero,
        plaque: "AB-123-CD",
        vehicule_id: vehicule,
        infraction_le: "2026-03-12T07:00:00Z",
        date_envoi: "2026-03-18",
        fichier: `${entreprise_id}/${crypto.randomUUID()}.png`,
        fichier_type: "image/png",
        statut: "a_traiter",
        lecture_ia: "lue",
      })
      .select("id")
      .single(),
  ).id;

  await page.goto(`/avis/${avis}`);
  await page.getByRole("button", { name: "Demande à Désigno" }).click();
  const panneau = page.getByRole("complementary", { name: "Demande à Désigno" });
  await expect(panneau.getByText(`Sur : avis n° ${numero}`)).toBeVisible();

  // Le panneau reste ouvert d'un écran à l'autre : sur une liste, la pilule disparaît ; sur un véhicule, elle le nomme.
  await page.getByRole("navigation", { name: "Navigation principale" }).getByRole("link", { name: "Véhicules" }).click();
  await expect(page).toHaveURL(/\/flotte\/vehicules$/);
  await expect(panneau.getByText(/^Sur :/)).toHaveCount(0);
  await page.getByRole("link", { name: /AB-123-CD/ }).click();
  await expect(page).toHaveURL(new RegExp(`/flotte/vehicules/${vehicule}$`));
  await expect(panneau.getByText("Sur : AB-123-CD")).toBeVisible();

  // La route est interceptée : elle enregistre la demande avec son contexte, puis la réponse, comme le serveur.
  const question = "Combien d'avis pour ce véhicule ?";
  const reponse = "Un avis pour AB-123-CD.";
  let envoye: unknown = null;
  await page.route("**/api/agent", async (route) => {
    envoye = route.request().postDataJSON();
    const conversation = verifier(
      await admin.from("conversation").insert({ entreprise_id, premiere_demande: question }).select("id").single(),
    ).id;
    const [, message] = verifier(
      await admin
        .from("message")
        .insert([
          {
            conversation_id: conversation,
            entreprise_id,
            role: "gestionnaire",
            contenu: question,
            contexte: { type: "vehicule", id: vehicule, libelle: "AB-123-CD" },
          },
          { conversation_id: conversation, entreprise_id, role: "agent", contenu: reponse },
        ])
        .select("id, role, contenu, erreur, arret, contexte, cree_le"),
    );
    const lignes = [{ type: "attente", demandes: 1 }, { type: "etape", texte: ETAPE }, { type: "message", message }];
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body: lignes.map((ligne) => JSON.stringify(ligne)).join("\n"),
    });
  });
  await panneau.getByLabel("Votre demande").fill(question);
  await panneau.getByRole("button", { name: "Envoyer" }).click();
  await expect(panneau.getByText(reponse)).toBeVisible();
  expect(envoye).toEqual({ texte: question, contexte: { type: "vehicule", id: vehicule } });
  // Sous la bulle, le rappel de l'écran d'où la demande est partie, relu avec la conversation.
  await expect(panneau.getByText(question)).toBeVisible();
  await expect(panneau.getByText("Sur : AB-123-CD")).toHaveCount(2);
  await page.unroute("**/api/agent");

  // Un contexte mal formé est refusé avant de toucher à l'agent.
  const refus = await page.request.post("/api/agent", { data: { texte: question, contexte: { type: "avis", id: "1234" } } });
  expect(refus.status()).toBe(400);
});

test("une demande en cours affiche son étape et « Arrêter » ; l'arrêt laisse « Demande arrêtée. » dans le fil", async ({
  page,
}) => {
  const entreprise_id = await compteProOuvert(page, "agent-arret");
  const question = "Qui avait AB-123-CD le 12/03 ?";
  const verrou = new Date().toISOString();
  // La demande tourne sur le serveur, sans connexion ouverte : le panneau la suit, et relit son étape.
  const conversation = verifier(
    await admin
      .from("conversation")
      .insert({ entreprise_id, premiere_demande: question, demande_en_cours_depuis: verrou, etape: ETAPE })
      .select("id")
      .single(),
  ).id;
  verifier(
    await admin.from("message").insert({ conversation_id: conversation, entreprise_id, role: "gestionnaire", contenu: question }),
  );

  await page.reload();
  await page.getByRole("button", { name: "Demande à Désigno" }).click();
  const panneau = page.getByRole("complementary", { name: "Demande à Désigno" });
  await expect(panneau.getByText(question)).toBeVisible();
  await expect(panneau.getByRole("status").filter({ hasText: ETAPE })).toBeVisible();
  // Sur le tableau de bord, aucun élément : pas de pilule.
  await expect(panneau.getByText(/^Sur :/)).toHaveCount(0);

  const arreter = panneau.getByRole("button", { name: "Arrêter" });
  await arreter.click();
  await expect(panneau.getByRole("status").filter({ hasText: MESSAGES_AGENT.arretEnCours })).toBeVisible();
  await expect(arreter).toBeDisabled();
  await expect
    .poll(async () => {
      const { arret_demande } = verifier(await admin.from("conversation").select("arret_demande").eq("id", conversation).single());
      return arret_demande && Date.parse(arret_demande);
    })
    .toBe(Date.parse(verrou));

  // Le serveur voit l'arrêt, enregistre la mention et libère la conversation.
  verifier(
    await admin
      .from("message")
      .insert({ conversation_id: conversation, entreprise_id, role: "agent", contenu: MESSAGES_AGENT.arretee, arret: true }),
  );
  verifier(await admin.from("conversation").update({ demande_en_cours_depuis: null, etape: null }).eq("id", conversation));

  await expect(panneau.getByText(MESSAGES_AGENT.arretee)).toBeVisible();
  await expect(panneau.getByRole("button", { name: "Arrêter" })).toHaveCount(0);
  await expect(panneau.getByRole("alert")).toHaveCount(0);
  await panneau.getByLabel("Votre demande").fill("Une autre question");
  await expect(panneau.getByRole("button", { name: "Envoyer" })).toBeEnabled();
});
