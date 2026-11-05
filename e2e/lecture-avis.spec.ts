import { expect, test, type Page } from "@playwright/test";
import { MESSAGES_AVIS, type Confiances } from "@/lib/avis/regles";
import { ajouterJours, aujourdhuiParis, depuisIso, instantParis } from "@/lib/dates";
import { createAdminClient } from "@/lib/supabase/admin";
import { comptesEtEntreprises, connecterNouveauCompte } from "./outils";

// L'écran d'un avis lu par l'IA. La lecture elle-même n'est pas jouée ici (pas d'appel à l'API en CI) :
// l'avis est semé tel qu'une lecture l'aurait laissé, avec ses valeurs et ses niveaux.

const aujourdhui = aujourdhuiParis();
const ENVOI = ajouterJours(aujourdhui, -2);

/** Tout est lu et sûr, sauf l'heure (orange) et la date d'envoi (rouge, mais lue). */
const CONFIANCES: Confiances = {
  numero: "sur",
  plaque: "sur",
  infraction_le: "a_verifier",
  lieu: "sur",
  infraction: "sur",
  montant_centimes: "sur",
  date_envoi: "non_lu",
};

/** Sème un avis lu, sans fichier dans le bucket : l'écran affiche alors ses champs sans l'image. */
async function semerAvisLu(email: string, numero: string, champs: Record<string, unknown> = {}) {
  const { entreprises } = await comptesEtEntreprises(email);
  const entrepriseId = entreprises[0].id as string;
  const { data, error } = await createAdminClient()
    .from("avis")
    .insert({
      entreprise_id: entrepriseId,
      fichier: `${entrepriseId}/${crypto.randomUUID()}.png`,
      fichier_type: "image/png",
      numero,
      plaque: "AB-123-CD",
      infraction_le: instantParis(ajouterJours(aujourdhui, -5), "08:30"),
      lieu: "A6, Auxerre, sens Paris-Province",
      infraction: "Excès de vitesse inférieur à 20 km/h",
      montant_centimes: 13500,
      date_envoi: ENVOI,
      statut: "a_traiter",
      lecture_ia: "lue",
      confiances: CONFIANCES,
      ...champs,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

// Exact : le bouton « Confirmer ce champ : Date d'envoi » porte aussi ce nom.
const dateEnvoi = (page: Page) => page.getByLabel("Date d'envoi", { exact: true });
const confirmer = (page: Page) => page.getByRole("button", { name: "Confirmer ce champ : Date d'envoi" });

test("un avis lu affiche ses niveaux, et reste « À traiter » tant que le champ rouge n'est pas confirmé", async ({
  page,
}) => {
  const email = await connecterNouveauCompte(page, "lecture-confirmer");
  const id = await semerAvisLu(email, "7000000001");
  await page.goto(`/avis/${id}`);

  await expect(dateEnvoi(page)).toHaveValue(depuisIso(ENVOI));
  await expect(page.getByText("Sûr", { exact: true })).toHaveCount(5);
  await expect(page.getByText("À vérifier", { exact: true })).toHaveCount(1);
  await expect(page.getByText("Non lu", { exact: true })).toHaveCount(1);
  await expect(page.getByText("L'avis passera « À valider » une fois confirmés : Date d'envoi.")).toBeVisible();

  // Enregistrer sans confirmer : rien ne change, le champ rouge bloque toujours.
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Avis enregistré.")).toBeVisible();
  await expect(page.getByText("À traiter", { exact: true })).toBeVisible();
  await expect(confirmer(page)).toBeVisible();

  // Confirmer efface le niveau à l'écran, puis l'enregistrement passe l'avis « À valider ».
  await confirmer(page).click();
  await expect(page.getByText("Non lu", { exact: true })).toHaveCount(0);
  await expect(confirmer(page)).toHaveCount(0);
  await expect(dateEnvoi(page)).toBeFocused();
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("À valider", { exact: true })).toBeVisible();

  // Après rechargement : la confirmation est enregistrée, les autres niveaux restent.
  await page.reload();
  await expect(page.getByText("À valider", { exact: true })).toBeVisible();
  await expect(page.getByText("Non lu", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Sûr", { exact: true })).toHaveCount(5);
  await expect(page.getByText("À vérifier", { exact: true })).toHaveCount(1);
  await expect(page.getByText("L'avis passera « À valider »")).toHaveCount(0);
});

test("corriger le champ rouge suffit aussi : il perd son niveau", async ({ page }) => {
  const email = await connecterNouveauCompte(page, "lecture-corriger");
  const id = await semerAvisLu(email, "7000000002");
  await page.goto(`/avis/${id}`);

  // La saisie ne s'efface pas quand le cadre perd sa couleur.
  const corrigee = depuisIso(ajouterJours(aujourdhui, -1));
  await dateEnvoi(page).fill(corrigee);
  await expect(page.getByText("Non lu", { exact: true })).toHaveCount(0);
  await expect(dateEnvoi(page)).toHaveValue(corrigee);

  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("À valider", { exact: true })).toBeVisible();
  await page.reload();
  await expect(dateEnvoi(page)).toHaveValue(corrigee);
  await expect(page.getByText("Non lu", { exact: true })).toHaveCount(0);
});

test("un n° lu mais refusé par les règles est montré avec son motif, jusqu'à ce que le champ soit rempli", async ({
  page,
}) => {
  const email = await connecterNouveauCompte(page, "lecture-refusee");
  const id = await semerAvisLu(email, "7000000004", {
    numero: null,
    confiances: { ...CONFIANCES, numero: "non_lu" },
    valeurs_refusees: { numero: { valeur: "2026-08-LY-004817", motif: MESSAGES_AVIS.numeroMalForme } },
  });
  await page.goto(`/avis/${id}`);

  const releve = page.getByText(`Relevé sur l'avis : 2026-08-LY-004817. ${MESSAGES_AVIS.numeroMalForme}`);
  await expect(releve).toBeVisible();
  await expect(page.getByText("Refusé", { exact: true })).toBeVisible();
  await expect(page.getByLabel("N° d'avis")).toHaveValue("");
  // Rien à confirmer : le champ est vide.
  await expect(page.getByRole("button", { name: "Confirmer ce champ : N° d'avis" })).toHaveCount(0);

  // Le remplir efface la valeur refusée, à l'écran puis en base.
  await page.getByLabel("N° d'avis").fill("7000000005");
  await expect(releve).toHaveCount(0);
  await expect(page.getByText("Refusé", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByRole("heading", { name: "Avis n° 7000000005", level: 1 })).toBeVisible();
  await page.reload();
  await expect(releve).toHaveCount(0);
});

test("un avis que l'IA n'a pas pu lire l'annonce, et se saisit à la main", async ({ page }) => {
  const email = await connecterNouveauCompte(page, "lecture-echec");
  const id = await semerAvisLu(email, "7000000003", {
    numero: null,
    plaque: null,
    lecture_ia: "echec",
    confiances: {},
  });
  await page.goto(`/avis/${id}`);

  await expect(page.getByText("Désigno n'a pas pu lire cet avis : saisissez ses champs à la main")).toBeVisible();
  await expect(page.getByLabel("N° d'avis")).toHaveValue("");
  await expect(page.getByText("Sûr", { exact: true })).toHaveCount(0);
});
