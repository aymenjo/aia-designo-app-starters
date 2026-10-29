import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { FONCTIONS_PRO } from "@/lib/abonnement/plans";
import { MESSAGES_EXPORT } from "@/lib/avis/export";
import { aujourdhuiParis } from "@/lib/dates";
import { createAdminClient } from "@/lib/supabase/admin";
import { comptesEtEntreprises, connecterNouveauCompte, passerEnPro } from "./outils";

// L'export CSV des avis (phase 24) : en Pro, tout l'historique se télécharge depuis la liste des avis ; en Free, le
// bouton est cadenassé, et le serveur refuse l'export. Les avis sont semés hors RLS, avec des instants fixes.

const admin = createAdminClient();
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const EXPORT_CSV = FONCTIONS_PRO.find(({ nom }) => nom === "Export CSV")!;

async function entrepriseDe(email: string) {
  const { entreprises } = await comptesEtEntreprises(email);
  return entreprises[0].id as string;
}

/** Des avis de l'entreprise, avec chacun son fichier. */
async function semer(entreprise_id: string, avis: Record<string, unknown>[]) {
  const { error } = await admin.from("avis").insert(
    avis.map((champs) => ({
      entreprise_id,
      fichier: `${entreprise_id}/${crypto.randomUUID()}.png`,
      fichier_type: "image/png",
      ...champs,
    })),
    { defaultToNull: false },
  );
  if (error) throw error;
}

test("en Pro, tout l'historique des avis se télécharge en CSV, prêt pour Excel", async ({ page }) => {
  const email = await connecterNouveauCompte(page, "export-pro");
  await passerEnPro(email);
  const entreprise_id = await entrepriseDe(email);
  const vehicule = await admin
    .from("vehicule")
    .insert({ entreprise_id, plaque: "AB-123-CD", type: "attitre" })
    .select("id")
    .single();
  if (vehicule.error) throw vehicule.error;
  const karim = await admin.from("conducteur").insert({ entreprise_id, prenom: "Karim", nom: "Benali" }).select("id").single();
  if (karim.error) throw karim.error;
  await semer(entreprise_id, [
    {
      numero: "0880341257",
      plaque: "AB-123-CD",
      vehicule_id: vehicule.data.id,
      // 07:30 UTC le 3 mars : 08:30 à Paris.
      infraction_le: "2026-03-03T07:30:00Z",
      lieu: "A6, Auxerre, sens Paris-Province",
      infraction: "Excès de vitesse inférieur à 20 km/h",
      montant_centimes: 13500,
      date_envoi: "2026-03-10",
      statut: "designe",
      conducteur_id: karim.data.id,
      designe_le: "2026-03-20T09:00:00Z",
      depose_le: "2026-03-12T08:00:00Z",
    },
    {
      statut: "classe",
      classe_le: "2026-03-25T10:00:00Z",
      motif_classement: "autre",
      motif_libre: "Plaque mal lue ; à vérifier",
      depose_le: "2026-03-11T08:00:00Z",
    },
    { depose_le: "2026-03-10T08:00:00Z" },
  ]);

  // Le filtre de la liste ne change rien : l'export reprend tous les avis.
  await page.goto("/avis?statut=designe");
  const [telechargement] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Exporter en CSV" }).click(),
  ]);
  expect(telechargement.suggestedFilename()).toBe(`designo-avis-${aujourdhuiParis()}.csv`);
  const contenu = await readFile(await telechargement.path());
  expect(contenu.subarray(0, 3)).toEqual(BOM);
  expect(contenu.subarray(3).toString("utf8").split("\r\n")).toEqual([
    "N° d'avis;Plaque;Date de l'infraction;Heure;Lieu;Infraction;Montant (€);Date d'envoi;Échéance;Statut;Motif de classement;Conducteur désigné;Date de désignation;Date de classement;Déposé le",
    '="0880341257";AB-123-CD;03/03/2026;08:30;A6, Auxerre, sens Paris-Province;Excès de vitesse inférieur à 20 km/h;135,00;10/03/2026;24/04/2026;Désigné;;Karim Benali;20/03/2026;;12/03/2026',
    ';;;;;;;;;Classé;"Plaque mal lue ; à vérifier";;;25/03/2026;11/03/2026',
    ";;;;;;;;;À traiter;;;;;10/03/2026",
    "",
  ]);
});

test("en Free, le bouton est cadenassé et invite à passer en Pro, et le serveur refuse l'export", async ({ page }) => {
  const email = await connecterNouveauCompte(page, "export-free");
  await semer(await entrepriseDe(email), [{}]);

  await page.goto("/avis");
  await page.getByRole("button", { name: "Exporter en CSV" }).click();
  const fenetre = page.getByRole("dialog", { name: "Exporter en CSV" });
  await expect(fenetre.getByRole("group", { name: "Export CSV" })).toContainText(EXPORT_CSV.explication);
  await expect(fenetre.getByRole("link", { name: "Passer en Pro" })).toBeVisible();

  const reponse = await page.request.get("/avis/export");
  expect(reponse.status()).toBe(403);
  expect(await reponse.text()).toBe(MESSAGES_EXPORT.fonctionPro);
});
