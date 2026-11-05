import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LIMITES_FREE } from "@/lib/abonnement/plans";
import { choixVehiculesRequis, deverrouillerAvis, lireUsage } from "@/lib/abonnement/quotas";
import { classerAvis, marquerDesigne, modifierAvis, rouvrirAvis, validerConducteur } from "@/lib/avis/avis";
import { MESSAGES_AVIS, type SaisieAvis } from "@/lib/avis/regles";
import { cloturerAffectation, creerAffectation, modifierAffectation } from "@/lib/flotte/affectations";
import { creerConducteur } from "@/lib/flotte/conducteurs";
import { MESSAGES } from "@/lib/flotte/regles";
import {
  archiverVehicule,
  creerVehicule,
  modifierVehicule,
  rattacherAvis,
  reactiverVehicule,
  rendreActifs,
} from "@/lib/flotte/vehicules";
import {
  admin,
  avisEnBase,
  deposerAvis,
  passerEnPro,
  premiereConnexion,
  suffixeUnique,
  supprimerGestionnaire,
  type Gestionnaire,
} from "./outils";

// Retour en Free (phase 19) : au-delà de 3 véhicules actifs, la base les passe tous en lecture seule ; l'écran de choix
// en rend 3 actifs. Un avis déposé depuis sur un véhicule en lecture seule est bloqué, jusqu'à ce que le véhicule
// redevienne actif. Le passage de Pro à Free est celui du webhook, écrit ici avec la clé secrète.

const suffixe = suffixeUnique();
const gestionnaires: Gestionnaire[] = [];

async function compte(nom: string) {
  const g = await premiereConnexion(`retour-free-${nom}-${suffixe}@exemple.fr`);
  gestionnaires.push(g);
  await passerEnPro(g.entrepriseId);
  return g;
}

afterAll(async () => {
  for (const g of gestionnaires) await supprimerGestionnaire(g);
});

/** Comme le webhook, à l'annulation ou après l'impayé : le trigger du retour en Free passe la flotte en lecture seule. */
async function repasserEnFree(g: Gestionnaire) {
  const { error } = await admin.from("entreprise").update({ plan: "free" }).eq("id", g.entrepriseId);
  if (error) throw error;
}

/** « RF-101-AA », « RF-102-AA »… : une plaque par véhicule d'un même compte. */
const plaque = (prefixe: string, n: number) => `${prefixe}-${100 + n}-AA`;

async function vehicule(g: Gestionnaire, plaqueVehicule: string) {
  const cree = await creerVehicule(g.client, { plaque: plaqueVehicule, type: "attitre" });
  if (!cree.ok) throw new Error(`véhicule ${plaqueVehicule} : ${JSON.stringify(cree.erreurs)}`);
  return cree.vehicule.id;
}

async function flotte(g: Gestionnaire, prefixe: string, nombre: number) {
  const ids: string[] = [];
  for (let n = 1; n <= nombre; n++) ids.push(await vehicule(g, plaque(prefixe, n)));
  return ids;
}

async function conducteur(g: Gestionnaire, prenom: string) {
  const cree = await creerConducteur(g.client, { prenom, nom: "Benali" });
  if (!cree.ok) throw new Error(`conducteur ${prenom} : ${JSON.stringify(cree.erreurs)}`);
  return cree.conducteur.id;
}

async function lectureSeule(id: string) {
  const { data, error } = await admin.from("vehicule").select("lecture_seule_le").eq("id", id).single();
  if (error) throw error;
  return data.lecture_seule_le as string | null;
}

let numero = 0;
/** Un avis complet : il passe « À valider », rattaché au véhicule qui porte sa plaque. */
function complet(plaqueAvis: string): SaisieAvis {
  numero += 1;
  return {
    numero: String(8_800_000_000 + numero),
    plaque: plaqueAvis,
    infraction_date: "03/10/2026",
    infraction_heure: "08:30",
    lieu: "A6, Auxerre",
    infraction: "Excès de vitesse inférieur à 20 km/h",
    montant: "135",
    date_envoi: "06/10/2026",
  };
}

/** Déposé puis saisi comme à l'écran : le rattachement passe par le trigger qui bloque l'avis. */
async function avisAValider(g: Gestionnaire, plaqueAvis: string) {
  const { id } = await deposerAvis(g);
  const modifie = await modifierAvis(g.client, id, complet(plaqueAvis));
  if (!modifie.ok) throw new Error(`avis : ${JSON.stringify(modifie.erreurs)}`);
  return id;
}

/** Sème des avis hors RLS, d'un seul insert, avec leurs valeurs par défaut (`defaultToNull: false`). */
async function semer(g: Gestionnaire, avis: Record<string, unknown>[]) {
  const { data, error } = await admin
    .from("avis")
    .insert(
      avis.map((champs) => ({
        entreprise_id: g.entrepriseId,
        fichier: `${g.entrepriseId}/${crypto.randomUUID()}.png`,
        fichier_type: "image/png",
        ...champs,
      })),
      { defaultToNull: false },
    )
    .select("id");
  if (error) throw error;
  return data.map(({ id }) => id as string);
}

describe("retour en Free : la flotte passe en lecture seule", () => {
  it(`au-delà de ${LIMITES_FREE.vehicules} véhicules actifs, tous passent en lecture seule ; un archivé ne bouge pas`, async () => {
    const g = await compte("au-dela");
    const ids = await flotte(g, "RA", LIMITES_FREE.vehicules + 2);
    const archive = ids.pop()!;
    expect((await archiverVehicule(g.client, archive)).ok).toBe(true);

    await repasserEnFree(g);
    for (const id of ids) expect(await lectureSeule(id)).not.toBeNull();
    expect(await lectureSeule(archive)).toBeNull();

    const usage = await lireUsage(g.client);
    expect(usage).toMatchObject({ vehicules: 0, enLectureSeule: LIMITES_FREE.vehicules + 1 });
    expect(choixVehiculesRequis({ plan: "free", ...usage })).toBe(true);
  });

  it(`à ${LIMITES_FREE.vehicules} véhicules actifs ou moins, rien ne change`, async () => {
    const g = await compte("en-deca");
    const ids = await flotte(g, "RB", LIMITES_FREE.vehicules);
    await repasserEnFree(g);
    for (const id of ids) expect(await lectureSeule(id)).toBeNull();
    expect(await lireUsage(g.client)).toMatchObject({ vehicules: LIMITES_FREE.vehicules, enLectureSeule: 0 });
  });

  it("seule la base écrit la lecture seule", async () => {
    const g = await compte("droits");
    const [id] = await flotte(g, "RC", 1);
    const vehiculeDirect = await g.client.from("vehicule").update({ lecture_seule_le: null }).eq("id", id);
    expect(vehiculeDirect.error?.code).toBe("42501");
    const { id: avis } = await deposerAvis(g);
    const avisDirect = await g.client.from("avis").update({ vehicule_lecture_seule: false }).eq("id", avis);
    expect(avisDirect.error?.code).toBe("42501");
  });
});

describe("retour en Free : le choix des véhicules actifs", () => {
  let g: Gestionnaire;
  let ids: string[];

  beforeAll(async () => {
    g = await compte("choix");
    ids = await flotte(g, "RD", LIMITES_FREE.vehicules + 2);
    await repasserEnFree(g);
  });

  it(`en garder ${LIMITES_FREE.vehicules + 1} est refusé, avec une invitation à passer en Pro, et rien ne change`, async () => {
    expect(await rendreActifs(g.client, ids.slice(0, LIMITES_FREE.vehicules + 1))).toEqual({
      ok: false,
      erreur: MESSAGES.limiteVehiculesActivation,
      invitationPro: true,
    });
    expect((await lireUsage(g.client)).vehicules).toBe(0);
  });

  it(`en garder ${LIMITES_FREE.vehicules} les rend actifs ; les autres restent en lecture seule`, async () => {
    expect(await rendreActifs(g.client, ids.slice(0, LIMITES_FREE.vehicules))).toEqual({
      ok: true,
      rendus: LIMITES_FREE.vehicules,
    });
    const usage = await lireUsage(g.client);
    expect(usage).toMatchObject({ vehicules: LIMITES_FREE.vehicules, enLectureSeule: 2 });
    expect(choixVehiculesRequis({ plan: "free", ...usage })).toBe(false);
  });

  it("à la limite, un véhicule de plus est refusé ; un véhicule déjà actif ne compte pas", async () => {
    expect(await rendreActifs(g.client, [ids.at(-1)!])).toMatchObject({ ok: false, invitationPro: true });
    expect(await rendreActifs(g.client, [ids[0]])).toEqual({ ok: true, rendus: 0 });
    expect(await rendreActifs(g.client, ["pas-un-id"])).toEqual({ ok: true, rendus: 0 });
  });

  it("le véhicule d'une autre entreprise est ignoré", async () => {
    const h = await compte("choix-autre");
    expect(await rendreActifs(h.client, [ids.at(-1)!])).toEqual({ ok: true, rendus: 0 });
    expect(await lectureSeule(ids.at(-1)!)).not.toBeNull();
  });

  it("un véhicule en lecture seule ne se modifie plus et ne reçoit plus d'affectation ; la sienne se clôture", async () => {
    const enLectureSeule = ids.at(-1)!;
    expect(await modifierVehicule(g.client, enLectureSeule, { plaque: plaque("RD", 5), type: "pool" })).toMatchObject({
      ok: false,
    });
    expect(
      await modifierVehicule(g.client, enLectureSeule, { plaque: plaque("RD", 5), modele: "Kangoo", type: "attitre" }),
    ).toEqual({ ok: false, erreurs: { general: MESSAGES.vehiculeLectureSeule } });

    const karim = await conducteur(g, "Karim");
    expect(
      await creerAffectation(g.client, { vehicule_id: enLectureSeule, conducteur_id: karim, debut_date: "01/10/2026" }),
    ).toEqual({ ok: false, erreurs: { vehicule_id: MESSAGES.affectationLectureSeule(plaque("RD", 5)) } });

    // Une affectation ouverte d'avant le retour en Free : semée hors RLS, elle ne se modifie plus, mais se clôture.
    const { data, error } = await admin
      .from("affectation")
      .insert({
        entreprise_id: g.entrepriseId,
        vehicule_id: enLectureSeule,
        conducteur_id: karim,
        debut: "2026-09-01T06:00:00Z",
      })
      .select("id")
      .single();
    if (error) throw error;
    expect(
      await modifierAffectation(g.client, data.id, {
        vehicule_id: enLectureSeule,
        conducteur_id: karim,
        debut_date: "02/09/2026",
      }),
    ).toEqual({ ok: false, erreurs: { general: MESSAGES.affectationLectureSeule(plaque("RD", 5)) } });
    expect(await cloturerAffectation(g.client, data.id, { fin_date: "20/10/2026", fin_heure: "18:00" })).toMatchObject({
      ok: true,
    });
  });
});

describe("retour en Free : les avis d'un véhicule en lecture seule", () => {
  let g: Gestionnaire;
  let ids: string[];
  let karim: string;
  /** Rattaché avant le retour en Free : il reste traitable. */
  let avant: string;
  /** Rattaché depuis : il est bloqué. */
  let apres: string;
  const PLAQUE = plaque("RE", 1);

  beforeAll(async () => {
    g = await compte("avis");
    ids = await flotte(g, "RE", LIMITES_FREE.vehicules + 1);
    karim = await conducteur(g, "Karim");
    avant = await avisAValider(g, PLAQUE);
    await repasserEnFree(g);
    apres = await avisAValider(g, PLAQUE);
  });

  it("l'avis déposé depuis est bloqué au rattachement ; celui d'avant reste traitable", async () => {
    expect(await avisEnBase(apres)).toMatchObject({ vehicule_id: ids[0], statut: "a_valider", vehicule_lecture_seule: true });
    expect(await avisEnBase(avant)).toMatchObject({ vehicule_id: ids[0], vehicule_lecture_seule: false });
    expect((await validerConducteur(g.client, avant, karim)).ok).toBe(true);
  });

  it("son conducteur ne se valide pas, et il ne se désigne pas, même par l'API", async () => {
    expect(await validerConducteur(g.client, apres, karim)).toEqual({
      ok: false,
      erreurs: { general: MESSAGES_AVIS.vehiculeLectureSeule },
    });
    expect(await marquerDesigne(g.client, apres)).toEqual({ ok: false, erreurs: { general: MESSAGES_AVIS.vehiculeLectureSeule } });

    const validation = await g.client.from("avis").update({ conducteur_id: karim }).eq("id", apres);
    expect(validation.error?.code).toBe("23514");
    const designation = await g.client
      .from("avis")
      .update({ statut: "designe", designe_le: new Date().toISOString(), conducteur_id: karim })
      .eq("id", apres);
    expect(designation.error?.code).toBe("23514");
    // Repasser « À valider » avec un conducteur l'efface : l'avis reste bloqué.
    await g.client.from("avis").update({ statut: "a_valider", conducteur_id: karim }).eq("id", apres);
    expect(await avisEnBase(apres)).toMatchObject({ conducteur_id: null, vehicule_lecture_seule: true });
  });

  it("classé, il n'est plus bloqué ; rouvert, il l'est de nouveau", async () => {
    expect((await classerAvis(g.client, apres, { motif: "conteste" })).ok).toBe(true);
    expect(await avisEnBase(apres)).toMatchObject({ statut: "classe", vehicule_lecture_seule: false });
    expect((await rouvrirAvis(g.client, apres)).ok).toBe(true);
    expect(await avisEnBase(apres)).toMatchObject({ statut: "a_valider", vehicule_lecture_seule: true });
  });

  it("le rattachement d'un avis sans véhicule le bloque et efface son conducteur ; un avis désigné ou classé reste intact", async () => {
    const [ouvert, designe, classe] = await semer(g, [
      { plaque: PLAQUE, statut: "a_valider", conducteur_id: karim },
      { plaque: PLAQUE, statut: "designe", conducteur_id: karim, designe_le: "2026-10-20T08:00:00Z" },
      { plaque: PLAQUE, statut: "classe", classe_le: "2026-10-20T08:00:00Z", motif_classement: "conteste" },
    ]);
    expect(await rattacherAvis(g.client, { id: ids[0], plaque: PLAQUE })).toBeNull();
    expect(await avisEnBase(ouvert)).toMatchObject({ vehicule_id: ids[0], conducteur_id: null, vehicule_lecture_seule: true });
    expect(await avisEnBase(designe)).toMatchObject({
      vehicule_id: ids[0],
      statut: "designe",
      conducteur_id: karim,
      vehicule_lecture_seule: false,
    });
    expect(await avisEnBase(classe)).toMatchObject({ vehicule_id: ids[0], vehicule_lecture_seule: false });
  });

  it("rendre le véhicule actif débloque ses avis : le conducteur se valide", async () => {
    expect(await rendreActifs(g.client, [ids[0]])).toEqual({ ok: true, rendus: 1 });
    expect(await avisEnBase(apres)).toMatchObject({ vehicule_lecture_seule: false });
    expect((await validerConducteur(g.client, apres, karim)).ok).toBe(true);
  });

  it("archiver un véhicule en lecture seule garde ses avis bloqués ; le réactiver les débloque", async () => {
    const autre = await avisAValider(g, plaque("RE", 2));
    expect(await avisEnBase(autre)).toMatchObject({ vehicule_lecture_seule: true });
    expect((await archiverVehicule(g.client, ids[1])).ok).toBe(true);
    expect(await lectureSeule(ids[1])).not.toBeNull();
    expect(await avisEnBase(autre)).toMatchObject({ vehicule_lecture_seule: true });

    expect(await reactiverVehicule(g.client, ids[1])).toMatchObject({ ok: true, vehicule: { lecture_seule_le: null } });
    expect(await avisEnBase(autre)).toMatchObject({ vehicule_lecture_seule: false });
  });

  it("le retour en Pro rend tous les véhicules actifs et débloque tous les avis", async () => {
    const bloque = await avisAValider(g, plaque("RE", 3));
    expect(await avisEnBase(bloque)).toMatchObject({ vehicule_lecture_seule: true });
    await passerEnPro(g.entrepriseId);
    for (const id of ids) expect(await lectureSeule(id)).toBeNull();
    expect(await avisEnBase(bloque)).toMatchObject({ vehicule_lecture_seule: false });
  });
});

describe("retour en Free : le déverrouillage du mois", () => {
  it("ignore un avis verrouillé bloqué par son véhicule en lecture seule", async () => {
    const g = await compte("deverrouillage");
    const ids = await flotte(g, "RF", LIMITES_FREE.vehicules + 1);
    await repasserEnFree(g);
    // En lecture seule depuis janvier 2025 : les avis de mars 2025, semés hors des mois des autres tests, sont « déposés
    // depuis ».
    const { error } = await admin.from("vehicule").update({ lecture_seule_le: "2025-01-01T00:00:00Z" }).eq("id", ids[0]);
    if (error) throw error;

    const mars = await semer(g, [
      ...Array.from({ length: LIMITES_FREE.avisParMois }, () => ({ depose_le: "2025-03-03T08:00:00Z" })),
      { depose_le: "2025-03-10T08:00:00Z", vehicule_id: ids[0], plaque: plaque("RF", 1) },
      { depose_le: "2025-03-11T08:00:00Z" },
    ]);
    const [bloque, libre] = mars.slice(LIMITES_FREE.avisParMois);
    expect(await avisEnBase(bloque)).toMatchObject({ verrouille: true, vehicule_lecture_seule: true });
    expect(await avisEnBase(libre)).toMatchObject({ verrouille: true, vehicule_lecture_seule: false });

    await deverrouillerAvis({ supabase: admin, aujourdhui: "2025-04-01" });
    expect(await avisEnBase(bloque)).toMatchObject({ verrouille: true });
    expect(await avisEnBase(libre)).toMatchObject({ verrouille: false, mois_quota: "2025-04-01" });
  });
});
