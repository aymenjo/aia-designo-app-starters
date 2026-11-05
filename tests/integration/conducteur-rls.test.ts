import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  archiverConducteur,
  creerConducteur,
  modifierConducteur,
  reactiverConducteur,
} from "@/lib/flotte/conducteurs";
import { MESSAGES } from "@/lib/flotte/regles";
import { admin, nouveauClient, premiereConnexion, suffixeUnique, type Gestionnaire } from "./outils";

const suffixe = suffixeUnique();
let a: Gestionnaire;
let b: Gestionnaire;
let karim: { id: string; entreprise_id: string };

beforeAll(async () => {
  a = await premiereConnexion(`conducteur-a-${suffixe}@exemple.fr`);
  b = await premiereConnexion(`conducteur-b-${suffixe}@exemple.fr`);
  const { data, error } = await a.client
    .from("conducteur")
    .insert({ prenom: "Karim", nom: "Benali", permis_numero: "123456789012", email: "karim@exemple.fr" })
    .select("id, entreprise_id")
    .single();
  if (error) throw error;
  karim = data;
});

afterAll(async () => {
  for (const g of [a, b]) if (g) await admin.auth.admin.deleteUser(g.userId);
});

async function enBase(id: string) {
  const { data } = await admin.from("conducteur").select("entreprise_id, nom, archive_le").eq("id", id).single();
  return data;
}

describe("conducteur : isolation par entreprise (RLS)", () => {
  it("le conducteur est rattaché d'office à l'entreprise du gestionnaire", () => {
    expect(karim.entreprise_id).toBe(a.entrepriseId);
  });

  it("un gestionnaire ne voit pas les conducteurs d'une autre entreprise, même par leur id", async () => {
    const { data, error } = await b.client.from("conducteur").select("id").eq("id", karim.id);
    expect(error).toBeNull();
    expect(data).toEqual([]);
    expect((await a.client.from("conducteur").select("id")).data).toEqual([{ id: karim.id }]);
  });

  it("un visiteur sans session ne voit aucun conducteur", async () => {
    const { data } = await nouveauClient().from("conducteur").select("id");
    expect(data ?? []).toEqual([]);
  });

  it("un gestionnaire ne modifie pas le conducteur d'une autre entreprise", async () => {
    const { data } = await b.client.from("conducteur").update({ nom: "Piraté" }).eq("id", karim.id).select();
    expect(data ?? []).toEqual([]);
    expect((await enBase(karim.id))?.nom).toBe("Benali");

    const resultat = await modifierConducteur(b.client, karim.id, { prenom: "Karim", nom: "Piraté" });
    expect(resultat).toEqual({ ok: false, erreurs: { general: MESSAGES.conducteurIntrouvable } });
    expect(await archiverConducteur(b.client, karim.id)).toMatchObject({ ok: false });
    expect((await enBase(karim.id))?.archive_le).toBeNull();
  });

  it("entreprise_id ne peut être ni imposé à la création, ni modifié", async () => {
    const creation = await a.client
      .from("conducteur")
      .insert({ prenom: "Léa", nom: "Martin", entreprise_id: b.entrepriseId });
    expect(creation.error).not.toBeNull();

    const changement = await a.client.from("conducteur").update({ entreprise_id: b.entrepriseId }).eq("id", karim.id);
    expect(changement.error).not.toBeNull();
    expect((await enBase(karim.id))?.entreprise_id).toBe(a.entrepriseId);
  });

  it("un gestionnaire ne supprime pas le conducteur d'une autre entreprise, mais supprime les siens", async () => {
    const { data } = await b.client.from("conducteur").delete().eq("id", karim.id).select();
    expect(data ?? []).toEqual([]);
    expect(await enBase(karim.id)).not.toBeNull();

    // Sans historique, le conducteur se supprime : on en crée un pour l'occasion.
    const jetable = await a.client.from("conducteur").insert({ prenom: "Jean", nom: "Jetable" }).select("id").single();
    if (jetable.error) throw jetable.error;
    const suppression = await a.client.from("conducteur").delete().eq("id", jetable.data.id).select("id");
    expect(suppression.data).toEqual([{ id: jetable.data.id }]);
  });
});

describe("conducteur : filets de sécurité en base", () => {
  it.each([
    ["un permis non normalisé", { permis_numero: "1234 5678" }],
    ["un email en majuscules", { email: "Lea@Exemple.fr" }],
    ["une catégorie inconnue", { permis_categories: ["B", "X"] }],
    ["une naissance avant 1900", { date_naissance: "1899-12-31" }],
    ["une délivrance avant 14 ans", { date_naissance: "2000-02-29", permis_delivre_le: "2014-02-27" }],
    ["un prénom vide", { prenom: "  " }],
  ])("la base refuse %s", async (_cas, champs) => {
    const { error } = await a.client.from("conducteur").insert({ prenom: "Léa", nom: "Martin", ...champs });
    expect(error?.code).toBe("23514");
  });

  it("la base accepte une délivrance le jour des 14 ans, 29/02 compris", async () => {
    const { error } = await a.client
      .from("conducteur")
      .insert({ prenom: "Léa", nom: "Martin", date_naissance: "2000-02-29", permis_delivre_le: "2014-02-28" });
    expect(error).toBeNull();
  });
});

describe("conducteur : permis et email uniques", () => {
  it("le même permis et le même email peuvent exister dans deux entreprises", async () => {
    const resultat = await creerConducteur(b.client, {
      prenom: "Karim",
      nom: "Benali",
      permis_numero: "1234 5678 9012",
      email: "KARIM@exemple.fr",
    });
    expect(resultat).toMatchObject({
      ok: true,
      conducteur: { permis_numero: "123456789012", email: "karim@exemple.fr", civilite: null },
    });
  });

  it("un permis déjà présent est refusé sous sa forme normalisée, en nommant son titulaire", async () => {
    const resultat = await creerConducteur(a.client, { prenom: "Léa", nom: "Martin", permis_numero: "1234-5678-9012" });
    expect(resultat).toEqual({
      ok: false,
      erreurs: { permis_numero: MESSAGES.permisDejaPresent("Karim Benali") },
    });
  });

  it("un email déjà présent est refusé quelle que soit la casse", async () => {
    const resultat = await creerConducteur(a.client, { prenom: "Léa", nom: "Martin", email: "Karim@Exemple.FR" });
    expect(resultat).toEqual({ ok: false, erreurs: { email: MESSAGES.emailDejaPresent("Karim Benali") } });
  });

  it("modifier un conducteur vers le permis d'un autre est refusé, garder le sien ne l'est pas", async () => {
    const lea = await creerConducteur(a.client, { prenom: "Léa", nom: "Durand", permis_numero: "LEA1" });
    if (!lea.ok) throw new Error("création impossible");
    expect(
      await modifierConducteur(a.client, lea.conducteur.id, { prenom: "Léa", nom: "Durand", permis_numero: "123456789012" }),
    ).toEqual({ ok: false, erreurs: { permis_numero: MESSAGES.permisDejaPresent("Karim Benali") } });
    expect(
      await modifierConducteur(a.client, lea.conducteur.id, { prenom: "Léa", nom: "Durand", permis_numero: "lea 1" }),
    ).toMatchObject({ ok: true, conducteur: { permis_numero: "LEA1" } });
  });

  it("le permis ou l'email d'un conducteur archivé renvoie vers sa fiche, qui le réactive", async () => {
    const cree = await creerConducteur(a.client, {
      prenom: "Paul",
      nom: "Petit",
      permis_numero: "PAUL42",
      email: "paul@exemple.fr",
    });
    if (!cree.ok) throw new Error("création impossible");
    const archive = await archiverConducteur(a.client, cree.conducteur.id);
    expect(archive).toMatchObject({ ok: true, conducteur: { archive_le: expect.any(String) } });

    expect(await creerConducteur(a.client, { prenom: "Paul", nom: "Petit", permis_numero: "paul 42" })).toEqual({
      ok: false,
      erreurs: { permis_numero: MESSAGES.permisArchive("Paul Petit") },
      conducteurArchiveId: cree.conducteur.id,
    });
    expect(await creerConducteur(a.client, { prenom: "Paul", nom: "Petit", email: "Paul@exemple.fr" })).toEqual({
      ok: false,
      erreurs: { email: MESSAGES.emailArchive("Paul Petit") },
      conducteurArchiveId: cree.conducteur.id,
    });

    // Archiver deux fois garde la date du premier archivage.
    const encore = await archiverConducteur(a.client, cree.conducteur.id);
    expect(encore.ok && encore.conducteur.archive_le).toBe(archive.ok && archive.conducteur.archive_le);

    const reactive = await reactiverConducteur(a.client, cree.conducteur.id);
    expect(reactive).toMatchObject({ ok: true, conducteur: { archive_le: null } });
  });

  it("un id qui n'est pas un uuid donne « conducteur introuvable »", async () => {
    expect(await archiverConducteur(a.client, "pas-un-uuid")).toEqual({
      ok: false,
      erreurs: { general: MESSAGES.conducteurIntrouvable },
    });
  });
});
