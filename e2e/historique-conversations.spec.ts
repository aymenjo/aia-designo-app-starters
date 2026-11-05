import { expect, test, type Page } from "@playwright/test";
import { EXEMPLES, MESSAGES_AGENT } from "@/lib/agent/regles";
import { preparerRecapitulatif, type EntreeModification } from "@/lib/flotte/regles-recapitulatif";
import { createAdminClient } from "@/lib/supabase/admin";
import { comptesEtEntreprises, connecterNouveauCompte, passerEnPro } from "./outils";

// L'historique des conversations (phase 32) dans le panneau : la liste des 30 derniers jours, la conversation en cours
// en tête, puis une conversation terminée rouverte en lecture seule, avec son récapitulatif appliqué. Aucun appel à
// l'API Claude : les conversations sont semées hors RLS, comme l'agent les aurait laissées, et /api/agent est intercepté
// pour prouver qu'il n'est jamais appelé.

const admin = createAdminClient();
const DEMANDE_ARCHIVAGE = "Archive la fiche de Paul";
const DEMANDE_EN_COURS = "Qui avait AB-123-CD le 12/03 à 8 h ?";
const DEMANDE_EXPIREE = "Une demande de plus de 30 jours";

function verifier<T>({ data, error }: { data: T; error: unknown }): NonNullable<T> {
  if (error) throw error;
  return data as NonNullable<T>;
}

const il = (jours: number) => new Date(Date.now() - jours * 86_400_000).toISOString();

/** Une conversation et ses messages, semés hors RLS ; renvoie l'id de la conversation et celui de la dernière réponse. */
async function semerConversation(
  entreprise_id: string,
  conversation: Record<string, unknown>,
  messages: { role: "gestionnaire" | "agent"; contenu: string }[],
) {
  const id = verifier(await admin.from("conversation").insert({ entreprise_id, ...conversation }).select("id").single()).id;
  let derniere = "";
  for (const message of messages) {
    derniere = verifier(
      await admin.from("message").insert({ conversation_id: id, entreprise_id, ...message }).select("id").single(),
    ).id;
  }
  return { id, derniere };
}

/** Un compte Pro, le camion AB-123-CD, Paul sans affectation, et la proposition d'archiver sa fiche, en attente. */
async function semer(page: Page) {
  const email = await connecterNouveauCompte(page, "historique");
  await passerEnPro(email);
  const { entreprises } = await comptesEtEntreprises(email);
  const entreprise_id = entreprises[0].id as string;

  const camion = verifier(
    await admin.from("vehicule").insert({ entreprise_id, plaque: "AB-123-CD", modele: "Renault Master", type: "attitre" }).select("id").single(),
  ).id;
  const paul = verifier(await admin.from("conducteur").insert({ entreprise_id, prenom: "Paul", nom: "Martin" }).select("id").single()).id;
  const entrees: EntreeModification[] = [{ operation: "archiver_conducteur", conducteur_id: paul }];
  const preparation = preparerRecapitulatif(
    {
      vehicules: [],
      conducteurs: [
        {
          id: paul,
          prenom: "Paul",
          nom: "Martin",
          civilite: null,
          date_naissance: null,
          lieu_naissance: null,
          adresse: null,
          adresse_complement: null,
          code_postal: null,
          ville: null,
          permis_numero: null,
          permis_delivre_le: null,
          permis_categories: null,
          email: null,
          archive_le: null,
        },
      ],
      affectations: [],
    },
    entrees,
  );
  if (!preparation.ok) throw new Error(JSON.stringify(preparation.motifs));

  const { id: conversation, derniere: reponse } = await semerConversation(
    entreprise_id,
    { premiere_demande: DEMANDE_ARCHIVAGE },
    [
      { role: "gestionnaire", contenu: DEMANDE_ARCHIVAGE },
      { role: "agent", contenu: "Voici la modification prévue. Rien n'est appliqué avant « Confirmer »." },
    ],
  );
  verifier(
    await admin
      .from("recapitulatif")
      .insert({ entreprise_id, conversation_id: conversation, message_id: reponse, lignes: preparation.lignes }),
  );

  // Le moindre appel à l'agent serait un appel payant : il est refusé, et compté.
  const appels: string[] = [];
  await page.route("**/api/agent", async (route) => {
    appels.push(route.request().url());
    await route.fulfill({ status: 503, json: { erreur: "interdit dans ce test" } });
  });
  return { entreprise_id, camion, appels };
}

test("l'historique liste les conversations des 30 derniers jours, et en rouvre une en lecture seule", async ({ page }) => {
  const semis = await semer(page);
  await page.goto("/flotte/conducteurs");
  await page.getByRole("button", { name: "Demande à Désigno" }).click();
  const panneau = page.getByRole("complementary", { name: "Demande à Désigno" });

  // Le gestionnaire confirme l'archivage, puis démarre une nouvelle conversation.
  const carte = panneau.getByRole("region", { name: "Récapitulatif des modifications" });
  await carte.getByRole("button", { name: "Confirmer" }).click();
  await expect(carte.getByText(/^Appliqué le /)).toBeVisible();
  await panneau.getByRole("button", { name: "Nouvelle conversation" }).click();
  await expect(panneau.getByRole("button", { name: EXEMPLES[0] })).toBeVisible();

  // Une demande dans la nouvelle conversation, et une conversation de 31 jours que la purge n'a pas encore effacée.
  await semerConversation(semis.entreprise_id, { premiere_demande: DEMANDE_EN_COURS }, [
    { role: "gestionnaire", contenu: DEMANDE_EN_COURS },
    { role: "agent", contenu: "Aucune affectation sur AB-123-CD le 12/03/2026." },
  ]);
  await semerConversation(semis.entreprise_id, { premiere_demande: DEMANDE_EXPIREE, debut: il(31), terminee_le: il(30) }, [
    { role: "gestionnaire", contenu: DEMANDE_EXPIREE },
  ]);

  // Sur la fiche du camion, le fil montre la conversation en cours et la pilule « Sur : AB-123-CD ».
  await page.goto(`/flotte/vehicules/${semis.camion}`);
  await page.getByRole("button", { name: "Demande à Désigno" }).click();
  await expect(panneau.getByText(DEMANDE_EN_COURS)).toBeVisible();
  await expect(panneau.getByText("Sur : AB-123-CD")).toBeVisible();

  // La liste : la conversation en cours en tête, puis la conversation terminée et son récapitulatif appliqué.
  await panneau.getByRole("button", { name: MESSAGES_AGENT.historique }).click();
  const liste = panneau.getByRole("list", { name: MESSAGES_AGENT.historique });
  const lignes = liste.getByRole("listitem");
  await expect(lignes).toHaveCount(2);
  await expect(lignes.nth(0)).toContainText("En cours");
  await expect(lignes.nth(0)).toContainText(DEMANDE_EN_COURS);
  await expect(lignes.nth(1)).toContainText(DEMANDE_ARCHIVAGE);
  await expect(lignes.nth(1)).toContainText(MESSAGES_AGENT.appliques(1));
  await expect(lignes.nth(1)).not.toContainText("En cours");
  await expect(lignes.nth(1)).toContainText(/\d{2}\/\d{2}\/\d{4} à \d{2}:\d{2}/);
  await expect(panneau.getByText(DEMANDE_EXPIREE)).toHaveCount(0);
  await expect(panneau.getByText("Sur : AB-123-CD")).toHaveCount(0);

  // La conversation terminée : ses messages et « Appliqué le … », sans saisie ni bouton du récapitulatif.
  await lignes.nth(1).getByRole("button").click();
  await expect(panneau.getByText(DEMANDE_ARCHIVAGE)).toBeVisible();
  const recap = panneau.getByRole("region", { name: "Récapitulatif des modifications" });
  await expect(recap).toContainText("Archiver la fiche de Paul M.");
  await expect(recap.getByText(/^Appliqué le \d{2}\/\d{2}\/\d{4} à \d{2}:\d{2}$/)).toBeVisible();
  await expect(recap.getByRole("button")).toHaveCount(0);
  await expect(panneau.getByRole("textbox", { name: "Votre demande" })).toHaveCount(0);
  await expect(panneau.getByText(MESSAGES_AGENT.lectureSeule)).toBeVisible();
  await expect(panneau.getByText("Sur : AB-123-CD")).toHaveCount(0);

  // « ← Conversations » revient à la liste ; « Revenir à la conversation en cours » ramène au fil et à sa saisie.
  await panneau.getByRole("button", { name: "Conversations", exact: true }).click();
  await expect(liste).toBeVisible();
  await lignes.nth(1).getByRole("button").click();
  await panneau.getByRole("button", { name: "Revenir à la conversation en cours" }).click();
  await expect(panneau.getByRole("textbox", { name: "Votre demande" })).toBeFocused();
  await expect(panneau.getByText(DEMANDE_EN_COURS)).toBeVisible();
  await expect(panneau.getByText("Sur : AB-123-CD")).toBeVisible();
  await expect(panneau.getByRole("button", { name: MESSAGES_AGENT.historique })).toHaveAttribute("aria-pressed", "false");
  expect(semis.appels).toEqual([]);
});
