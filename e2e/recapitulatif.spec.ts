import { expect, test, type Page } from "@playwright/test";
import {
  MESSAGES_RECAPITULATIF,
  preparerRecapitulatif,
  type ConducteurInstantane,
  type EntreeModification,
} from "@/lib/flotte/regles-recapitulatif";
import { createAdminClient } from "@/lib/supabase/admin";
import { comptesEtEntreprises, connecterNouveauCompte, passerEnPro } from "./outils";

// Le récapitulatif de modifications (phase 29) dans le panneau : « Confirmer » applique tout, « Annuler » abandonne, et
// une donnée modifiée entre-temps fait tout refuser. Aucun appel à l'API Claude : la conversation et le récapitulatif
// sont semés hors RLS, comme l'agent les aurait laissés, et /api/agent est intercepté pour prouver qu'il n'est jamais
// appelé (« Confirmer » et « Annuler » ne sont pas des demandes).

const admin = createAdminClient();
const DEMANDE = "Karim part vendredi, passe son camion à Léa";
const DEBUT_KARIM = "2025-09-01T06:00:00+00:00";
/** La semaine du départ de Karim : du lundi 02/11 au dimanche 08/11/2026. */
const PLANNING = "/flotte/planning?date=2026-11-07";

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
 * Un compte Pro avec le camion attitré de Karim, puis la réponse de l'agent à « Karim part vendredi… » et son
 * récapitulatif en attente : la clôture, la nouvelle affectation de Léa, l'archivage de Karim.
 */
async function semer(page: Page, prefixe: string) {
  const email = await connecterNouveauCompte(page, prefixe);
  await passerEnPro(email);
  const { entreprises } = await comptesEtEntreprises(email);
  const entreprise_id = entreprises[0].id as string;

  const camion = verifier(
    await admin.from("vehicule").insert({ entreprise_id, plaque: "AB-123-CD", modele: "Renault Master", type: "attitre" }).select("id").single(),
  ).id;
  const [karim, lea] = await Promise.all(
    [
      { prenom: "Karim", nom: "Benali" },
      { prenom: "Léa", nom: "Moreau" },
    ].map(async (personne) => verifier(await admin.from("conducteur").insert({ entreprise_id, ...personne }).select("id").single()).id),
  );
  const affectation = verifier(
    await admin.from("affectation").insert({ entreprise_id, vehicule_id: camion, conducteur_id: karim, debut: DEBUT_KARIM }).select("id").single(),
  ).id;

  const entrees: EntreeModification[] = [
    { operation: "cloturer_affectation", affectation_id: affectation, fin_date: "2026-11-06" },
    { operation: "creer_affectation", vehicule: { id: camion }, conducteur: { id: lea }, debut_date: "2026-11-07" },
    { operation: "archiver_conducteur", conducteur_id: karim },
  ];
  const preparation = preparerRecapitulatif(
    {
      vehicules: [{ id: camion, plaque: "AB-123-CD", modele: "Renault Master", type: "attitre", archive_le: null, lecture_seule_le: null }],
      conducteurs: [fiche(karim, "Karim", "Benali"), fiche(lea, "Léa", "Moreau")],
      affectations: [{ id: affectation, vehicule_id: camion, conducteur_id: karim, debut: DEBUT_KARIM, fin: null }],
    },
    entrees,
  );
  if (!preparation.ok) throw new Error(JSON.stringify(preparation.motifs));

  const conversation = verifier(await admin.from("conversation").insert({ entreprise_id, premiere_demande: DEMANDE }).select("id").single()).id;
  verifier(await admin.from("message").insert({ conversation_id: conversation, entreprise_id, role: "gestionnaire", contenu: DEMANDE }));
  const reponse = verifier(
    await admin
      .from("message")
      .insert({
        conversation_id: conversation,
        entreprise_id,
        role: "agent",
        contenu: "Voici les 3 modifications prévues. Rien n'est appliqué avant « Confirmer ».",
      })
      .select("id")
      .single(),
  ).id;
  const recapitulatif = verifier(
    await admin
      .from("recapitulatif")
      .insert({ entreprise_id, conversation_id: conversation, message_id: reponse, lignes: preparation.lignes })
      .select("id")
      .single(),
  ).id;

  // Le moindre appel à l'agent serait un appel payant : il est refusé, et compté.
  const appels: string[] = [];
  await page.route("**/api/agent", async (route) => {
    appels.push(route.request().url());
    await route.fulfill({ status: 503, json: { erreur: "interdit dans ce test" } });
  });

  return { camion, karim, lea, affectation, recapitulatif, appels };
}

async function ouvrirPanneau(page: Page) {
  await page.getByRole("button", { name: "Demande à Désigno" }).click();
  const panneau = page.getByRole("complementary", { name: "Demande à Désigno" });
  const carte = panneau.getByRole("region", { name: "Récapitulatif des modifications" });
  await expect(carte).toBeVisible();
  return { panneau, carte };
}

test("« Confirmer » applique les 3 modifications d'un coup, et le planning les montre sans rechargement", async ({ page }) => {
  const semis = await semer(page, "recap-confirmer");
  await page.goto(PLANNING);
  await expect(page.getByRole("button", { name: /^Karim Benali sur AB-123-CD/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Léa Moreau sur AB-123-CD/ })).toHaveCount(0);

  const { panneau, carte } = await ouvrirPanneau(page);
  await expect(panneau.getByText(DEMANDE)).toBeVisible();
  const lignes = carte.getByRole("listitem");
  await expect(lignes).toHaveCount(3);
  await expect(lignes.nth(0)).toContainText("Clôturer l'affectation de Karim B. sur AB-123-CD");
  await expect(lignes.nth(0)).toContainText("Fin : sans fin → 07/11/2026 00:00");
  await expect(lignes.nth(1)).toContainText("Créer une affectation pour Léa M. sur AB-123-CD");
  await expect(lignes.nth(2)).toContainText("Archiver la fiche de Karim B.");
  await expect(lignes.nth(0).getByRole("link", { name: "Karim B." })).toHaveAttribute("href", `/flotte/conducteurs/${semis.karim}`);

  await carte.getByRole("button", { name: "Confirmer" }).click();
  await expect(carte.getByText(/^Appliqué le \d{2}\/\d{2}\/\d{4} à \d{2}:\d{2}$/)).toBeVisible();
  await expect(carte.getByRole("button", { name: "Confirmer" })).toHaveCount(0);

  // L'écran derrière le panneau reflète aussitôt les changements, sans rechargement.
  await expect(page.getByRole("button", { name: /^Léa Moreau sur AB-123-CD/ })).toBeVisible();
  await expect(panneau).toBeVisible();
  const karim = verifier(await admin.from("conducteur").select("archive_le").eq("id", semis.karim).single());
  expect(karim.archive_le).not.toBeNull();
  const cloture = verifier(await admin.from("affectation").select("fin").eq("id", semis.affectation).single());
  expect(Date.parse(cloture.fin!)).toBe(Date.parse("2026-11-06T23:00:00Z"));

  // Rouvert, le panneau garde le récapitulatif appliqué.
  await panneau.getByRole("button", { name: "Fermer" }).click();
  await ouvrirPanneau(page);
  await expect(page.getByText(/^Appliqué le /)).toBeVisible();
  expect(semis.appels).toEqual([]);
});

test("« Annuler » abandonne le récapitulatif sans rien modifier", async ({ page }) => {
  const semis = await semer(page, "recap-annuler");
  await page.goto("/flotte/vehicules");
  const { carte } = await ouvrirPanneau(page);

  await carte.getByRole("button", { name: "Annuler" }).click();
  await expect(carte.getByText(MESSAGES_RECAPITULATIF.annule)).toBeVisible();
  await expect(carte.getByRole("button", { name: "Confirmer" })).toHaveCount(0);

  const recap = verifier(await admin.from("recapitulatif").select("statut").eq("id", semis.recapitulatif).single());
  expect(recap.statut).toBe("annule");
  const karim = verifier(await admin.from("conducteur").select("archive_le").eq("id", semis.karim).single());
  expect(karim.archive_le).toBeNull();
  expect(verifier(await admin.from("affectation").select("id").eq("vehicule_id", semis.camion))).toHaveLength(1);
  expect(semis.appels).toEqual([]);
});

test("une donnée modifiée entre-temps fait tout refuser, avec la ligne en cause", async ({ page }) => {
  const semis = await semer(page, "recap-perime");
  await page.goto("/flotte/vehicules");
  const { carte } = await ouvrirPanneau(page);

  // Un écran clôture l'affectation de Karim à une autre date, après la proposition.
  verifier(await admin.from("affectation").update({ fin: "2026-11-20T17:00:00Z" }).eq("id", semis.affectation));
  await carte.getByRole("button", { name: "Confirmer" }).click();
  await expect(carte.getByRole("alert")).toContainText(
    "Rien n'a été appliqué. Ligne 1 : L'affectation de Karim B. sur AB-123-CD a changé depuis le récapitulatif.",
  );
  await expect(carte.getByRole("button", { name: "Confirmer" })).toBeVisible();

  const karim = verifier(await admin.from("conducteur").select("archive_le").eq("id", semis.karim).single());
  expect(karim.archive_le).toBeNull();
  expect(verifier(await admin.from("affectation").select("id").eq("conducteur_id", semis.lea))).toHaveLength(0);
  expect(semis.appels).toEqual([]);
});
