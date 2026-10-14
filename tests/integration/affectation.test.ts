import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cloturerAffectation, creerAffectation, lireAffectations, modifierAffectation } from "@/lib/flotte/affectations";
import {
  archiverConducteur,
  creerConducteur,
  reactiverConducteur,
  supprimerConducteur,
} from "@/lib/flotte/conducteurs";
import { MESSAGES, type SaisieAffectation } from "@/lib/flotte/regles";
import { archiverVehicule, creerVehicule, modifierVehicule, supprimerVehicule } from "@/lib/flotte/vehicules";
import { admin, premiereConnexion, suffixeUnique, type Gestionnaire } from "./outils";

const suffixe = suffixeUnique();
let a: Gestionnaire;
let b: Gestionnaire;

beforeAll(async () => {
  a = await premiereConnexion(`affectation-a-${suffixe}@exemple.fr`);
  b = await premiereConnexion(`affectation-b-${suffixe}@exemple.fr`);
});

afterAll(async () => {
  for (const g of [a, b]) if (g) await admin.auth.admin.deleteUser(g.userId);
});

async function vehicule(g: Gestionnaire, plaque: string, type: "attitre" | "pool" = "attitre") {
  const cree = await creerVehicule(g.client, { plaque, type });
  if (!cree.ok) throw new Error(`véhicule ${plaque} : ${JSON.stringify(cree.erreurs)}`);
  return cree.vehicule.id;
}

async function conducteur(g: Gestionnaire, prenom: string, nom: string) {
  const cree = await creerConducteur(g.client, { prenom, nom });
  if (!cree.ok) throw new Error(`conducteur ${prenom} : ${JSON.stringify(cree.erreurs)}`);
  return cree.conducteur.id;
}

/** Début et fin en « JJ/MM/AAAA HH:MM », à l'heure de Paris. */
function saisie(vehicule_id: string, conducteur_id: string, debut: string, fin?: string): SaisieAffectation {
  const [debut_date, debut_heure] = debut.split(" ");
  const [fin_date, fin_heure] = fin?.split(" ") ?? [];
  return { vehicule_id, conducteur_id, debut_date, debut_heure, fin_date, fin_heure };
}

async function affecter(g: Gestionnaire, ...args: Parameters<typeof saisie>) {
  const creee = await creerAffectation(g.client, saisie(...args));
  if (!creee.ok) throw new Error(`affectation : ${JSON.stringify(creee.erreurs)}`);
  return creee.affectation;
}

describe("affectation : isolation par entreprise (RLS)", () => {
  let vehiculeA: string;
  let conducteurA: string;
  let affectationA: string;

  beforeAll(async () => {
    vehiculeA = await vehicule(a, "RL-101-SA");
    conducteurA = await conducteur(a, "Karim", "Benali");
    affectationA = (await affecter(a, vehiculeA, conducteurA, "02/02/2026 08:00", "02/02/2026 18:00")).id;
  });

  it("l'affectation est rattachée d'office à l'entreprise du gestionnaire, à l'instant voulu", async () => {
    const { data } = await admin.from("affectation").select("entreprise_id, debut, fin").eq("id", affectationA).single();
    expect(data?.entreprise_id).toBe(a.entrepriseId);
    expect(new Date(data!.debut).toISOString()).toBe("2026-02-02T07:00:00.000Z");
    expect(new Date(data!.fin).toISOString()).toBe("2026-02-02T17:00:00.000Z");
  });

  it("un gestionnaire ne voit ni ne modifie les affectations d'une autre entreprise", async () => {
    expect((await b.client.from("affectation").select("id").eq("id", affectationA)).data).toEqual([]);

    const { data } = await b.client.from("affectation").update({ fin: null }).eq("id", affectationA).select();
    expect(data ?? []).toEqual([]);
    expect(
      await modifierAffectation(b.client, affectationA, saisie(vehiculeA, conducteurA, "02/02/2026 09:00")),
    ).toEqual({ ok: false, erreurs: { general: MESSAGES.affectationIntrouvable } });
    expect(await cloturerAffectation(b.client, affectationA, { fin_date: "03/02/2026", fin_heure: "08:00" })).toEqual({
      ok: false,
      erreurs: { general: MESSAGES.affectationIntrouvable },
    });
  });

  it("le véhicule ou le conducteur d'une autre entreprise ne peut pas être visé, même en direct", async () => {
    const vehiculeB = await vehicule(b, "RL-202-SB");
    const conducteurB = await conducteur(b, "Léa", "Martin");

    // La clé étrangère composite refuse, alors que sa vérification ignore la RLS.
    for (const lignes of [
      { vehicule_id: vehiculeB, conducteur_id: conducteurA },
      { vehicule_id: vehiculeA, conducteur_id: conducteurB },
    ]) {
      const { error } = await a.client.from("affectation").insert({ ...lignes, debut: "2026-05-01T08:00:00Z" });
      expect(error?.code).toBe("23503");
    }

    expect(await creerAffectation(a.client, saisie(vehiculeB, conducteurA, "01/05/2026 08:00"))).toEqual({
      ok: false,
      erreurs: { vehicule_id: MESSAGES.vehiculeIntrouvable },
    });
    expect(await creerAffectation(a.client, saisie(vehiculeA, conducteurB, "01/05/2026 08:00"))).toEqual({
      ok: false,
      erreurs: { conducteur_id: MESSAGES.conducteurIntrouvable },
    });
  });

  it("entreprise_id ne peut être ni imposé, ni modifié ; une affectation ne se supprime pas", async () => {
    const creation = await a.client.from("affectation").insert({
      vehicule_id: vehiculeA,
      conducteur_id: conducteurA,
      debut: "2026-06-01T08:00:00Z",
      entreprise_id: b.entrepriseId,
    });
    expect(creation.error).not.toBeNull();

    const changement = await a.client.from("affectation").update({ entreprise_id: b.entrepriseId }).eq("id", affectationA);
    expect(changement.error).not.toBeNull();

    await a.client.from("affectation").delete().eq("id", affectationA);
    const { data } = await admin.from("affectation").select("entreprise_id").eq("id", affectationA).single();
    expect(data?.entreprise_id).toBe(a.entrepriseId);
  });
});

describe("affectation : chevauchement", () => {
  let camion: string;
  let karim: string;
  let lea: string;

  beforeAll(async () => {
    camion = await vehicule(a, "CH-303-VA");
    karim = await conducteur(a, "Karim", "Bouzid");
    lea = await conducteur(a, "Léa", "Durand");
    await affecter(a, camion, karim, "03/03/2026 08:00", "03/03/2026 18:00");
  });

  it("la base refuse un chevauchement inséré en direct, et accepte deux affectations bout à bout", async () => {
    const chevauche = await a.client
      .from("affectation")
      .insert({ vehicule_id: camion, conducteur_id: lea, debut: "2026-03-03T16:00:00Z" });
    expect(chevauche.error?.code).toBe("23P01");

    const boutABout = await a.client.from("affectation").insert({
      vehicule_id: camion,
      conducteur_id: lea,
      debut: "2026-03-03T17:00:00Z",
      fin: "2026-03-04T17:00:00Z",
    });
    expect(boutABout.error).toBeNull();
  });

  it("le refus nomme le conducteur, le véhicule et le créneau en conflit", async () => {
    expect(await creerAffectation(a.client, saisie(camion, lea, "03/03/2026 12:00", "03/03/2026 20:00"))).toEqual({
      ok: false,
      erreurs: { general: "Conflit avec : Karim B. sur CH-303-VA du 03/03 08:00 au 03/03 18:00." },
    });
  });

  it("une affectation ouverte bloque toute affectation ultérieure du véhicule", async () => {
    await affecter(a, camion, karim, "01/04/2026");
    expect(await creerAffectation(a.client, saisie(camion, lea, "01/09/2026 08:00", "01/09/2026 18:00"))).toEqual({
      ok: false,
      erreurs: { general: "Conflit avec : Karim B. sur CH-303-VA à partir du 01/04 00:00." },
    });
  });

  it("un même conducteur peut conduire deux véhicules en même temps", async () => {
    const utilitaire = await vehicule(a, "TA-404-VB", "pool");
    const creee = await creerAffectation(a.client, saisie(utilitaire, karim, "03/03/2026 09:00", "03/03/2026 11:00"));
    expect(creee.ok).toBe(true);
  });

  it("modifier une affectation ne se heurte pas à elle-même, mais bien aux autres", async () => {
    const ete = await affecter(a, camion, lea, "01/07/2025 08:00", "01/07/2025 18:00");
    expect(
      await modifierAffectation(a.client, ete.id, saisie(camion, lea, "01/07/2025 07:00", "01/07/2025 19:00")),
    ).toMatchObject({ ok: true, affectation: { id: ete.id } });

    expect(
      await modifierAffectation(a.client, ete.id, saisie(camion, lea, "03/03/2026 07:00", "03/03/2026 09:00")),
    ).toEqual({
      ok: false,
      erreurs: { general: "Conflit avec : Karim B. sur CH-303-VA du 03/03 08:00 au 03/03 18:00." },
    });
  });

  it("lireAffectations ne garde que celles qui touchent la période, affectation ouverte comprise", async () => {
    const { data, error } = await lireAffectations(
      a.client,
      { vehicule_id: camion },
      { debut: "2026-03-31T22:00:00Z", fin: "2026-12-31T23:00:00Z" },
    );
    expect(error).toBeNull();
    expect(data?.map(({ conducteur, fin }) => [conducteur.prenom, fin])).toEqual([["Karim", null]]);
    expect(data?.[0].vehicule.plaque).toBe("CH-303-VA");
  });
});

describe("affectation : règles des écrans", () => {
  it("un véhicule de pool exige une fin", async () => {
    const pool = await vehicule(a, "PA-505-LE", "pool");
    const paul = await conducteur(a, "Paul", "Petit");
    expect(await creerAffectation(a.client, saisie(pool, paul, "05/05/2026 08:00"))).toEqual({
      ok: false,
      erreurs: { fin_date: MESSAGES.finPoolObligatoire },
    });
  });

  it("un véhicule ou un conducteur archivé ne s'affecte pas", async () => {
    const vieux = await vehicule(a, "AR-606-CH");
    const actif = await vehicule(a, "AC-616-TF");
    const nina = await conducteur(a, "Nina", "Roux");
    const ancien = await conducteur(a, "Hugo", "Blanc");
    await archiverVehicule(a.client, vieux);
    await archiverConducteur(a.client, ancien);

    expect(await creerAffectation(a.client, saisie(vieux, nina, "06/06/2026"))).toEqual({
      ok: false,
      erreurs: { vehicule_id: MESSAGES.vehiculeArchiveAffectation("AR-606-CH") },
    });
    expect(await creerAffectation(a.client, saisie(actif, ancien, "06/06/2026"))).toEqual({
      ok: false,
      erreurs: { conducteur_id: MESSAGES.conducteurArchiveAffectation("Hugo Blanc") },
    });
  });

  it("une affectation se clôture une fois, après son début", async () => {
    const fourgon = await vehicule(a, "CL-707-TE");
    const ines = await conducteur(a, "Inès", "Garnier");
    const ouverte = await affecter(a, fourgon, ines, "07/07/2026 08:00");

    expect(await cloturerAffectation(a.client, ouverte.id, { fin_date: "07/07/2026", fin_heure: "07:00" })).toEqual({
      ok: false,
      erreurs: { fin_date: MESSAGES.finAvantDebut },
    });
    expect(await cloturerAffectation(a.client, ouverte.id, {})).toEqual({
      ok: false,
      erreurs: { fin_date: MESSAGES.finVide },
    });

    const cloturee = await cloturerAffectation(a.client, ouverte.id, { fin_date: "10/07/2026", fin_heure: "18h" });
    expect(cloturee.ok && new Date(cloturee.affectation.fin!).toISOString()).toBe("2026-07-10T16:00:00.000Z");
    expect(await cloturerAffectation(a.client, ouverte.id, { fin_date: "11/07/2026", fin_heure: "18:00" })).toEqual({
      ok: false,
      erreurs: { general: MESSAGES.affectationDejaCloturee },
    });
  });

  it("l'archivage attend la clôture de l'affectation ouverte, même si sa fin est à venir", async () => {
    const benne = await vehicule(a, "BE-808-NE");
    const remi = await conducteur(a, "Rémi", "Faure");
    const ouverte = await affecter(a, benne, remi, "08/08/2025 08:00");

    const enCours = MESSAGES.affectationEnCours("Rémi F.", "BE-808-NE");
    expect(await archiverConducteur(a.client, remi)).toEqual({ ok: false, erreurs: { general: enCours } });
    expect(await archiverVehicule(a.client, benne)).toEqual({ ok: false, erreurs: { general: enCours } });

    // « Karim part vendredi » : la fin est fixée dans le futur, l'archivage passe.
    const vendredi = new Date(Date.now() + 4 * 24 * 3600 * 1000);
    const fin_date = vendredi.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" });
    expect((await cloturerAffectation(a.client, ouverte.id, { fin_date, fin_heure: "18:00" })).ok).toBe(true);
    expect(await archiverConducteur(a.client, remi)).toMatchObject({ ok: true });
    expect(await archiverVehicule(a.client, benne)).toMatchObject({ ok: true });

    // Archivés, l'affectation reste lisible mais ne se modifie plus.
    expect(await modifierAffectation(a.client, ouverte.id, saisie(benne, remi, "08/08/2025 09:00"))).toEqual({
      ok: false,
      erreurs: { general: MESSAGES.affectationArchivee },
    });
    await reactiverConducteur(a.client, remi);
  });

  it("un véhicule avec une affectation ouverte ne passe pas en pool", async () => {
    const navette = await vehicule(a, "NA-909-VE");
    const zoe = await conducteur(a, "Zoé", "Lemaire");
    await affecter(a, navette, zoe, "09/09/2025");
    expect(await modifierVehicule(a.client, navette, { plaque: "NA-909-VE", type: "pool" })).toEqual({
      ok: false,
      erreurs: { type: MESSAGES.poolAvecAffectationOuverte("Zoé L.") },
    });
    expect(await modifierVehicule(a.client, navette, { plaque: "NA-909-VE", type: "attitre", modele: "Trafic" })).toMatchObject(
      { ok: true },
    );
  });
});

describe("suppression d'un véhicule ou d'un conducteur", () => {
  it("refusée avec un historique, acceptée sans", async () => {
    const histoire = await vehicule(a, "HE-111-ST");
    const marc = await conducteur(a, "Marc", "Henry");
    await affecter(a, histoire, marc, "11/01/2026 08:00", "11/01/2026 18:00");

    expect(await supprimerVehicule(a.client, histoire)).toEqual({
      ok: false,
      erreurs: { general: MESSAGES.vehiculeAvecHistorique },
    });
    expect(await supprimerConducteur(a.client, marc)).toEqual({
      ok: false,
      erreurs: { general: MESSAGES.conducteurAvecHistorique },
    });

    const neuf = await vehicule(a, "NE-222-AF");
    const sam = await conducteur(a, "Sam", "Neuf");
    expect(await supprimerVehicule(a.client, neuf)).toMatchObject({ ok: true, vehicule: { plaque: "NE-222-AF" } });
    expect(await supprimerConducteur(a.client, sam)).toMatchObject({ ok: true, conducteur: { prenom: "Sam" } });
    expect((await admin.from("vehicule").select("id").eq("id", neuf)).data).toEqual([]);
    expect((await admin.from("conducteur").select("id").eq("id", sam)).data).toEqual([]);
  });

  it("un gestionnaire ne supprime pas le véhicule ou le conducteur d'une autre entreprise", async () => {
    const vehiculeB = await vehicule(b, "SB-333-VB");
    const conducteurB = await conducteur(b, "Yann", "Morel");
    expect(await supprimerVehicule(a.client, vehiculeB)).toEqual({
      ok: false,
      erreurs: { general: MESSAGES.vehiculeIntrouvable },
    });
    expect(await supprimerConducteur(a.client, conducteurB)).toEqual({
      ok: false,
      erreurs: { general: MESSAGES.conducteurIntrouvable },
    });
    expect((await admin.from("vehicule").select("id").eq("id", vehiculeB)).data).toHaveLength(1);
  });

  it("la suppression du compte efface aussi ses affectations", async () => {
    const c = await premiereConnexion(`affectation-c-${suffixe}@exemple.fr`);
    await affecter(c, await vehicule(c, "CA-444-PT"), await conducteur(c, "Eva", "Klein"), "01/01/2026");

    expect((await admin.auth.admin.deleteUser(c.userId)).error).toBeNull();
    const { data } = await admin.from("affectation").select("id").eq("entreprise_id", c.entrepriseId);
    expect(data).toEqual([]);
  });
});
