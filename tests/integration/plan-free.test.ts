import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { LIMITES_FREE } from "@/lib/abonnement/plans";
import { debutHistorique, deverrouillerAvis, lireUsage, moisQuota } from "@/lib/abonnement/quotas";
import { compterAvisMasques, creerAvis, listerAvis, modifierAvis, validerConducteur } from "@/lib/avis/avis";
import { lireEtRemplirAvis, type Lecteur, type Lecture } from "@/lib/avis/lecture";
import { CHAMPS_AVIS, MESSAGES_AVIS, aLireApresDeverrouillage, type ChampAvis } from "@/lib/avis/regles";
import { ajouterMois, aujourdhuiParis } from "@/lib/dates";
import { creerConducteur } from "@/lib/flotte/conducteurs";
import { ECRITURES, importerFlotte, type FichierRecu } from "@/lib/flotte/import";
import { ERREUR_LIMITE_VEHICULES, MESSAGES } from "@/lib/flotte/regles";
import { MESSAGES_IMPORT, type LigneVehicule } from "@/lib/flotte/regles-import";
import { archiverVehicule, creerVehicule, reactiverVehicule } from "@/lib/flotte/vehicules";
import {
  admin,
  avisEnBase,
  envoyerFichierAvis,
  passerEnPro,
  premiereConnexion,
  suffixeUnique,
  supprimerGestionnaire,
  type Gestionnaire,
} from "./outils";

// Plan Free (phase 17) : les quotas vivent en base, dans des triggers. Les chiffres viennent de `LIMITES_FREE`, que les
// triggers reprennent. Le déverrouillage est simulé en 2025 : aucun mois ne croise les avis des autres tests.

const suffixe = suffixeUnique();
const gestionnaires: Gestionnaire[] = [];

async function compte(nom: string, { pro = false } = {}) {
  const g = await premiereConnexion(`plan-free-${nom}-${suffixe}@exemple.fr`);
  gestionnaires.push(g);
  if (pro) await passerEnPro(g.entrepriseId);
  return g;
}

afterAll(async () => {
  for (const g of gestionnaires) await supprimerGestionnaire(g);
});

/** « PF-101-AA », « PF-102-AA »… : une plaque par véhicule d'un même compte. */
const plaque = (prefixe: string, n: number) => `${prefixe}-${100 + n}-AA`;

async function vehicule(g: Gestionnaire, plaqueVehicule: string) {
  const cree = await creerVehicule(g.client, { plaque: plaqueVehicule, type: "attitre" });
  if (!cree.ok) throw new Error(`véhicule ${plaqueVehicule} : ${JSON.stringify(cree.erreurs)}`);
  return cree.vehicule.id;
}

/**
 * Sème des avis hors RLS, d'un seul insert : le trigger du dépôt les compte un par un, dans l'ordre. Une colonne absente
 * d'une ligne prend sa valeur par défaut (`defaultToNull: false`), pas NULL.
 */
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
    .select("id, verrouille, mois_quota");
  if (error) throw error;
  return data as { id: string; verrouille: boolean; mois_quota: string | null }[];
}

const LIMITE_ATTEINTE = {
  ok: false,
  erreurs: { general: MESSAGES.limiteVehicules },
  invitationPro: true,
} as const;

describe("plan Free : véhicules actifs", () => {
  let g: Gestionnaire;
  const ids: string[] = [];

  beforeAll(async () => {
    g = await compte("vehicules");
    for (let n = 1; n <= LIMITES_FREE.vehicules; n++) ids.push(await vehicule(g, plaque("VF", n)));
  });

  it(`le ${LIMITES_FREE.vehicules + 1}e véhicule actif est refusé, avec une invitation à passer en Pro, même par l'API`, async () => {
    expect(await creerVehicule(g.client, { plaque: plaque("VF", 9), type: "pool" })).toEqual(LIMITE_ATTEINTE);
    const direct = await g.client.from("vehicule").insert({ plaque: plaque("VF", 9), type: "pool" });
    expect(direct.error).toMatchObject({ code: "P0001", message: ERREUR_LIMITE_VEHICULES });
    expect(await lireUsage(g.client)).toEqual({ vehicules: LIMITES_FREE.vehicules, avisCeMois: 0 });
  });

  it("à la limite, une plaque déjà présente garde son message", async () => {
    expect(await creerVehicule(g.client, { plaque: plaque("VF", 1), type: "attitre" })).toEqual({
      ok: false,
      erreurs: { plaque: MESSAGES.plaqueDejaPresente(plaque("VF", 1)) },
    });
  });

  it("un véhicule archivé ne compte pas, et sa plaque mène à sa fiche", async () => {
    expect((await archiverVehicule(g.client, ids[2])).ok).toBe(true);
    ids.push(await vehicule(g, plaque("VF", 4)));
    expect(await creerVehicule(g.client, { plaque: plaque("VF", 3), type: "attitre" })).toEqual({
      ok: false,
      erreurs: { plaque: MESSAGES.plaqueArchivee(plaque("VF", 3)) },
      vehiculeArchiveId: ids[2],
    });
  });

  it("réactiver un véhicule archivé est refusé à la limite ; réactiver un véhicule actif ne change rien", async () => {
    expect(await reactiverVehicule(g.client, ids[2])).toEqual({
      ok: false,
      erreurs: { general: MESSAGES.limiteVehiculesReactivation },
      invitationPro: true,
    });
    const direct = await g.client.from("vehicule").update({ archive_le: null }).eq("id", ids[2]);
    expect(direct.error).toMatchObject({ code: "P0001", message: ERREUR_LIMITE_VEHICULES });

    const actif = await reactiverVehicule(g.client, ids[0]);
    expect(actif).toMatchObject({ ok: true, vehicule: { id: ids[0], archive_le: null } });
  });

  it("de deux ajouts simultanés sur la dernière place, un seul passe", async () => {
    const h = await compte("course");
    for (let n = 1; n < LIMITES_FREE.vehicules; n++) await vehicule(h, plaque("CR", n));
    const resultats = await Promise.all(
      [8, 9].map((n) => creerVehicule(h.client, { plaque: plaque("CR", n), type: "attitre" })),
    );
    expect(resultats.filter(({ ok }) => ok)).toHaveLength(1);
    expect(resultats.filter(({ ok }) => !ok)).toEqual([LIMITE_ATTEINTE]);
    expect((await lireUsage(h.client)).vehicules).toBe(LIMITES_FREE.vehicules);
  });

  it("en Pro, les véhicules sont illimités", async () => {
    const pro = await compte("vehicules-pro", { pro: true });
    for (let n = 1; n <= LIMITES_FREE.vehicules + 2; n++) await vehicule(pro, plaque("VP", n));
    expect((await lireUsage(pro.client)).vehicules).toBe(LIMITES_FREE.vehicules + 2);
  });
});

describe("plan Free : import des véhicules", () => {
  const fichier = (...lignes: string[]): FichierRecu => ({
    nom: "vehicules.csv",
    octets: new TextEncoder().encode(["Plaque;Type", ...lignes].join("\r\n")),
  });
  const statuts = (lignes: LigneVehicule[]) => lignes.map(({ plaque, statut }) => [plaque, statut]);
  const lignesVehicules = (rapport: Awaited<ReturnType<typeof importerFlotte>>) => {
    const [vehicules] = rapport.fichiers;
    if (vehicules?.type !== "vehicules") throw new Error("fichier véhicules attendu");
    return vehicules.lignes;
  };

  it(`au-delà du ${LIMITES_FREE.vehicules}e véhicule actif, les lignes suivantes ne sont pas importées`, async () => {
    const g = await compte("import");
    const plaques = Array.from({ length: LIMITES_FREE.vehicules + 2 }, (_, n) => plaque("MP", n + 1));
    const rapport = await importerFlotte(g.client, [fichier(...plaques.map((p) => `${p};Attitré`))]);
    expect(rapport.importes.vehicules).toBe(LIMITES_FREE.vehicules);
    expect(statuts(lignesVehicules(rapport))).toEqual(
      plaques.map((p, n) => [p, n < LIMITES_FREE.vehicules ? "importee" : "hors_limite"]),
    );
    expect((await lireUsage(g.client)).vehicules).toBe(LIMITES_FREE.vehicules);
  });

  it("un véhicule ajouté entre l'aperçu et l'écriture fait passer la ligne hors limite", async () => {
    const g = await compte("import-course");
    for (let n = 1; n < LIMITES_FREE.vehicules; n++) await vehicule(g, plaque("RC", n));
    const rapport = await importerFlotte(g.client, [fichier(`${plaque("RC", 8)};Attitré`)], {
      ...ECRITURES,
      creerVehicule: async (supabase, saisie, options) => {
        await creerVehicule(supabase, { plaque: plaque("RC", 9), type: "pool" });
        return creerVehicule(supabase, saisie, options);
      },
    });
    expect(lignesVehicules(rapport)[0]).toMatchObject({
      statut: "hors_limite",
      motifs: { general: MESSAGES_IMPORT.horsLimite },
    });
    expect(rapport.importes.vehicules).toBe(0);
  });
});

describe("plan Free : avis du mois", () => {
  let g: Gestionnaire;
  const depots: { id: string; verrouille: boolean }[] = [];

  beforeAll(async () => {
    g = await compte("avis");
    for (let n = 0; n <= LIMITES_FREE.avisParMois; n++) {
      const depot = await creerAvis(g.client, { chemin: await envoyerFichierAvis(g), nom: `avis-${n}.png` });
      if (!depot.ok) throw new Error(`dépôt : ${depot.erreur}`);
      depots.push(depot);
    }
  });

  it(`les ${LIMITES_FREE.avisParMois} premiers dépôts du mois comptent dans le quota ; le suivant est verrouillé`, async () => {
    const mois = moisQuota(aujourdhuiParis());
    const comptes = depots.slice(0, LIMITES_FREE.avisParMois);
    expect(comptes.every(({ verrouille }) => !verrouille)).toBe(true);
    for (const { id } of comptes) expect(await avisEnBase(id)).toMatchObject({ verrouille: false, mois_quota: mois });

    const sixieme = depots[LIMITES_FREE.avisParMois];
    expect(sixieme.verrouille).toBe(true);
    expect(await avisEnBase(sixieme.id)).toMatchObject({ verrouille: true, mois_quota: null, statut: "a_traiter" });
    expect(await lireUsage(g.client)).toEqual({ vehicules: 0, avisCeMois: LIMITES_FREE.avisParMois });
  });

  it("un avis verrouillé n'est pas lu par l'IA", async () => {
    const lecteur = vi.fn<Lecteur>();
    expect(await lireEtRemplirAvis(g.client, depots[LIMITES_FREE.avisParMois].id, lecteur)).toEqual({
      lecture: "ignoree",
    });
    expect(lecteur).not.toHaveBeenCalled();
  });

  it("se saisit à la main, mais son conducteur ne se valide pas, même par l'API", async () => {
    const { id } = depots[LIMITES_FREE.avisParMois];
    const saisie = await modifierAvis(g.client, id, { plaque: "AB-123-CD", date_envoi: "06/10/2025" });
    expect(saisie).toMatchObject({ ok: true, avis: { plaque: "AB-123-CD", echeance: "2025-11-20", verrouille: true } });

    const karim = await creerConducteur(g.client, { prenom: "Karim", nom: "Benali" });
    if (!karim.ok) throw new Error("conducteur");
    expect(await validerConducteur(g.client, id, karim.conducteur.id)).toEqual({
      ok: false,
      erreurs: { general: MESSAGES_AVIS.verrouille },
    });
    const direct = await g.client.from("avis").update({ conducteur_id: karim.conducteur.id }).eq("id", id);
    expect(direct.error?.code).toBe("23514");
    // Seule la base écrit le verrouillage.
    const deverrouiller = await g.client.from("avis").update({ verrouille: false }).eq("id", id);
    expect(deverrouiller.error?.code).toBe("42501");
  });

  it("un tableau d'avis semé d'un seul insert est compté ligne à ligne", async () => {
    const t = await compte("tableau");
    const semes = await semer(t, Array.from({ length: LIMITES_FREE.avisParMois + 2 }, () => ({})));
    expect(semes.filter(({ verrouille }) => verrouille)).toHaveLength(2);
  });

  it("en Pro, aucun avis n'est verrouillé", async () => {
    const pro = await compte("avis-pro", { pro: true });
    const semes = await semer(pro, Array.from({ length: LIMITES_FREE.avisParMois + 2 }, () => ({})));
    expect(semes.some(({ verrouille }) => verrouille)).toBe(false);
  });
});

describe("plan Free : déverrouillage", () => {
  let g: Gestionnaire;
  let mars: { id: string; verrouille: boolean; mois_quota: string | null }[];
  let sansEcheance: string;
  let prochaine: string;
  let lointaine: string;
  let classe: string;

  const etat = async (id: string) => {
    const avis = await avisEnBase(id);
    return { verrouille: avis?.verrouille, mois_quota: avis?.mois_quota };
  };

  beforeAll(async () => {
    g = await compte("deverrouillage");
    // Avril d'abord : un dépôt d'avril déverrouillerait les avis verrouillés de mars.
    await semer(
      g,
      Array.from({ length: LIMITES_FREE.avisParMois - 2 }, () => ({ depose_le: "2025-04-02T08:00:00Z" })),
    );
    mars = await semer(g, [
      ...Array.from({ length: LIMITES_FREE.avisParMois }, () => ({ depose_le: "2025-03-03T08:00:00Z" })),
      { depose_le: "2025-03-10T08:00:00Z", date_envoi: "2025-03-08" },
      { depose_le: "2025-03-11T08:00:00Z", date_envoi: "2025-03-01" },
      { depose_le: "2025-03-12T08:00:00Z", fichier: await envoyerFichierAvis(g), date_envoi: null },
      {
        depose_le: "2025-03-13T08:00:00Z",
        statut: "classe",
        classe_le: "2025-03-14T08:00:00Z",
        motif_classement: "conteste",
      },
    ]);
    [lointaine, prochaine, sansEcheance, classe] = mars.slice(LIMITES_FREE.avisParMois).map(({ id }) => id);
  });

  it(`au-delà de ${LIMITES_FREE.avisParMois} dépôts en mars, les suivants sont verrouillés`, () => {
    expect(mars.map(({ verrouille }) => verrouille)).toEqual([false, false, false, false, false, true, true, true, true]);
  });

  it("la plaque saisie pendant le verrouillage est gardée", async () => {
    expect((await modifierAvis(g.client, sansEcheance, { plaque: "PF-707-AA" })).ok).toBe(true);
  });

  it("le 1er avril, les places libres vont d'abord à l'avis sans échéance, puis à l'échéance la plus proche", async () => {
    await deverrouillerAvis({ supabase: admin, aujourdhui: "2025-04-01" });
    expect(await etat(sansEcheance)).toEqual({ verrouille: false, mois_quota: "2025-04-01" });
    expect(await etat(prochaine)).toEqual({ verrouille: false, mois_quota: "2025-04-01" });
    expect(await etat(lointaine)).toEqual({ verrouille: true, mois_quota: null });
    // Un avis classé ne prend pas de place.
    expect(await etat(classe)).toEqual({ verrouille: true, mois_quota: null });
  });

  it("relancer ne change rien", async () => {
    await deverrouillerAvis({ supabase: admin, aujourdhui: "2025-04-01" });
    await deverrouillerAvis({ supabase: admin, aujourdhui: "2025-04-30" });
    expect(await etat(lointaine)).toEqual({ verrouille: true, mois_quota: null });
    const { count } = await admin
      .from("avis")
      .select("id", { count: "exact", head: true })
      .eq("entreprise_id", g.entrepriseId)
      .eq("mois_quota", "2025-04-01");
    expect(count).toBe(LIMITES_FREE.avisParMois);
  });

  it("si la tâche a sauté, le premier dépôt de mai déverrouille d'abord l'avis de mars", async () => {
    const [mai] = await semer(g, [{ depose_le: "2025-05-06T08:00:00Z" }]);
    expect(await etat(lointaine)).toEqual({ verrouille: false, mois_quota: "2025-05-01" });
    expect(mai).toMatchObject({ verrouille: false, mois_quota: "2025-05-01" });
    expect(await etat(classe)).toEqual({ verrouille: true, mois_quota: null });
  });

  it("déverrouillé, l'avis est lu à son ouverture : la lecture ne remplit que les champs vides", async () => {
    const avant = await avisEnBase(sansEcheance);
    expect(aLireApresDeverrouillage(avant!)).toBe(true);

    const LUES: Record<ChampAvis, string> = {
      numero: "7770000001",
      plaque: "ZZ-999-ZZ",
      infraction_date: "02/03/2025",
      infraction_heure: "08:30",
      lieu: "A6, Auxerre",
      infraction: "Excès de vitesse inférieur à 20 km/h",
      montant: "135,00",
      date_envoi: "05/03/2025",
    };
    const lecture = Object.fromEntries(
      CHAMPS_AVIS.map((champ) => [champ, { valeur: LUES[champ], confiance: "sur" }]),
    ) as Lecture;
    expect(await lireEtRemplirAvis(g.client, sansEcheance, async () => lecture)).toEqual({ lecture: "lue" });

    const apres = await avisEnBase(sansEcheance);
    expect(apres).toMatchObject({ plaque: "PF-707-AA", numero: "7770000001", date_envoi: "2025-03-05", lecture_ia: "lue" });
    expect(aLireApresDeverrouillage(apres!)).toBe(false);
  });

  it("la tâche est réservée à la clé secrète", async () => {
    const appel = await g.client.rpc("deverrouiller_avis_du_mois", { p_aujourdhui: "2025-04-01" });
    expect(appel.error?.code).toBe("42501");
    const interne = await g.client.rpc("deverrouiller_avis", { p_entreprise: g.entrepriseId, p_mois: "2025-04-01" });
    expect(interne.error).not.toBeNull();
  });
});

describe("plan Free : historique", () => {
  let g: Gestionnaire;
  let ancien: string;
  let ancienClasse: string;
  let recent: string;
  let ouvert: string;

  beforeAll(async () => {
    g = await compte("historique");
    const karim = await creerConducteur(g.client, { prenom: "Karim", nom: "Benali" });
    if (!karim.ok) throw new Error("conducteur");
    const aujourdhui = aujourdhuiParis();
    const ilYa = (mois: number) => `${ajouterMois(aujourdhui, -mois)}T10:00:00Z`;
    const designe = (mois: number) => ({
      depose_le: ilYa(mois + 1),
      statut: "designe",
      conducteur_id: karim.conducteur.id,
      designe_le: ilYa(mois),
    });
    [ancien, ancienClasse, recent, ouvert] = (
      await semer(g, [
        designe(LIMITES_FREE.historiqueMois + 1),
        {
          depose_le: ilYa(LIMITES_FREE.historiqueMois + 2),
          statut: "classe",
          classe_le: ilYa(LIMITES_FREE.historiqueMois + 1),
          motif_classement: "conteste",
        },
        designe(1),
        { depose_le: ilYa(LIMITES_FREE.historiqueMois + 2) },
      ])
    ).map(({ id }) => id);
  });

  it(`en Free, les avis désignés ou classés depuis plus de ${LIMITES_FREE.historiqueMois} mois sont masqués ; un avis ouvert reste visible`, async () => {
    const { data: entreprise } = await g.client.from("entreprise").select("plan").single();
    expect(entreprise?.plan).toBe("free");
    const debut = debutHistorique("free");
    const { data, error } = await listerAvis(g.client, debut);
    expect(error).toBeNull();
    expect(data?.map(({ id }) => id).toSorted()).toEqual([recent, ouvert].toSorted());
    expect((await compterAvisMasques(g.client, debut!)).count).toBe(2);
    // Masqués, jamais supprimés.
    expect(await avisEnBase(ancien)).not.toBeNull();
  });

  it("en Pro, tout l'historique est visible", async () => {
    await passerEnPro(g.entrepriseId);
    const { data: entreprise } = await g.client.from("entreprise").select("plan").single();
    expect(entreprise?.plan).toBe("pro");
    const { data } = await listerAvis(g.client, debutHistorique("pro"));
    expect(data?.map(({ id }) => id).toSorted()).toEqual([ancien, ancienClasse, recent, ouvert].toSorted());
  });

  it("le gestionnaire ne change pas son plan lui-même", async () => {
    const { error } = await g.client.from("entreprise").update({ plan: "free" }).eq("id", g.entrepriseId);
    expect(error?.code).toBe("42501");
  });
});
