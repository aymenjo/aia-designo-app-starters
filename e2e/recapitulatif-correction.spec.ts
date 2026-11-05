import { expect, test, type Page } from "@playwright/test";
import { COLONNES_MESSAGE } from "@/lib/agent/conversations";
import { MESSAGES_AGENT } from "@/lib/agent/regles";
import { MESSAGES } from "@/lib/flotte/regles";
import {
  MESSAGES_RECAPITULATIF,
  preparerRecapitulatif,
  type ConducteurInstantane,
  type EntreeModification,
  type Instantane,
} from "@/lib/flotte/regles-recapitulatif";
import { createAdminClient } from "@/lib/supabase/admin";
import { comptesEtEntreprises, connecterNouveauCompte, passerEnPro } from "./outils";

// Le récapitulatif de la phase 30 dans le panneau : une ligne que les règles des écrans refusent est rouge, avec leur
// motif, et « Confirmer » reste désactivé ; « Modifier » met la saisie en correction, et la demande qui part le
// remplace. Aucun appel à l'API Claude : la conversation est semée hors RLS, et /api/agent est intercepté pour jouer le
// serveur (il enregistre la demande marquée, remplace l'ancien récapitulatif et présente le nouveau).

const admin = createAdminClient();
const DEMANDE = "Karim part vendredi, et ajoute le camion AB-123-CD";
const CORRECTION = "Retire la ligne du véhicule, il est déjà là";
const DEBUT_KARIM = "2025-09-01T06:00:00+00:00";

function verifier<T>({ data, error }: { data: T; error: unknown }): NonNullable<T> {
  if (error) throw error;
  return data as NonNullable<T>;
}

const fiche = (id: string, prenom: string, nom: string): ConducteurInstantane => ({
  id,
  prenom,
  nom,
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
});

/**
 * Un compte Pro avec le camion attitré de Karim, puis la réponse de l'agent et son récapitulatif en attente : la
 * clôture de l'affectation de Karim, et l'ajout de AB-123-CD, déjà dans la flotte, en rouge.
 */
async function semer(page: Page) {
  const email = await connecterNouveauCompte(page, "recap-correction");
  await passerEnPro(email);
  const { entreprises } = await comptesEtEntreprises(email);
  const entreprise_id = entreprises[0].id as string;

  const camion = verifier(
    await admin.from("vehicule").insert({ entreprise_id, plaque: "AB-123-CD", modele: "Renault Master", type: "attitre" }).select("id").single(),
  ).id;
  const karim = verifier(await admin.from("conducteur").insert({ entreprise_id, prenom: "Karim", nom: "Benali" }).select("id").single()).id;
  const affectation = verifier(
    await admin.from("affectation").insert({ entreprise_id, vehicule_id: camion, conducteur_id: karim, debut: DEBUT_KARIM }).select("id").single(),
  ).id;
  const instantane: Instantane = {
    vehicules: [{ id: camion, plaque: "AB-123-CD", modele: "Renault Master", type: "attitre", archive_le: null, lecture_seule_le: null }],
    conducteurs: [fiche(karim, "Karim", "Benali")],
    affectations: [{ id: affectation, vehicule_id: camion, conducteur_id: karim, debut: DEBUT_KARIM, fin: null }],
  };
  const preparer = (entrees: EntreeModification[]) => {
    const preparation = preparerRecapitulatif(instantane, entrees);
    if (!preparation.ok) throw new Error(JSON.stringify(preparation.motifs));
    return preparation.lignes;
  };
  const cloture: EntreeModification = { operation: "cloturer_affectation", affectation_id: affectation, fin_date: "2026-11-06" };

  const conversation = verifier(await admin.from("conversation").insert({ entreprise_id, premiere_demande: DEMANDE }).select("id").single()).id;
  verifier(await admin.from("message").insert({ conversation_id: conversation, entreprise_id, role: "gestionnaire", contenu: DEMANDE }));
  const reponse = verifier(
    await admin
      .from("message")
      .insert({ conversation_id: conversation, entreprise_id, role: "agent", contenu: "AB-123-CD est déjà dans votre flotte : que voulez-vous faire ?" })
      .select("id")
      .single(),
  ).id;
  const recapitulatif = verifier(
    await admin
      .from("recapitulatif")
      .insert({
        entreprise_id,
        conversation_id: conversation,
        message_id: reponse,
        lignes: preparer([cloture, { operation: "creer_vehicule", plaque: "AB-123-CD", type: "attitre" }]),
      })
      .select("id")
      .single(),
  ).id;
  return { entreprise_id, conversation, recapitulatif, karim, corrigees: preparer([cloture]) };
}

test("une ligne rouge garde « Confirmer » désactivé ; « Modifier » fait refaire le récapitulatif, qui remplace l'ancien", async ({
  page,
}) => {
  const semis = await semer(page);
  await page.goto("/flotte/vehicules");
  await page.getByRole("button", { name: "Demande à Désigno" }).click();
  const panneau = page.getByRole("complementary", { name: "Demande à Désigno" });
  const cartes = panneau.getByRole("region", { name: "Récapitulatif des modifications" });
  await expect(cartes).toHaveCount(1);
  const ancienne = cartes.first();

  // La ligne rouge : le motif des écrans à la place des détails, sur fond teinté, sans lien.
  const lignes = ancienne.getByRole("listitem");
  await expect(lignes).toHaveCount(2);
  await expect(lignes.nth(0)).toContainText("Clôturer l'affectation de Karim B. sur AB-123-CD");
  await expect(lignes.nth(0).getByRole("link", { name: "Karim B." })).toHaveAttribute("href", `/flotte/conducteurs/${semis.karim}`);
  await expect(lignes.nth(1)).toContainText("Ajouter le véhicule AB-123-CD");
  await expect(lignes.nth(1)).toContainText(MESSAGES.plaqueDejaPresente("AB-123-CD"));
  await expect(lignes.nth(1)).toHaveClass(/bg-urgent-tint/);
  await expect(lignes.nth(1).getByRole("link")).toHaveCount(0);
  await expect(ancienne.getByRole("button", { name: "Confirmer" })).toBeDisabled();

  // « Modifier » : le focus dans la saisie, la pilule et le texte d'aide ; Échap puis × retirent la marque.
  const saisie = panneau.getByLabel("Votre demande");
  // Avant tout envoi, le seul texte « Corrige le récapitulatif » est celui de la pilule ; son × la reconnaît ensuite.
  const pilule = panneau.getByText(MESSAGES_AGENT.corrige, { exact: true });
  const retirer = panneau.getByRole("button", { name: "Ne plus corriger le récapitulatif" });
  await ancienne.getByRole("button", { name: "Modifier" }).click();
  await expect(saisie).toBeFocused();
  await expect(pilule).toBeVisible();
  await expect(saisie).toHaveAttribute("placeholder", MESSAGES_AGENT.placeholderCorrection);
  await saisie.press("Escape");
  await expect(pilule).toHaveCount(0);
  await expect(saisie).toHaveAttribute("placeholder", "Posez une question ou décrivez un changement…");
  await ancienne.getByRole("button", { name: "Modifier" }).click();
  await retirer.click();
  await expect(pilule).toHaveCount(0);

  // La correction part marquée : la route joue le serveur, qui remplace l'ancien et présente le nouveau.
  let envoye: unknown = null;
  await page.route("**/api/agent", async (route) => {
    envoye = route.request().postDataJSON();
    const { entreprise_id, conversation } = semis;
    verifier(
      await admin.from("message").insert({ conversation_id: conversation, entreprise_id, role: "gestionnaire", contenu: CORRECTION, correction: true }),
    );
    verifier(await admin.from("recapitulatif").update({ statut: "remplace" }).eq("id", semis.recapitulatif));
    const message = verifier(
      await admin
        .from("message")
        .insert({ conversation_id: conversation, entreprise_id, role: "agent", contenu: "Voici le récapitulatif corrigé. Rien n'est appliqué avant « Confirmer »." })
        .select(COLONNES_MESSAGE)
        .single(),
    );
    const recapitulatif = verifier(
      await admin
        .from("recapitulatif")
        .insert({ entreprise_id, conversation_id: conversation, message_id: message.id, lignes: semis.corrigees })
        .select("id, statut, lignes, crees, applique_le")
        .single(),
    );
    const evenements = [
      { type: "attente", demandes: 2, remplace: semis.recapitulatif },
      { type: "message", message: { ...message, recapitulatif } },
    ];
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body: evenements.map((evenement) => JSON.stringify(evenement)).join("\n"),
    });
  });
  await ancienne.getByRole("button", { name: "Modifier" }).click();
  await saisie.fill(CORRECTION);
  await panneau.getByRole("button", { name: "Envoyer" }).click();

  await expect(cartes).toHaveCount(2);
  expect(envoye).toEqual({ texte: CORRECTION, corrige: semis.recapitulatif });
  await expect(retirer).toHaveCount(0);
  await expect(saisie).toHaveAttribute("placeholder", "Posez une question ou décrivez un changement…");
  await expect(cartes.first().getByText(MESSAGES_RECAPITULATIF.remplace)).toBeVisible();
  await expect(cartes.first().getByRole("button", { name: "Confirmer" })).toHaveCount(0);
  await expect(cartes.last().getByRole("listitem")).toHaveCount(1);
  await expect(cartes.last().getByRole("button", { name: "Confirmer" })).toBeEnabled();
  // Sous la bulle, le rappel de la correction : le seul texte « Corrige le récapitulatif » une fois la pilule partie.
  const rappel = panneau.getByText(MESSAGES_AGENT.corrige, { exact: true });
  await expect(rappel).toBeVisible();
  await page.unroute("**/api/agent");

  // Rechargé, le panneau relit la marque et le sort de l'ancien récapitulatif.
  await page.reload();
  await page.getByRole("button", { name: "Demande à Désigno" }).click();
  await expect(cartes).toHaveCount(2);
  await expect(panneau.getByText(CORRECTION)).toBeVisible();
  await expect(rappel).toBeVisible();
  await expect(cartes.first().getByText(MESSAGES_RECAPITULATIF.remplace)).toBeVisible();

  // Un récapitulatif à corriger mal formé est refusé avant de toucher à l'agent.
  const refus = await page.request.post("/api/agent", { data: { texte: CORRECTION, corrige: "1234" } });
  expect(refus.status()).toBe(400);
});
