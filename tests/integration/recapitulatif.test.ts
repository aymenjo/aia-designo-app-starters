import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EvenementEnvoye } from "@/lib/agent/client";
import { conversationEnCours, lireConversation, nouvelleConversation } from "@/lib/agent/conversations";
import { traiterDemande, type EvenementDemande } from "@/lib/agent/demande";
import { enregistrerRecapitulatif, rattacherRecapitulatifs } from "@/lib/agent/recapitulatifs";
import { instantParis } from "@/lib/dates";
import { creerAffectation, cloturerAffectation } from "@/lib/flotte/affectations";
import { annulerRecapitulatif, confirmerRecapitulatif, lireInstantane } from "@/lib/flotte/recapitulatif";
import { MESSAGES } from "@/lib/flotte/regles";
import {
  MESSAGES_RECAPITULATIF,
  ciblesDe,
  ciblesDesEntrees,
  preparerRecapitulatif,
  type EntreeModification,
} from "@/lib/flotte/regles-recapitulatif";
import { MESSAGES_AGENT } from "@/lib/agent/regles";
import { fauxAgent, idEvenement, messageAgent, type Scenario } from "../agent";
import { admin, passerEnPro, premiereConnexion, suffixeUnique, supprimerGestionnaire, type Gestionnaire } from "./outils";

// Le récapitulatif de modifications (phase 29) sur le Supabase local, avec un faux Claude Managed Agents : l'agent
// propose, rien ne change avant « Confirmer », qui revérifie tout puis applique en une transaction, sous la session du
// gestionnaire. « Confirmer » et « Annuler » ne passent jamais par l'agent. Phase 30 : les lignes rouges sont
// enregistrées et bloquent « Confirmer », et « Modifier » fait refaire le récapitulatif.

const suffixe = suffixeUnique();
const gestionnaires: Gestionnaire[] = [];

afterAll(async () => {
  for (const g of gestionnaires) await supprimerGestionnaire(g);
});

function verifier<T>({ data, error }: { data: T; error: unknown }): NonNullable<T> {
  if (error) throw error;
  return data as NonNullable<T>;
}

const DEBUT_KARIM = "2025-09-01T06:00:00+00:00";
const SAMEDI = instantParis("2026-11-07", "00:00")!;

type Flotte = { g: Gestionnaire; camion: string; pool: string; karim: string; lea: string; ines: string; affectation: string };

/** Un compte Pro : le camion attitré de Karim (AB-123-CD), un véhicule de pool, Léa et Inès. */
async function flotte(nom: string): Promise<Flotte> {
  const g = await premiereConnexion(`recap-${nom}-${suffixe}@exemple.fr`);
  gestionnaires.push(g);
  await passerEnPro(g.entrepriseId);
  const entreprise_id = g.entrepriseId;
  const [camion, pool] = verifier(
    await admin
      .from("vehicule")
      .insert([
        { entreprise_id, plaque: "AB-123-CD", modele: "Renault Master", type: "attitre" },
        { entreprise_id, plaque: "MN-345-PQ", modele: "Peugeot Expert", type: "pool" },
      ])
      .select("id, plaque")
      .order("plaque"),
  ).map(({ id }) => id);
  const [karim, lea, ines] = await Promise.all(
    [
      { prenom: "Karim", nom: "Benali" },
      { prenom: "Léa", nom: "Moreau" },
      { prenom: "Inès", nom: "Garnier" },
    ].map(async (personne) =>
      verifier(await admin.from("conducteur").insert({ entreprise_id, ...personne }).select("id").single()).id,
    ),
  );
  const affectation = verifier(
    await admin
      .from("affectation")
      .insert({ entreprise_id, vehicule_id: camion, conducteur_id: karim, debut: DEBUT_KARIM })
      .select("id")
      .single(),
  ).id;
  return { g, camion, pool, karim, lea, ines, affectation };
}

/** « Karim part vendredi, passe son camion à Léa ». */
const karimPart = (f: Flotte): EntreeModification[] => [
  { operation: "cloturer_affectation", affectation_id: f.affectation, fin_date: "2026-11-06" },
  { operation: "creer_affectation", vehicule: { id: f.camion }, conducteur: { id: f.lea }, debut_date: "2026-11-07" },
  { operation: "archiver_conducteur", conducteur_id: f.karim },
];

/**
 * Une proposition de l'agent, sans l'agent : préparée sous la session du gestionnaire, lignes rouges comprises, puis
 * rattachée à une réponse.
 */
async function proposer(f: Flotte, entrees: EntreeModification[]) {
  const conversation = await conversationEnCours(admin, f.g.entrepriseId, new Date());
  const preparation = preparerRecapitulatif(await lireInstantane(f.g.client, ciblesDesEntrees(entrees)), entrees);
  if (!preparation.ok) throw new Error(JSON.stringify(preparation.motifs));
  const { id } = await enregistrerRecapitulatif(admin, conversation, preparation.lignes);
  const message = verifier(
    await admin
      .from("message")
      .insert({ conversation_id: conversation.id, entreprise_id: f.g.entrepriseId, role: "agent", contenu: "Voici le récapitulatif." })
      .select("id")
      .single(),
  );
  await rattacherRecapitulatifs(admin, conversation.id, message.id);
  return { id, conversation, lignes: preparation.lignes };
}

async function recapitulatifs(g: Gestionnaire) {
  return verifier(
    await admin
      .from("recapitulatif")
      .select("id, statut, message_id, applique_le, crees, sort_signale_le")
      .eq("entreprise_id", g.entrepriseId)
      .order("cree_le"),
  );
}

/** L'état de la flotte qui compte ici : l'affectation de Karim, ses archives, et les affectations du camion. */
async function etatFlotte(f: Flotte) {
  const [affectation, karim, duCamion, camion] = await Promise.all([
    admin.from("affectation").select("fin").eq("id", f.affectation).single(),
    admin.from("conducteur").select("archive_le").eq("id", f.karim).single(),
    admin.from("affectation").select("conducteur_id, debut, fin").eq("vehicule_id", f.camion).order("debut"),
    admin.from("vehicule").select("modele").eq("id", f.camion).single(),
  ]);
  return {
    finKarim: verifier(affectation).fin as string | null,
    karimArchive: Boolean(verifier(karim).archive_le),
    affectationsDuCamion: verifier(duCamion).length,
    modeleCamion: verifier(camion).modele as string | null,
  };
}

const INTACTE = { finKarim: null, karimArchive: false, affectationsDuCamion: 1, modeleCamion: "Renault Master" };

/** L'agent appelle `proposer_modifications`, puis répond ; `vu` garde le résultat de l'outil. */
function scenarioProposition(entrees: () => unknown[], vu: { resultat?: Extract<EvenementEnvoye, { type: "resultat" }> }): Scenario {
  return (envoyes) => {
    if (envoyes.some(({ type }) => type === "demande")) {
      const outil = idEvenement();
      return [
        { type: "outil", id: outil, nom: "proposer_modifications", entree: { modifications: entrees() } },
        { type: "attente", ids: [outil] },
      ];
    }
    vu.resultat = envoyes.find((e): e is Extract<EvenementEnvoye, { type: "resultat" }> => e.type === "resultat");
    if (!vu.resultat) return [];
    return [messageAgent("Voici les modifications prévues. Rien n'est appliqué avant « Confirmer »."), { type: "fin" }];
  };
}

async function demander(g: Gestionnaire, client: ReturnType<typeof fauxAgent>["client"], texte: string, corrige?: string) {
  const evenements: EvenementDemande[] = [];
  await traiterDemande({ admin, supabase: g.client, client, texte, corrige, surEvenement: (e) => evenements.push(e) });
  return evenements;
}

/** « La plaque AB-123-CD est déjà dans votre flotte. » : une ligne rouge, celle de l'écran Véhicules. */
const CAMION_EN_DOUBLE: EntreeModification = { operation: "creer_vehicule", plaque: "AB-123-CD", type: "attitre" };

describe("la proposition de l'agent", () => {
  let f: Flotte;
  // Une seule session pour la conversation : chaque test choisit ce que l'agent propose.
  let entrees: () => unknown[] = () => [];
  const vu: { resultat?: Extract<EvenementEnvoye, { type: "resultat" }> } = {};
  const agent = fauxAgent(scenarioProposition(() => entrees(), vu));

  beforeAll(async () => {
    f = await flotte("proposition");
  });

  it("enregistre un récapitulatif rattaché à la réponse, sans rien changer à la flotte", async () => {
    entrees = () => karimPart(f);
    const evenements = await demander(f.g, agent.client, "Karim part vendredi, passe son camion à Léa");

    expect(vu.resultat?.erreur).toBe(false);
    expect(JSON.parse(vu.resultat!.contenu)).toMatchObject({
      lignes: [
        "1. Clôturer l'affectation de Karim B. sur AB-123-CD · Fin : sans fin → 07/11/2026 00:00",
        "2. Créer une affectation pour Léa M. sur AB-123-CD · Début : 07/11/2026 00:00 · sans fin · attitré",
        "3. Archiver la fiche de Karim B. · Actif → Archivé",
      ],
      consigne: MESSAGES_RECAPITULATIF.propose,
    });
    const reponse = evenements.find((e): e is Extract<EvenementDemande, { type: "message" }> => e.type === "message")!;
    expect(reponse.message.recapitulatif).toMatchObject({ statut: "propose", applique_le: null });

    const [recap] = await recapitulatifs(f.g);
    expect(recap).toMatchObject({ statut: "propose", message_id: reponse.message.id });
    expect(await etatFlotte(f)).toEqual(INTACTE);

    // Le panneau le retrouve sous la réponse, à la réouverture.
    const { messages } = await lireConversation(f.g.client);
    expect(messages.at(-1)?.recapitulatif).toMatchObject({ id: recap.id, statut: "propose" });
  });

  it("enregistre en rouge les lignes que les règles des écrans refusent, avec leur motif et la consigne de se corriger", async () => {
    const [premier] = await recapitulatifs(f.g);
    const [cloture, creation, archivage] = karimPart(f);
    entrees = () => [creation, cloture, archivage];
    const evenements = await demander(f.g, agent.client, "Passe le camion de Karim à Léa samedi");

    const conflit = MESSAGES.conflitAffectation("Karim B.", "AB-123-CD", DEBUT_KARIM, null);
    expect(vu.resultat?.erreur).toBe(false);
    expect(JSON.parse(vu.resultat!.contenu)).toMatchObject({
      lignes: [
        `1. Créer une affectation pour Léa M. sur AB-123-CD · Impossible : ${conflit}`,
        "2. Clôturer l'affectation de Karim B. sur AB-123-CD · Fin : sans fin → 07/11/2026 00:00",
        "3. Archiver la fiche de Karim B. · Actif → Archivé",
      ],
      lignes_impossibles: [{ ligne: 1, motif: conflit }],
      consigne: MESSAGES_RECAPITULATIF.proposeImpossible,
    });
    const reponse = evenements.find((e): e is Extract<EvenementDemande, { type: "message" }> => e.type === "message")!;
    expect(reponse.message.recapitulatif?.lignes[0]).toMatchObject({ refus: conflit });

    // Il remplace le précédent, comme tout nouveau récapitulatif.
    const tous = await recapitulatifs(f.g);
    expect(tous.map(({ statut }) => statut)).toEqual(["remplace", "propose"]);
    expect(tous[0].id).toBe(premier.id);
    expect(await etatFlotte(f)).toEqual(INTACTE);
  });

  it("refuse une proposition mal formée, sans rien enregistrer", async () => {
    const avant = await recapitulatifs(f.g);
    entrees = () => [karimPart(f)[0], { operation: "archiver_vehicule", vehicule_id: crypto.randomUUID() }];
    await demander(f.g, agent.client, "Archive l'autre camion");

    expect(vu.resultat?.erreur).toBe(true);
    expect(JSON.parse(vu.resultat!.contenu)).toEqual({
      erreur: MESSAGES_RECAPITULATIF.refusOutil,
      lignes_invalides: [{ ligne: 2, motif: MESSAGES.vehiculeIntrouvable }],
    });
    expect(await recapitulatifs(f.g)).toEqual(avant);
  });

  it("remplace le récapitulatif précédent par le nouveau", async () => {
    const enAttente = (await recapitulatifs(f.g)).at(-1)!;
    entrees = () => [karimPart(f)[0]];
    await demander(f.g, agent.client, "Clôture seulement l'affectation de Karim vendredi");

    const tous = await recapitulatifs(f.g);
    expect(tous.slice(-2).map(({ statut }) => statut)).toEqual(["remplace", "propose"]);
    expect(tous.at(-2)!.id).toBe(enAttente.id);
  });
});

describe("« Confirmer »", () => {
  it("applique les 3 lignes en une fois, sans nouveau message ni nouvel envoi à l'agent", async () => {
    const f = await flotte("confirmer");
    const agent = fauxAgent(scenarioProposition(() => karimPart(f), {}));
    await demander(f.g, agent.client, "Karim part vendredi, passe son camion à Léa");
    const [recap] = await recapitulatifs(f.g);
    const messages = verifier(await admin.from("message").select("id").eq("entreprise_id", f.g.entrepriseId)).length;
    const envois = agent.envois.length;

    const resultat = await confirmerRecapitulatif(f.g.client, recap.id);
    expect(resultat).toMatchObject({ ok: true, recapitulatif: { statut: "applique" } });
    expect(await etatFlotte(f)).toEqual({ ...INTACTE, finKarim: "2026-11-06T23:00:00+00:00", karimArchive: true, affectationsDuCamion: 2 });
    const lea = verifier(await admin.from("affectation").select("debut, fin").eq("conducteur_id", f.lea).single());
    expect(Date.parse(lea.debut)).toBe(Date.parse(SAMEDI));
    expect(lea.fin).toBeNull();

    const [applique] = await recapitulatifs(f.g);
    expect(applique.statut).toBe("applique");
    expect(applique.applique_le).not.toBeNull();
    expect(verifier(await admin.from("message").select("id").eq("entreprise_id", f.g.entrepriseId))).toHaveLength(messages);
    expect(agent.envois).toHaveLength(envois);

    // Une seule fois : un second clic ne fait rien.
    expect(await confirmerRecapitulatif(f.g.client, recap.id)).toMatchObject({
      ok: false,
      erreur: MESSAGES_RECAPITULATIF.plusApplicable,
      recapitulatif: { statut: "applique" },
    });
  });

  it("crée un véhicule et l'affecte dans la même transaction, puis lui rattache les avis à sa plaque", async () => {
    const f = await flotte("creation");
    const avis = verifier(
      await admin
        .from("avis")
        .insert({
          entreprise_id: f.g.entrepriseId,
          numero: String(Date.now()).slice(-10),
          plaque: "GH-789-JK",
          fichier: `${f.g.entrepriseId}/${crypto.randomUUID()}.png`,
          fichier_type: "image/png",
        })
        .select("id")
        .single(),
    );
    const { id } = await proposer(f, [
      { operation: "creer_vehicule", plaque: "gh-789-jk", modele: "Iveco Daily", type: "attitre" },
      { operation: "creer_affectation", vehicule: { ligne: 1 }, conducteur: { id: f.ines }, debut_date: "2026-11-09" },
    ]);

    const resultat = await confirmerRecapitulatif(f.g.client, id);
    if (!resultat.ok) throw new Error(resultat.erreur);
    const vehicule = resultat.recapitulatif.crees["1"];
    expect(verifier(await admin.from("vehicule").select("plaque, modele").eq("id", vehicule).single())).toEqual({
      plaque: "GH-789-JK",
      modele: "Iveco Daily",
    });
    expect(verifier(await admin.from("affectation").select("conducteur_id").eq("vehicule_id", vehicule))).toEqual([
      { conducteur_id: f.ines },
    ]);
    expect(verifier(await admin.from("avis").select("vehicule_id").eq("id", avis.id).single()).vehicule_id).toBe(vehicule);
  });

  it("annule tout si une ligne viole une contrainte : la base donne la ligne en cause", async () => {
    const f = await flotte("transaction");
    const conversation = await conversationEnCours(admin, f.g.entrepriseId, new Date());
    // Des lignes écrites sans passer par les règles : la ligne 2 chevauche l'affectation ouverte de Karim.
    const { id } = await enregistrerRecapitulatif(admin, conversation, [
      { operation: "modifier_vehicule", cible: f.camion, avant: { modele: "Renault Master" }, apres: { modele: "Renault Trafic" }, affichage: {} },
      {
        operation: "creer_affectation",
        apres: { vehicule_id: { id: f.camion }, conducteur_id: { id: f.lea }, debut: SAMEDI, fin: null },
        affichage: {},
      },
    ]);
    const { error } = await f.g.client.rpc("appliquer_recapitulatif", { p_id: id });
    expect(error?.code).toBe("23P01");
    expect(JSON.parse(error!.details)).toEqual({ ligne: 2, contrainte: "affectation_sans_chevauchement" });
    expect(await etatFlotte(f)).toEqual(INTACTE);
    expect((await recapitulatifs(f.g))[0].statut).toBe("propose");
  });

  it("refuse avec le motif identique aux écrans quand un écran écrit entre la revérification et l'application", async () => {
    const f = await flotte("concurrence");
    const creneau = { operation: "creer_affectation", vehicule: { id: f.pool }, conducteur: { id: f.lea } } as const;
    const { id, lignes } = await proposer(f, [
      { ...creneau, debut_date: "2026-11-09", debut_heure: "08:00", fin_date: "2026-11-09", fin_heure: "18:00" },
    ]);
    const perimee = await lireInstantane(f.g.client, ciblesDe(lignes));
    const ecran = await creerAffectation(f.g.client, {
      vehicule_id: f.pool,
      conducteur_id: f.ines,
      debut_date: "09/11/2026",
      debut_heure: "10:00",
      fin_date: "09/11/2026",
      fin_heure: "12:00",
    });
    expect(ecran.ok).toBe(true);

    // La revérification lit la flotte d'avant l'écran : seule la base voit le conflit.
    let lectures = 0;
    const resultat = await confirmerRecapitulatif(f.g.client, id, {
      lire: async (supabase, cibles) => (lectures++ === 0 ? perimee : lireInstantane(supabase, cibles)),
    });
    const memeCreneau = await creerAffectation(f.g.client, {
      vehicule_id: f.pool,
      conducteur_id: f.lea,
      debut_date: "09/11/2026",
      debut_heure: "08:00",
      fin_date: "09/11/2026",
      fin_heure: "18:00",
    });
    if (memeCreneau.ok) throw new Error("le créneau devait être refusé");
    expect(resultat).toEqual({
      ok: false,
      erreur: MESSAGES_RECAPITULATIF.rienApplique([{ ligne: 1, motif: memeCreneau.erreurs.general! }]),
    });
    expect(memeCreneau.erreurs.general).toBe(
      MESSAGES.conflitAffectation("Inès G.", "MN-345-PQ", instantParis("2026-11-09", "10:00")!, instantParis("2026-11-09", "12:00")!),
    );
  });

  it("refuse un récapitulatif qui a une ligne rouge, en TypeScript comme en base", async () => {
    const f = await flotte("rouge");
    const { id, lignes } = await proposer(f, [karimPart(f)[0], CAMION_EN_DOUBLE]);
    expect(lignes[1]).toMatchObject({ refus: MESSAGES.plaqueDejaPresente("AB-123-CD") });

    expect(await confirmerRecapitulatif(f.g.client, id)).toEqual({
      ok: false,
      erreur: MESSAGES_RECAPITULATIF.rienApplique([{ ligne: 2, motif: MESSAGES.plaqueDejaPresente("AB-123-CD") }]),
    });
    // Appelée directement, la fonction refuse aussi, avant d'écrire la ligne 1.
    const { error } = await f.g.client.rpc("appliquer_recapitulatif", { p_id: id });
    expect(error).toMatchObject({ code: "P0001", message: "recapitulatif_ligne_impossible" });
    expect(JSON.parse(error!.details)).toEqual({ ligne: 2 });
    expect(await etatFlotte(f)).toEqual(INTACTE);
    expect(verifier(await admin.from("vehicule").select("id").eq("entreprise_id", f.g.entrepriseId))).toHaveLength(2);
    expect((await recapitulatifs(f.g))[0].statut).toBe("propose");
  });

  it("refuse un récapitulatif dont l'« avant » a changé, en TypeScript comme en base", async () => {
    const f = await flotte("perime");
    const { id } = await proposer(f, karimPart(f));
    const cloture = await cloturerAffectation(f.g.client, f.affectation, { fin_date: "20/11/2026", fin_heure: "18:00" });
    expect(cloture.ok).toBe(true);

    const resultat = await confirmerRecapitulatif(f.g.client, id);
    expect(resultat.ok).toBe(false);
    expect(!resultat.ok && resultat.erreur).toMatch(
      new RegExp(`^Rien n'a été appliqué\\. Ligne 1 : L'affectation de Karim B\\. sur AB-123-CD a changé depuis le récapitulatif\\.`),
    );
    // Appelée directement, la fonction refuse aussi : sa garde compare l'« avant » à la base.
    const { error } = await f.g.client.rpc("appliquer_recapitulatif", { p_id: id });
    expect(error).toMatchObject({ code: "P0001", message: "recapitulatif_ligne_perimee" });
    expect(JSON.parse(error!.details)).toMatchObject({ ligne: 1 });
    expect((await etatFlotte(f)).karimArchive).toBe(false);
  });
});

describe("« Annuler » et l'expiration", () => {
  it("« Annuler » abandonne le récapitulatif sans rien modifier, qui ne s'applique plus", async () => {
    const f = await flotte("annuler");
    const { id } = await proposer(f, karimPart(f));
    expect(await annulerRecapitulatif(f.g.client, id)).toMatchObject({ ok: true, recapitulatif: { statut: "annule" } });
    expect(await etatFlotte(f)).toEqual(INTACTE);
    expect(await confirmerRecapitulatif(f.g.client, id)).toMatchObject({ ok: false, erreur: MESSAGES_RECAPITULATIF.plusApplicable });
    expect(await annulerRecapitulatif(f.g.client, id)).toMatchObject({ ok: false, recapitulatif: { statut: "annule" } });
  });

  it("expire au retour en Free, à « Nouvelle conversation » et au-delà de 30 jours", async () => {
    const f = await flotte("expiration");

    const auRetourFree = await proposer(f, karimPart(f));
    verifier(await admin.from("entreprise").update({ plan: "free" }).eq("id", f.g.entrepriseId));
    expect((await recapitulatifs(f.g)).at(-1)?.statut).toBe("expire");
    expect(await confirmerRecapitulatif(f.g.client, auRetourFree.id)).toEqual({ ok: false, erreur: MESSAGES_RECAPITULATIF.pro });
    await passerEnPro(f.g.entrepriseId);

    await proposer(f, karimPart(f));
    expect(await nouvelleConversation({ admin, supabase: f.g.client, client: null })).toEqual({ ok: true });
    expect((await recapitulatifs(f.g)).at(-1)?.statut).toBe("expire");

    const vieux = await proposer(f, karimPart(f));
    const il_y_a_31_jours = new Date(Date.now() - 31 * 86_400_000).toISOString();
    verifier(await admin.from("conversation").update({ debut: il_y_a_31_jours }).eq("id", vieux.conversation.id));
    const { error } = await f.g.client.rpc("appliquer_recapitulatif", { p_id: vieux.id });
    expect(error).toMatchObject({ code: "P0001", message: "recapitulatif_plus_applicable" });
    // La demande suivante remplace la conversation : son récapitulatif expire.
    await conversationEnCours(admin, f.g.entrepriseId, new Date());
    expect((await recapitulatifs(f.g)).at(-1)?.statut).toBe("expire");
    expect(await etatFlotte(f)).toEqual(INTACTE);
  });
});

describe("« Modifier » (phase 30)", () => {
  /** Les notes jointes aux demandes que l'agent a reçues, dans l'ordre. */
  const contextes = (agent: ReturnType<typeof fauxAgent>) =>
    agent.envois.flatMap(({ evenements }) => evenements.flatMap((e) => (e.type === "demande" ? [e.contexte] : [])));
  const attente = (evenements: EvenementDemande[]) =>
    evenements.find((e): e is Extract<EvenementDemande, { type: "attente" }> => e.type === "attente");

  it("remplace le récapitulatif dès la demande acceptée, joint ses lignes à l'agent et marque la demande", async () => {
    const f = await flotte("modifier");
    let entrees: () => unknown[] = () => [karimPart(f)[0], CAMION_EN_DOUBLE];
    const agent = fauxAgent(scenarioProposition(() => entrees(), {}));
    const premiere = await demander(f.g, agent.client, "Karim part vendredi, et ajoute AB-123-CD");
    const [corrige] = await recapitulatifs(f.g);
    expect(corrige.statut).toBe("propose");

    entrees = () => [karimPart(f)[0]];
    const evenements = await demander(f.g, agent.client, "Retire la ligne du véhicule", corrige.id);

    // Comptée comme une demande, et le panneau apprend le remplacement dès l'acceptation.
    expect(attente(evenements)).toEqual({ type: "attente", demandes: attente(premiere)!.demandes + 1, remplace: corrige.id });
    const tous = await recapitulatifs(f.g);
    expect(tous.map(({ statut }) => statut)).toEqual(["remplace", "propose"]);
    expect(await confirmerRecapitulatif(f.g.client, corrige.id)).toMatchObject({
      ok: false,
      erreur: MESSAGES_RECAPITULATIF.plusApplicable,
      recapitulatif: { statut: "remplace" },
    });

    // L'agent reçoit les lignes, motif de la ligne rouge compris, avec la consigne de tout refaire.
    const note = contextes(agent)[1];
    expect(note).toContain("Le gestionnaire a cliqué « Modifier »");
    expect(note).toContain("1. Clôturer l'affectation de Karim B. sur AB-123-CD · Fin : sans fin → 07/11/2026 00:00");
    expect(note).toContain(`2. Ajouter le véhicule AB-123-CD · Impossible : ${MESSAGES.plaqueDejaPresente("AB-123-CD")}`);
    expect(contextes(agent)[0]).not.toContain("« Modifier »");

    // La marque est relue sous la session du gestionnaire : le panneau rappelle « Corrige le récapitulatif ».
    const { messages } = await lireConversation(f.g.client);
    const demandes = messages.filter(({ role }) => role === "gestionnaire");
    expect(demandes.map(({ correction }) => correction)).toEqual([false, true]);
    expect(MESSAGES_AGENT.corrige).toBe("Corrige le récapitulatif");
    expect(messages.at(-1)?.recapitulatif).toMatchObject({ id: tous[1].id, statut: "propose" });
  });

  it("ne touche ni un récapitulatif qui n'attend plus « Confirmer », ni celui d'une autre conversation", async () => {
    const f = await flotte("modifier-refus");
    const autre = await flotte("modifier-autre");
    const agent = fauxAgent(scenarioProposition(() => karimPart(f), {}));
    await demander(f.g, agent.client, "Karim part vendredi, passe son camion à Léa");
    const [annule] = await recapitulatifs(f.g);
    expect(await annulerRecapitulatif(f.g.client, annule.id)).toMatchObject({ ok: true });
    const { id: dAilleurs } = await proposer(autre, karimPart(autre));

    const silence = fauxAgent(() => [messageAgent("Très bien."), { type: "fin" }]);
    silence.ajouterSession(agent.envois[0].sessionId);
    for (const id of [annule.id, dAilleurs]) {
      const evenements = await demander(f.g, silence.client, "Finalement, Inès", id);
      expect(attente(evenements)).not.toHaveProperty("remplace");
    }
    expect((await recapitulatifs(f.g))[0].statut).toBe("annule");
    expect((await recapitulatifs(autre.g))[0].statut).toBe("propose");
    expect(contextes(silence).some((note) => note.includes("« Modifier »"))).toBe(false);
  });
});

describe("le sort du récapitulatif, signalé à l'agent", () => {
  it("est joint à la demande suivante, une seule fois", async () => {
    const f = await flotte("note");
    const agent = fauxAgent(scenarioProposition(() => karimPart(f), {}));
    await demander(f.g, agent.client, "Karim part vendredi, passe son camion à Léa");
    const [recap] = await recapitulatifs(f.g);
    const resultat = await confirmerRecapitulatif(f.g.client, recap.id);
    expect(resultat.ok).toBe(true);

    const reponse = fauxAgent(() => [messageAgent("C'est noté."), { type: "fin" }]);
    reponse.ajouterSession(agent.envois[0].sessionId);
    const contextes = () =>
      reponse.envois.flatMap(({ evenements }) => evenements.flatMap((e) => (e.type === "demande" ? [e.contexte] : [])));
    await demander(f.g, reponse.client, "Merci");
    await demander(f.g, reponse.client, "Et Léa ?");
    expect(contextes()[0]).toContain("Le gestionnaire a confirmé le récapitulatif que tu as proposé");
    expect(contextes()[1]).not.toContain("récapitulatif");
    expect((await recapitulatifs(f.g))[0].sort_signale_le).not.toBeNull();
  });
});

describe("la sécurité", () => {
  let f: Flotte;
  let autre: Gestionnaire;
  let id: string;

  beforeAll(async () => {
    f = await flotte("securite");
    autre = await premiereConnexion(`recap-autre-${suffixe}@exemple.fr`);
    gestionnaires.push(autre);
    await passerEnPro(autre.entrepriseId);
    ({ id } = await proposer(f, karimPart(f)));
  });

  it("isole les récapitulatifs de chaque entreprise", async () => {
    expect(verifier(await autre.client.from("recapitulatif").select("id"))).toEqual([]);
    expect(await confirmerRecapitulatif(autre.client, id)).toEqual({ ok: false, erreur: MESSAGES_RECAPITULATIF.plusApplicable });
    const { error } = await autre.client.rpc("appliquer_recapitulatif", { p_id: id });
    expect(error).toMatchObject({ message: "recapitulatif_plus_applicable" });
    expect(await annulerRecapitulatif(autre.client, id)).toMatchObject({ ok: false });
    expect((await recapitulatifs(f.g))[0].statut).toBe("propose");
  });

  it("refuse un faux « Appliqué » par l'API, et toute écriture hors de « Confirmer » et « Annuler »", async () => {
    const applique = await f.g.client.from("recapitulatif").update({ statut: "applique" }).eq("id", id).select("id");
    expect(applique.error).toMatchObject({ code: "42501", message: "recapitulatif_application_reservee" });
    const crees = await f.g.client.from("recapitulatif").update({ crees: { "1": f.camion } }).eq("id", id).select("id");
    expect(crees.error).toMatchObject({ code: "42501" });
    const lignes = await f.g.client.from("recapitulatif").update({ lignes: [] }).eq("id", id);
    expect(lignes.error?.code).toBe("42501");
    const ajout = await f.g.client.from("recapitulatif").insert({ conversation_id: crypto.randomUUID(), lignes: [] });
    expect(ajout.error?.code).toBe("42501");
    const signale = await f.g.client.from("recapitulatif").select("sort_signale_le");
    expect(signale.error?.code).toBe("42501");
    expect((await recapitulatifs(f.g))[0]).toMatchObject({ statut: "propose", applique_le: null, crees: {} });
    expect(await etatFlotte(f)).toEqual(INTACTE);
  });
});
