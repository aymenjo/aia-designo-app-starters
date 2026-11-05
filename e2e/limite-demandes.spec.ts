import { expect, test, type Page } from "@playwright/test";
import { DEMANDES_AGENT_PAR_MOIS } from "@/lib/abonnement/plans";
import { EXEMPLES, MESSAGES_AGENT, moisDemandes, remiseAZeroDemandes } from "@/lib/agent/regles";
import { createAdminClient } from "@/lib/supabase/admin";
import { comptesEtEntreprises, connecterNouveauCompte, passerEnPro } from "./outils";

// La limite de 100 demandes par mois de Demande à Désigno (phase 27) : le compteur sous la saisie, puis la saisie
// désactivée à la limite. Aucun appel à l'API Claude : le compteur est semé hors RLS, l'envoi est intercepté, et le
// refus de la limite a lieu avant que la route ne touche à l'agent.

const admin = createAdminClient();
const QUESTION = "Qui avait AB-123-CD le 12/03 à 8 h ?";

function verifier<T>({ data, error }: { data: T; error: unknown }): NonNullable<T> {
  if (error) throw error;
  return data as NonNullable<T>;
}

/** Un compte Pro neuf, avec `demandes` déjà faites ce mois-ci, et son panneau ouvert. */
async function ouvrirAvecDemandes(page: Page, prefixe: string, demandes: number) {
  const email = await connecterNouveauCompte(page, prefixe);
  await passerEnPro(email);
  const { entreprises } = await comptesEtEntreprises(email);
  const entreprise_id = entreprises[0].id as string;
  verifier(await admin.from("usage_agent").insert({ entreprise_id, mois: moisDemandes(new Date()), demandes }));
  await page.reload();
  await page.getByRole("button", { name: "Demande à Désigno" }).click();
  return { entreprise_id, panneau: page.getByRole("complementary", { name: "Demande à Désigno" }) };
}

test("en Pro, le compteur du mois s'affiche sous la saisie, et avance dès qu'une demande est acceptée", async ({ page }) => {
  const { entreprise_id, panneau } = await ouvrirAvecDemandes(page, "limite-compteur", 12);
  await expect(panneau.getByText(`12/${DEMANDES_AGENT_PAR_MOIS} demandes ce mois-ci`)).toBeVisible();
  await expect(panneau.getByText("Maj+Entrée : à la ligne")).toBeVisible();

  // La route est interceptée : elle compte la demande et enregistre la réponse, comme le serveur.
  const reponse = "Aucune affectation sur AB-123-CD le 12/03/2026.";
  await page.route("**/api/agent", async (route) => {
    verifier(await admin.from("usage_agent").update({ demandes: 13 }).eq("entreprise_id", entreprise_id));
    const conversation = verifier(
      await admin.from("conversation").insert({ entreprise_id, premiere_demande: QUESTION }).select("id").single(),
    ).id;
    const [, message] = verifier(
      await admin
        .from("message")
        .insert([
          { conversation_id: conversation, entreprise_id, role: "gestionnaire", contenu: QUESTION },
          { conversation_id: conversation, entreprise_id, role: "agent", contenu: reponse },
        ])
        .select("id, role, contenu, erreur, elements_cites, cree_le"),
    );
    const lignes = [{ type: "attente", demandes: 13 }, { type: "message", message }];
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body: lignes.map((ligne) => JSON.stringify(ligne)).join("\n"),
    });
  });
  await panneau.getByRole("button", { name: EXEMPLES[0] }).click();
  await expect(panneau.getByText(reponse)).toBeVisible();
  await expect(panneau.getByText(`13/${DEMANDES_AGENT_PAR_MOIS} demandes ce mois-ci`)).toBeVisible();
});

test("à 100 demandes, la saisie et les exemples sont désactivés jusqu'au 1er du mois, et le serveur refuse la demande", async ({
  page,
}) => {
  const { entreprise_id, panneau } = await ouvrirAvecDemandes(page, "limite-atteinte", DEMANDES_AGENT_PAR_MOIS);
  const limite = MESSAGES_AGENT.limite(remiseAZeroDemandes(new Date()));
  expect(limite).toMatch(/^Limite atteinte, retour le 01\/\d{2}\.$/);

  const alerte = panneau.getByRole("status").filter({ hasText: limite });
  await expect(alerte).toBeVisible();
  await expect(alerte).toContainText(MESSAGES_AGENT.limiteEcrans);
  await expect(panneau.getByText(`${DEMANDES_AGENT_PAR_MOIS}/${DEMANDES_AGENT_PAR_MOIS} demandes ce mois-ci`)).toBeVisible();
  await expect(panneau.getByText("Maj+Entrée : à la ligne")).toHaveCount(0);
  await expect(panneau.getByLabel("Votre demande")).toBeDisabled();
  await expect(panneau.getByRole("button", { name: "Envoyer" })).toBeDisabled();
  for (const exemple of EXEMPLES) await expect(panneau.getByRole("button", { name: exemple })).toBeDisabled();

  // Un appel direct est refusé avant de toucher à l'agent : rien n'est enregistré.
  const refus = await page.request.post("/api/agent", { data: { texte: QUESTION } });
  expect(refus.status()).toBe(429);
  expect(await refus.json()).toEqual({ erreur: limite });
  expect(verifier(await admin.from("conversation").select("id").eq("entreprise_id", entreprise_id))).toEqual([]);
  expect(verifier(await admin.from("usage_agent").select("demandes").eq("entreprise_id", entreprise_id))).toEqual([
    { demandes: DEMANDES_AGENT_PAR_MOIS },
  ]);
});
