import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { aujourdhuiParis, instantParis } from "@/lib/dates";
import { creerConducteur } from "@/lib/flotte/conducteurs";
import { ECRITURES, importerFlotte, type FichierRecu } from "@/lib/flotte/import";
import { MESSAGES } from "@/lib/flotte/regles";
import { MESSAGES_IMPORT, type FichierAnalyse, type RapportImport } from "@/lib/flotte/regles-import";
import { creerVehicule } from "@/lib/flotte/vehicules";
import { admin, premiereConnexion, suffixeUnique, type Gestionnaire } from "./outils";

const suffixe = suffixeUnique();
let a: Gestionnaire;
let b: Gestionnaire;

beforeAll(async () => {
  a = await premiereConnexion(`import-a-${suffixe}@exemple.fr`);
  b = await premiereConnexion(`import-b-${suffixe}@exemple.fr`);
  for (const saisie of [
    { prenom: "Karim", nom: "Benali", permis_numero: "KB100", email: "karim@exemple.fr" },
    { prenom: "Léa", nom: "Martin", permis_numero: "LM200" },
  ]) {
    const cree = await creerConducteur(a.client, saisie);
    if (!cree.ok) throw new Error(JSON.stringify(cree.erreurs));
  }
});

afterAll(async () => {
  for (const g of [a, b]) if (g) await admin.auth.admin.deleteUser(g.userId);
});

const fichier = (nom: string, ...lignes: string[]): FichierRecu => ({
  nom,
  octets: new TextEncoder().encode(lignes.join("\r\n")),
});

const plaque = (i: number) => `CA-${100 + i}-FE`;
const numeros = Array.from({ length: 15 }, (_, i) => i + 1);

// 15 conducteurs, tous nouveaux.
const CONDUCTEURS = fichier(
  "conducteurs.csv",
  "Civilité;Prénom;Nom;Date de naissance;N° de permis;Email",
  ...numeros.map((i) => `M.;Conducteur${i};Test;14/05/1985;P${1000 + i};c${i}@exemple.fr`),
);

// 15 véhicules : 2 attitrés déjà dans la flotte, 8 du fichier conducteurs, 3 attitrés sans conducteur, 2 de pool.
function attitre(i: number) {
  if (i === 1) return ["karim@exemple.fr", "01/09/2024"];
  if (i === 2) return ["LM200", ""];
  if (i <= 10) return [i % 2 ? `c${i}@exemple.fr` : `P${1000 + i}`, i === 3 ? "2025-01-15" : ""];
  return ["", ""];
}
const VEHICULES = fichier(
  "vehicules.csv",
  "Plaque;Modèle;Type;Conducteur attitré;Attitré depuis le",
  ...numeros.map((i) => [plaque(i), "Renault Master", i >= 14 ? "Pool" : "Attitré", ...attitre(i)].join(";")),
);

function lignes(rapport: RapportImport, type: "vehicules" | "conducteurs") {
  const trouve = rapport.fichiers.find((f): f is Extract<FichierAnalyse, { type: typeof type }> => f.type === type);
  if (!trouve) throw new Error(`fichier ${type} absent : ${JSON.stringify(rapport.fichiers)}`);
  return trouve.lignes;
}

async function debuts(g: Gestionnaire) {
  const { data, error } = await g.client
    .from("affectation")
    .select("debut, fin, vehicule:vehicule!affectation_vehicule_fk(plaque)")
    .overrideTypes<{ debut: string; fin: string | null; vehicule: { plaque: string } }[], { merge: false }>();
  if (error) throw error;
  return new Map(data.map(({ debut, fin, vehicule }) => [vehicule.plaque, { debut: new Date(debut).toISOString(), fin }]));
}

const compter = async (g: Gestionnaire, table: "vehicule" | "conducteur" | "affectation") =>
  (await g.client.from(table).select("id", { count: "exact", head: true })).count;

describe("import de la flotte", () => {
  it("importe 15 véhicules, 15 conducteurs et les affectations des attitrés en une seule opération", async () => {
    const rapport = await importerFlotte(a.client, [VEHICULES, CONDUCTEURS]);

    expect(rapport.erreur).toBeUndefined();
    expect(rapport.aImporter).toEqual({ vehicules: 15, conducteurs: 15, affectations: 10 });
    expect(rapport.importes).toEqual({ vehicules: 15, conducteurs: 15, affectations: 10 });
    expect(new Set(lignes(rapport, "vehicules").map(({ statut }) => statut))).toEqual(new Set(["importee"]));
    expect(new Set(lignes(rapport, "conducteurs").map(({ statut }) => statut))).toEqual(new Set(["importee"]));

    expect(await compter(a, "vehicule")).toBe(15);
    expect(await compter(a, "conducteur")).toBe(17);
    expect(await compter(a, "affectation")).toBe(10);
  });

  it("chaque attitré a une affectation ouverte, qui débute à minuit, heure de Paris", async () => {
    const affectations = await debuts(a);
    expect(affectations.get(plaque(1))).toEqual({ debut: "2024-08-31T22:00:00.000Z", fin: null });
    expect(affectations.get(plaque(3))?.debut).toBe("2025-01-14T23:00:00.000Z");
    expect(affectations.get(plaque(2))?.debut).toBe(instantParis(aujourdhuiParis(), "00:00"));
    expect(affectations.has(plaque(11))).toBe(false);
    expect(affectations.has(plaque(14))).toBe(false);

    const { data } = await a.client
      .from("affectation")
      .select("conducteur:conducteur!affectation_conducteur_fk(email, permis_numero), vehicule:vehicule!affectation_vehicule_fk(plaque)")
      .overrideTypes<{ conducteur: { email: string; permis_numero: string }; vehicule: { plaque: string } }[], { merge: false }>();
    const conducteurDe = new Map(data!.map(({ conducteur, vehicule }) => [vehicule.plaque, conducteur]));
    expect(conducteurDe.get(plaque(1))?.email).toBe("karim@exemple.fr");
    expect(conducteurDe.get(plaque(2))?.permis_numero).toBe("LM200");
    expect(conducteurDe.get(plaque(5))?.email).toBe("c5@exemple.fr");
    expect(conducteurDe.get(plaque(6))?.permis_numero).toBe("P1006");
  });

  it("réimporter les mêmes fichiers ne crée rien : toutes les lignes sont ignorées", async () => {
    const rapport = await importerFlotte(a.client, [VEHICULES, CONDUCTEURS]);

    expect(rapport.aImporter).toEqual({ vehicules: 0, conducteurs: 0, affectations: 0 });
    expect(rapport.importes).toEqual({ vehicules: 0, conducteurs: 0, affectations: 0 });
    expect(new Set(lignes(rapport, "vehicules").map(({ statut }) => statut))).toEqual(new Set(["ignoree"]));
    expect(new Set(lignes(rapport, "conducteurs").map(({ statut }) => statut))).toEqual(new Set(["ignoree"]));
    expect(await compter(a, "vehicule")).toBe(15);
    expect(await compter(a, "conducteur")).toBe(17);
    expect(await compter(a, "affectation")).toBe(10);
  });

  it("une autre entreprise importe les mêmes plaques sans voir la flotte de la première, ni ses conducteurs", async () => {
    const rapport = await importerFlotte(b.client, [VEHICULES]);
    const vehicules = lignes(rapport, "vehicules");

    expect(rapport.importes).toEqual({ vehicules: 5, conducteurs: 0, affectations: 0 });
    expect(vehicules[0]).toMatchObject({ statut: "en_erreur", motifs: { attitre: MESSAGES_IMPORT.attitreIntrouvable } });
    expect(vehicules.slice(10).map(({ statut }) => statut)).toEqual(Array(5).fill("importee"));
    expect(await compter(b, "vehicule")).toBe(5);
    expect(await compter(a, "vehicule")).toBe(15);
  });

  it("si l'affectation échoue, le véhicule tout juste créé est supprimé et la ligne passe en erreur", async () => {
    const echec = { ok: false as const, erreurs: { general: MESSAGES.conflitAffectationInconnu, debut_date: MESSAGES.dateMalFormee } };
    const rapport = await importerFlotte(
      a.client,
      [fichier("vehicules.csv", "Plaque;Type;Conducteur attitré", "DA-500-FE;Attitré;karim@exemple.fr")],
      { ...ECRITURES, creerAffectation: async () => echec },
    );

    expect(rapport.importes).toEqual({ vehicules: 0, conducteurs: 0, affectations: 0 });
    expect(lignes(rapport, "vehicules")[0]).toMatchObject({
      statut: "en_erreur",
      motifs: { attitre: MESSAGES.conflitAffectationInconnu, attitre_depuis: MESSAGES.dateMalFormee },
    });
    expect((await a.client.from("vehicule").select("id").eq("plaque", "DA-500-FE")).data).toEqual([]);
  });

  it("une plaque écrite entre l'aperçu et l'écriture fait ignorer la ligne", async () => {
    const rapport = await importerFlotte(a.client, [fichier("vehicules.csv", "Plaque;Type", "DB-600-FE;Pool")], {
      ...ECRITURES,
      creerVehicule: async (supabase, saisie) => {
        await creerVehicule(supabase, saisie);
        return creerVehicule(supabase, saisie);
      },
    });

    expect(lignes(rapport, "vehicules")[0]).toMatchObject({
      statut: "ignoree",
      motifs: { plaque: MESSAGES.plaqueDejaPresente("DB-600-FE") },
    });
  });
});
