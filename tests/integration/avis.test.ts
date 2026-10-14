import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BUCKET_AVIS, creerAvis, modifierAvis, urlFichier } from "@/lib/avis/avis";
import { MESSAGES_AVIS, type SaisieAvis } from "@/lib/avis/regles";
import { MESSAGES } from "@/lib/flotte/regles";
import { archiverVehicule, creerVehicule, supprimerVehicule } from "@/lib/flotte/vehicules";
import {
  PNG,
  admin,
  avisEnBase,
  cheminAvis,
  deposerAvis,
  envoyerFichierAvis,
  nouveauClient,
  premiereConnexion,
  suffixeUnique,
  supprimerGestionnaire,
  type Gestionnaire,
} from "./outils";

const suffixe = suffixeUnique();
let a: Gestionnaire;
let b: Gestionnaire;

beforeAll(async () => {
  a = await premiereConnexion(`avis-a-${suffixe}@exemple.fr`);
  b = await premiereConnexion(`avis-b-${suffixe}@exemple.fr`);
});

afterAll(async () => {
  for (const g of [a, b]) if (g) await supprimerGestionnaire(g);
});

const COMPLET: SaisieAvis = {
  numero: "1234567890",
  plaque: "AV-101-AA",
  infraction_date: "03/10/2026",
  infraction_heure: "08:30",
  lieu: "A6, Auxerre",
  infraction: "Excès de vitesse inférieur à 20 km/h",
  montant: "135",
  date_envoi: "06/10/2026",
};

describe("avis : isolation par entreprise (RLS)", () => {
  let avisA: { id: string; chemin: string };

  beforeAll(async () => {
    avisA = await deposerAvis(a);
  });

  it("l'avis est créé « À traiter », rattaché d'office à l'entreprise, avec le type relu dans le bucket", async () => {
    expect(await avisEnBase(avisA.id)).toMatchObject({
      entreprise_id: a.entrepriseId,
      statut: "a_traiter",
      source: "depot",
      fichier: avisA.chemin,
      fichier_type: "image/png",
      fichier_nom: "avis.png",
    });
  });

  it("un gestionnaire ne voit, ne modifie ni ne lit le fichier de l'avis d'une autre entreprise", async () => {
    expect((await b.client.from("avis").select("id").eq("id", avisA.id)).data).toEqual([]);

    const { data } = await b.client.from("avis").update({ lieu: "Piraté" }).eq("id", avisA.id).select();
    expect(data ?? []).toEqual([]);
    expect(await modifierAvis(b.client, avisA.id, { lieu: "Piraté" })).toEqual({
      ok: false,
      erreurs: { general: MESSAGES_AVIS.avisIntrouvable },
    });
    expect((await avisEnBase(avisA.id))?.lieu).toBeNull();

    expect((await b.client.storage.from(BUCKET_AVIS).download(avisA.chemin)).data).toBeNull();
    expect(await urlFichier(b.client, avisA.chemin)).toBeNull();
    expect(await urlFichier(a.client, avisA.chemin)).toMatch(/^http.*token=/);
  });

  it("un gestionnaire ne dépose pas de fichier dans le dossier d'une autre entreprise, ni d'avis sur le fichier d'une autre", async () => {
    const intrus = await b.client.storage.from(BUCKET_AVIS).upload(cheminAvis(a), PNG, { contentType: "image/png" });
    expect(intrus.error).not.toBeNull();

    expect(await creerAvis(b.client, { chemin: avisA.chemin, nom: "vol.png" })).toEqual({
      ok: false,
      erreur: MESSAGES_AVIS.fichierIntrouvable,
    });
    // En direct, la contrainte refuse un fichier rangé hors du dossier de l'entreprise.
    const direct = await b.client
      .from("avis")
      .insert({ fichier: cheminAvis(a), fichier_type: "image/png" });
    expect(direct.error?.code).toBe("23514");
  });

  it("un gestionnaire ne remplace ni ne supprime un fichier déposé", async () => {
    const remplace = await a.client.storage
      .from(BUCKET_AVIS)
      .upload(avisA.chemin, PNG, { contentType: "image/png", upsert: true });
    expect(remplace.error).not.toBeNull();

    await a.client.storage.from(BUCKET_AVIS).remove([avisA.chemin]);
    expect((await a.client.storage.from(BUCKET_AVIS).download(avisA.chemin)).error).toBeNull();
  });

  it("un visiteur sans session ne voit aucun avis ni aucun fichier", async () => {
    const anonyme = nouveauClient();
    expect((await anonyme.from("avis").select("id")).data ?? []).toEqual([]);
    expect((await anonyme.storage.from(BUCKET_AVIS).download(avisA.chemin)).data).toBeNull();
    const depot = await anonyme.storage
      .from(BUCKET_AVIS)
      .upload(`${a.entrepriseId}/${crypto.randomUUID()}.png`, PNG, { contentType: "image/png" });
    expect(depot.error).not.toBeNull();
  });

  it("entreprise_id ne peut être ni imposé à la création, ni modifié ; un avis ne se supprime pas", async () => {
    const creation = await a.client
      .from("avis")
      .insert({ fichier: cheminAvis(b), fichier_type: "image/png", entreprise_id: b.entrepriseId });
    expect(creation.error).not.toBeNull();

    const changement = await a.client.from("avis").update({ entreprise_id: b.entrepriseId }).eq("id", avisA.id);
    expect(changement.error).not.toBeNull();

    await a.client.from("avis").delete().eq("id", avisA.id);
    expect((await avisEnBase(avisA.id))?.entreprise_id).toBe(a.entrepriseId);
  });
});

describe("avis : contraintes en base", () => {
  let id: string;

  beforeAll(async () => {
    id = (await deposerAvis(a)).id;
  });

  it.each([
    ["un n° qui n'a pas 10 chiffres", { numero: "123" }],
    ["une plaque non normalisée", { plaque: "ab 123 cd" }],
    ["un montant nul", { montant_centimes: 0 }],
  ])("refuse %s (23514)", async (_cas, valeurs) => {
    const { error } = await a.client.from("avis").update(valeurs).eq("id", id);
    expect(error?.code).toBe("23514");
  });

  it("l'échéance vaut la date d'envoi plus 45 jours, et suit la date d'envoi", async () => {
    await a.client.from("avis").update({ date_envoi: "2026-10-14" }).eq("id", id);
    expect((await avisEnBase(id))?.echeance).toBe("2026-11-28");
    await a.client.from("avis").update({ date_envoi: "2028-01-20" }).eq("id", id);
    expect((await avisEnBase(id))?.echeance).toBe("2028-03-05");
  });

  it("refuse le véhicule d'une autre entreprise, même en direct", async () => {
    const vehiculeB = await creerVehicule(b.client, { plaque: "AV-202-BB", type: "attitre" });
    if (!vehiculeB.ok) throw new Error("véhicule B");
    const { error } = await a.client.from("avis").update({ vehicule_id: vehiculeB.vehicule.id }).eq("id", id);
    expect(error?.code).toBe("23503");
  });

  it("un véhicule qui a un avis ne se supprime pas : il s'archive", async () => {
    const vehicule = await creerVehicule(a.client, { plaque: "AV-303-CC", type: "attitre" });
    if (!vehicule.ok) throw new Error("véhicule");
    const rattache = await modifierAvis(a.client, id, { plaque: "AV-303-CC" });
    expect(rattache).toMatchObject({ ok: true, avis: { vehicule_id: vehicule.vehicule.id } });

    expect(await supprimerVehicule(a.client, vehicule.vehicule.id)).toEqual({
      ok: false,
      erreurs: { general: MESSAGES.vehiculeAvecHistorique },
    });
  });
});

describe("avis : bucket et dépôt", () => {
  it("le bucket refuse un type non accepté", async () => {
    const { error } = await a.client.storage
      .from(BUCKET_AVIS)
      .upload(cheminAvis(a, "txt"), Buffer.from("texte"), { contentType: "text/plain" });
    expect(error).toMatchObject({ code: "InvalidMimeType" });
  });

  it("le bucket refuse un fichier de plus de 10 Mo", async () => {
    const lourd = Buffer.alloc(10 * 1024 * 1024 + 1);
    const { error } = await a.client.storage.from(BUCKET_AVIS).upload(cheminAvis(a), lourd, { contentType: "image/png" });
    expect(error).toMatchObject({ code: "EntityTooLarge" });
  });

  it("creerAvis refuse un chemin absent du bucket, ou mal formé", async () => {
    for (const cheminFichier of [cheminAvis(a), `${a.entrepriseId}/../avis.png`, "avis.png"]) {
      expect(await creerAvis(a.client, { chemin: cheminFichier, nom: "x.png" })).toEqual({
        ok: false,
        erreur: MESSAGES_AVIS.fichierIntrouvable,
      });
    }
  });

  it("creerAvis refuse un fichier dont l'extension ne correspond pas au type", async () => {
    const pdfDeguise = await envoyerFichierAvis(a, PNG, "image/png", "pdf");
    expect(await creerAvis(a.client, { chemin: pdfDeguise, nom: "x.pdf" })).toEqual({
      ok: false,
      erreur: MESSAGES_AVIS.formatRefuse,
    });
  });

  it("rejouer le même dépôt renvoie le même avis", async () => {
    const { id, chemin: cheminFichier } = await deposerAvis(a);
    expect(await creerAvis(a.client, { chemin: cheminFichier, nom: "avis.png" })).toEqual({ ok: true, id });
  });
});

describe("avis : saisie", () => {
  let id: string;
  let vehiculeId: string;

  beforeAll(async () => {
    id = (await deposerAvis(a)).id;
    const vehicule = await creerVehicule(a.client, { plaque: "AV-101-AA", type: "attitre" });
    if (!vehicule.ok) throw new Error("véhicule");
    vehiculeId = vehicule.vehicule.id;
  });

  it("une saisie partielle s'enregistre et laisse l'avis « À traiter »", async () => {
    const resultat = await modifierAvis(a.client, id, { numero: "12 3456 7890", lieu: "A6" });
    expect(resultat).toMatchObject({ ok: true, avis: { numero: "1234567890", lieu: "A6", statut: "a_traiter" } });
  });

  it("les 7 champs remplis passent l'avis « À valider » et le rattachent au véhicule ; un champ vidé le repasse « À traiter »", async () => {
    const complet = await modifierAvis(a.client, id, COMPLET);
    expect(complet).toMatchObject({
      ok: true,
      avis: {
        statut: "a_valider",
        plaque: "AV-101-AA",
        vehicule_id: vehiculeId,
        vehicule: { id: vehiculeId, plaque: "AV-101-AA" },
        infraction_le: expect.stringMatching(/^2026-10-03T06:30:00/),
        montant_centimes: 13500,
        date_envoi: "2026-10-06",
        echeance: "2026-11-20",
      },
    });

    const incomplet = await modifierAvis(a.client, id, { ...COMPLET, montant: "" });
    expect(incomplet).toMatchObject({ ok: true, avis: { statut: "a_traiter", montant_centimes: null } });
  });

  it("le rattachement suit la plaque, véhicules archivés compris ; une plaque inconnue n'en rattache aucun", async () => {
    await archiverVehicule(a.client, vehiculeId);
    expect(await modifierAvis(a.client, id, COMPLET)).toMatchObject({ ok: true, avis: { vehicule_id: vehiculeId } });

    expect(await modifierAvis(a.client, id, { ...COMPLET, plaque: "ZZ-999-ZZ" })).toMatchObject({
      ok: true,
      avis: { vehicule_id: null, vehicule: null, statut: "a_valider" },
    });
  });

  it("une saisie fautive est refusée avec les messages des écrans, et rien n'est modifié", async () => {
    const avant = await avisEnBase(id);
    expect(
      await modifierAvis(a.client, id, {
        ...COMPLET,
        numero: "123",
        montant: "-5",
        infraction_date: "07/10/2026",
        date_envoi: "06/10/2026",
      }),
    ).toEqual({
      ok: false,
      erreurs: {
        numero: MESSAGES_AVIS.numeroMalForme,
        montant: MESSAGES_AVIS.montantMalForme,
        date_envoi: MESSAGES_AVIS.infractionApresEnvoi,
      },
    });
    expect(await avisEnBase(id)).toEqual(avant);
  });

  it("un id qui n'est pas un uuid donne « avis introuvable »", async () => {
    expect(await modifierAvis(a.client, "pas-un-uuid", COMPLET)).toEqual({
      ok: false,
      erreurs: { general: MESSAGES_AVIS.avisIntrouvable },
    });
  });
});

describe("avis : n° unique et doublons", () => {
  // Chaque lancement crée des entreprises neuves : ces n° n'y sont pris que par ce bloc.
  const NUMERO = "5550000001";
  let existant: { id: string; chemin: string };

  const fichierPresent = async (cheminFichier: string) =>
    (await admin.storage.from(BUCKET_AVIS).download(cheminFichier)).data !== null;

  beforeAll(async () => {
    existant = await deposerAvis(a);
    const identifie = await modifierAvis(a.client, existant.id, { ...COMPLET, numero: NUMERO });
    if (!identifie.ok) throw new Error("avis existant");
  });

  it("un même n° est refusé en base dans l'entreprise, accepté dans une autre ; les dépôts sans n° coexistent", async () => {
    const autre = await deposerAvis(a);
    const direct = await a.client.from("avis").update({ numero: NUMERO }).eq("id", autre.id);
    expect(direct.error?.code).toBe("23505");

    const chezB = await deposerAvis(b);
    expect(await modifierAvis(b.client, chezB.id, { numero: NUMERO })).toMatchObject({
      ok: true,
      avis: { numero: NUMERO },
    });

    const sansNumero = await deposerAvis(a);
    expect((await avisEnBase(autre.id))?.numero).toBeNull();
    expect((await avisEnBase(sansNumero.id))?.numero).toBeNull();
  });

  it("saisir le n° d'un avis existant sur un dépôt pas encore identifié l'abandonne, fichier compris", async () => {
    const depot = await deposerAvis(a);
    await modifierAvis(a.client, depot.id, { lieu: "A6" });
    const avant = await avisEnBase(existant.id);

    expect(await modifierAvis(a.client, depot.id, { ...COMPLET, numero: "55 5000 0001" })).toEqual({
      ok: false,
      erreurs: { numero: MESSAGES_AVIS.avisExistant },
      avisExistantId: existant.id,
      depotAbandonne: true,
    });
    expect(await avisEnBase(depot.id)).toBeNull();
    expect(await fichierPresent(depot.chemin)).toBe(false);
    expect(await avisEnBase(existant.id)).toEqual(avant);
    expect(await fichierPresent(existant.chemin)).toBe(true);
  });

  it("un avis déjà identifié, corrigé vers le n° d'un autre, est refusé et garde son n°", async () => {
    const identifie = await deposerAvis(a);
    await modifierAvis(a.client, identifie.id, { numero: "5550000002" });

    expect(await modifierAvis(a.client, identifie.id, { ...COMPLET, numero: NUMERO })).toEqual({
      ok: false,
      erreurs: { numero: MESSAGES_AVIS.avisExistant },
      avisExistantId: existant.id,
    });
    expect(await avisEnBase(identifie.id)).toMatchObject({ numero: "5550000002", lieu: null });
    expect(await fichierPresent(identifie.chemin)).toBe(true);
  });

  it("appelée en direct, la fonction ne supprime ni sans doublon, ni un avis identifié ou classé, ni le dépôt d'une autre entreprise", async () => {
    const depot = await deposerAvis(a);
    const classe = await deposerAvis(a);
    await a.client.from("avis").update({ statut: "classe" }).eq("id", classe.id);
    const abandonner = (g: Gestionnaire, id: string, numero: string) =>
      g.client.rpc("abandonner_depot_en_double", { p_avis: id, p_numero: numero });

    expect(await abandonner(a, depot.id, "5550000099")).toMatchObject({ data: null, error: null });
    expect(await abandonner(a, existant.id, NUMERO)).toMatchObject({ data: null, error: null });
    expect(await abandonner(a, classe.id, NUMERO)).toMatchObject({ data: null, error: null });
    // B porte aussi ce n° (premier test du bloc), mais le dépôt est celui de A.
    expect(await abandonner(b, depot.id, NUMERO)).toMatchObject({ data: null, error: null });
    const anonyme = await nouveauClient().rpc("abandonner_depot_en_double", { p_avis: depot.id, p_numero: NUMERO });
    expect(anonyme.error).not.toBeNull();

    for (const { id, chemin: cheminFichier } of [depot, classe, existant]) {
      expect(await avisEnBase(id)).not.toBeNull();
      expect(await fichierPresent(cheminFichier)).toBe(true);
    }
  });

  it("un fichier qu'aucun avis ne vise se supprime, seulement dans le dossier de son entreprise", async () => {
    const orphelin = await envoyerFichierAvis(a);
    await b.client.storage.from(BUCKET_AVIS).remove([orphelin]);
    expect(await fichierPresent(orphelin)).toBe(true);

    await a.client.storage.from(BUCKET_AVIS).remove([orphelin]);
    expect(await fichierPresent(orphelin)).toBe(false);
  });
});
