import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { MESSAGES } from "@/lib/flotte/regles";
import { COLONNES } from "@/lib/flotte/regles-import";
import { connecterNouveauCompte } from "./outils";

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

/** Télécharge un modèle depuis la page d'import : son nom et son contenu. */
async function telecharger(page: Page, lien: string) {
  const [telechargement] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: lien }).click(),
  ]);
  return { nom: telechargement.suggestedFilename(), contenu: await readFile(await telechargement.path()) };
}

/** Le modèle complété de quelques lignes, comme dans un tableur : ses en-têtes, puis les lignes en CRLF. */
function completer(modele: Buffer, lignes: string[]) {
  return Buffer.concat([modele, Buffer.from(lignes.map((ligne) => `${ligne}\r\n`).join(""))]);
}

/** Une ligne du fichier conducteurs, dans l'ordre des colonnes du modèle. */
function conducteur(valeurs: Partial<Record<string, string>>) {
  return COLONNES.conducteurs.map(({ champ }) => valeurs[champ] ?? "").join(";");
}

const fichierDe = (page: Page, type: "véhicules" | "conducteurs") =>
  page.locator("section").filter({ has: page.getByRole("heading", { level: 2, name: new RegExp(`^Fichier ${type}`) }) });

test("importer la flotte depuis les modèles CSV, puis réimporter sans rien créer", async ({ page }) => {
  await connecterNouveauCompte(page, "import");
  await page.getByRole("navigation").getByRole("link", { name: "Véhicules" }).click();

  // 1. L'état vide des véhicules propose l'import
  await expect(page.getByText("Aucun véhicule pour l'instant")).toBeVisible();
  await page.getByRole("link", { name: "Importer un fichier" }).click();
  await expect(page).toHaveURL(/\/flotte\/import$/);
  await expect(page.getByRole("heading", { name: "Importer la flotte", level: 1 })).toBeVisible();

  // 2. Les deux modèles se téléchargent, avec un BOM et leurs en-têtes
  const vehicules = await telecharger(page, "Modèle véhicules");
  expect(vehicules.nom).toBe("designo-vehicules.csv");
  expect(vehicules.contenu.subarray(0, 3)).toEqual(BOM);
  expect(vehicules.contenu.subarray(3).toString("utf8")).toBe(
    "Plaque;Modèle;Type;Conducteur attitré;Attitré depuis le\r\n",
  );
  const conducteurs = await telecharger(page, "Modèle conducteurs");
  expect(conducteurs.nom).toBe("designo-conducteurs.csv");
  expect(conducteurs.contenu.subarray(3).toString("utf8")).toContain("Prénom;Nom;");

  // 3. Les modèles complétés, déposés ensemble : un attitré du même import, une plaque mal formée
  const fichiers = [
    {
      name: "vehicules.csv",
      mimeType: "text/csv",
      buffer: completer(vehicules.contenu, [
        "AB-123-CD;Renault Master;Attitré;karim@exemple.fr;01/09/2024",
        "AB-12-CD;Peugeot Partner;Attitré;;",
        "EF-456-GH;Peugeot Partner;Pool;;",
      ]),
    },
    {
      name: "conducteurs.csv",
      mimeType: "text/csv",
      buffer: completer(conducteurs.contenu, [
        conducteur({ civilite: "M.", prenom: "Karim", nom: "Benali", permis_numero: "120569300123", email: "karim@exemple.fr" }),
        conducteur({ civilite: "Mme", prenom: "Léa", nom: "Martin", email: "lea@exemple.fr" }),
      ]),
    },
  ];
  await page.locator('input[type="file"]').setInputFiles(fichiers);

  // 4. L'aperçu : la ligne en erreur avec son motif, et les lignes à importer
  const enErreur = fichierDe(page, "véhicules").getByRole("listitem").filter({ hasText: "Ligne 3" });
  await expect(enErreur).toContainText(MESSAGES.plaqueMalFormee);
  await expect(enErreur).toContainText("AB-12-CD");
  await expect(fichierDe(page, "véhicules")).toContainText("Karim Benali depuis le 01/09/2024");
  await expect(fichierDe(page, "conducteurs")).toContainText("2 à importer");

  // 5. L'import : les lignes valides sont écrites, l'affectation de l'attitré aussi
  await page.getByRole("button", { name: "Importer 4 lignes" }).click();
  await expect(page.getByText("2 véhicules, 2 conducteurs et 1 affectation ajoutés")).toBeVisible();
  await expect(fichierDe(page, "véhicules")).toContainText("1 en erreur · 2 importées");

  await page.getByRole("link", { name: "Voir les véhicules" }).click();
  await expect(page.getByText("2 véhicules")).toBeVisible();
  await page.getByRole("link", { name: /AB-123-CD/ }).click();
  await expect(page.getByRole("heading", { name: "AB-123-CD", level: 1 })).toBeVisible();
  await expect(page.getByText("Karim Benali")).toBeVisible();
  await expect(page.getByText("depuis le 01/09/2024 00:00 · sans fin")).toBeVisible();

  // 6. Réimporter les mêmes fichiers : tout est déjà dans la flotte, rien à importer
  await page.goto("/flotte/import");
  await page.locator('input[type="file"]').setInputFiles(fichiers);
  await expect(fichierDe(page, "véhicules")).toContainText("1 en erreur · 2 déjà dans votre flotte");
  await expect(fichierDe(page, "conducteurs")).toContainText("2 déjà dans votre flotte");
  await expect(page.getByText("Aucune ligne à importer.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Importer", exact: true })).toBeDisabled();
});
