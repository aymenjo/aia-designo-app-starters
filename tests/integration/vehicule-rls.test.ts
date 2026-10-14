import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MESSAGES } from "@/lib/flotte/regles";
import { archiverVehicule, creerVehicule, modifierVehicule, reactiverVehicule } from "@/lib/flotte/vehicules";
import { admin, nouveauClient, premiereConnexion, suffixeUnique, type Gestionnaire } from "./outils";

const suffixe = suffixeUnique();
let a: Gestionnaire;
let b: Gestionnaire;
let vehiculeA: { id: string; entreprise_id: string };

beforeAll(async () => {
  a = await premiereConnexion(`vehicule-a-${suffixe}@exemple.fr`);
  b = await premiereConnexion(`vehicule-b-${suffixe}@exemple.fr`);
  const { data, error } = await a.client
    .from("vehicule")
    .insert({ plaque: "AB-123-CD", modele: "Renault Master", type: "attitre" })
    .select("id, entreprise_id")
    .single();
  if (error) throw error;
  vehiculeA = data;
});

afterAll(async () => {
  for (const g of [a, b]) if (g) await admin.auth.admin.deleteUser(g.userId);
});

async function enBase(id: string) {
  const { data } = await admin.from("vehicule").select("entreprise_id, plaque, modele, archive_le").eq("id", id).single();
  return data;
}

describe("vehicule : isolation par entreprise (RLS)", () => {
  it("le véhicule est rattaché d'office à l'entreprise du gestionnaire", () => {
    expect(vehiculeA.entreprise_id).toBe(a.entrepriseId);
  });

  it("un gestionnaire ne voit pas les véhicules d'une autre entreprise, même par leur id", async () => {
    const { data, error } = await b.client.from("vehicule").select("id").eq("id", vehiculeA.id);
    expect(error).toBeNull();
    expect(data).toEqual([]);
    expect((await a.client.from("vehicule").select("id")).data).toEqual([{ id: vehiculeA.id }]);
  });

  it("un visiteur sans session ne voit aucun véhicule", async () => {
    const { data } = await nouveauClient().from("vehicule").select("id");
    expect(data ?? []).toEqual([]);
  });

  it("un gestionnaire ne modifie pas le véhicule d'une autre entreprise", async () => {
    const { data } = await b.client.from("vehicule").update({ modele: "Piraté" }).eq("id", vehiculeA.id).select();
    expect(data ?? []).toEqual([]);
    expect((await enBase(vehiculeA.id))?.modele).toBe("Renault Master");

    const resultat = await modifierVehicule(b.client, vehiculeA.id, { plaque: "AB-123-CD", type: "pool" });
    expect(resultat).toEqual({ ok: false, erreurs: { general: MESSAGES.vehiculeIntrouvable } });
    expect(await archiverVehicule(b.client, vehiculeA.id)).toMatchObject({ ok: false });
    expect((await enBase(vehiculeA.id))?.archive_le).toBeNull();
  });

  it("entreprise_id ne peut être ni imposé à la création, ni modifié", async () => {
    const creation = await a.client
      .from("vehicule")
      .insert({ plaque: "EF-456-GH", type: "pool", entreprise_id: b.entrepriseId });
    expect(creation.error).not.toBeNull();

    const changement = await a.client
      .from("vehicule")
      .update({ entreprise_id: b.entrepriseId })
      .eq("id", vehiculeA.id);
    expect(changement.error).not.toBeNull();
    expect((await enBase(vehiculeA.id))?.entreprise_id).toBe(a.entrepriseId);
  });

  it("un gestionnaire ne supprime pas le véhicule d'une autre entreprise, mais supprime les siens", async () => {
    const { data } = await b.client.from("vehicule").delete().eq("id", vehiculeA.id).select();
    expect(data ?? []).toEqual([]);
    expect(await enBase(vehiculeA.id)).not.toBeNull();

    // Sans historique, le véhicule se supprime : on en crée un pour l'occasion.
    const jetable = await a.client.from("vehicule").insert({ plaque: "ZZ-999-ZZ", type: "pool" }).select("id").single();
    if (jetable.error) throw jetable.error;
    const suppression = await a.client.from("vehicule").delete().eq("id", jetable.data.id).select("id");
    expect(suppression.data).toEqual([{ id: jetable.data.id }]);
  });
});

describe("vehicule : plaque", () => {
  it("la base refuse une plaque non normalisée", async () => {
    const { error } = await a.client.from("vehicule").insert({ plaque: "ab 123 cd", type: "attitre" });
    expect(error?.code).toBe("23514");
  });

  it("la même plaque peut exister dans deux entreprises", async () => {
    const resultat = await creerVehicule(b.client, { plaque: "ab-123-cd", type: "pool" });
    expect(resultat).toMatchObject({ ok: true, vehicule: { plaque: "AB-123-CD", type: "pool", modele: null } });
  });

  it("une plaque déjà présente est refusée, avec le message des écrans", async () => {
    const resultat = await creerVehicule(a.client, { plaque: "AB123CD", type: "pool" });
    expect(resultat).toEqual({ ok: false, erreurs: { plaque: MESSAGES.plaqueDejaPresente("AB-123-CD") } });
  });

  it("la plaque d'un véhicule archivé renvoie vers sa fiche, qui le réactive", async () => {
    const cree = await creerVehicule(a.client, { plaque: "123 abc 45", type: "pool" });
    if (!cree.ok) throw new Error("création impossible");
    const archive = await archiverVehicule(a.client, cree.vehicule.id);
    expect(archive).toMatchObject({ ok: true, vehicule: { archive_le: expect.any(String) } });

    expect(await creerVehicule(a.client, { plaque: "123-ABC-45", type: "attitre" })).toEqual({
      ok: false,
      erreurs: { plaque: MESSAGES.plaqueArchivee("123-ABC-45") },
      vehiculeArchiveId: cree.vehicule.id,
    });

    // Archiver deux fois garde la date du premier archivage.
    const encore = await archiverVehicule(a.client, cree.vehicule.id);
    expect(encore.ok && encore.vehicule.archive_le).toBe(archive.ok && archive.vehicule.archive_le);

    const reactive = await reactiverVehicule(a.client, cree.vehicule.id);
    expect(reactive).toMatchObject({ ok: true, vehicule: { archive_le: null } });
  });

  it("modifier un véhicule vers une plaque déjà prise est refusé", async () => {
    const autre = await creerVehicule(a.client, { plaque: "KL-789-MN", type: "attitre" });
    if (!autre.ok) throw new Error("création impossible");
    const resultat = await modifierVehicule(a.client, autre.vehicule.id, { plaque: "AB-123-CD", type: "attitre" });
    expect(resultat).toEqual({ ok: false, erreurs: { plaque: MESSAGES.plaqueDejaPresente("AB-123-CD") } });
  });

  it("un id qui n'est pas un uuid donne « véhicule introuvable »", async () => {
    expect(await archiverVehicule(a.client, "pas-un-uuid")).toEqual({
      ok: false,
      erreurs: { general: MESSAGES.vehiculeIntrouvable },
    });
  });
});
