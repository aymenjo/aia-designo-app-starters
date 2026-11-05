import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleElement } from "@/lib/agent/citations";
import type { EvenementEnvoye } from "@/lib/agent/client";
import {
  arreterDemande,
  conversationEnCours,
  lireConversation,
  lireConversationPassee,
  listerConversations,
  nouvelleConversation,
  purgerConversations,
} from "@/lib/agent/conversations";
import { traiterDemande, type EvenementDemande } from "@/lib/agent/demande";
import { executerOutil, type ContexteOutils } from "@/lib/agent/outils";
import { enregistrerRecapitulatif, rattacherRecapitulatifs } from "@/lib/agent/recapitulatifs";
import { MESSAGES_AGENT, NOTE_ARRET, contexteDate, noteContexte, type RefContexte } from "@/lib/agent/regles";
import { annulerRecapitulatif, confirmerRecapitulatif, lireInstantane } from "@/lib/flotte/recapitulatif";
import {
  MESSAGES_RECAPITULATIF,
  ciblesDesEntrees,
  preparerRecapitulatif,
  type EntreeModification,
} from "@/lib/flotte/regles-recapitulatif";
import { formaterMontant } from "@/lib/format";
import { GET as purgeRoute } from "@/app/api/cron/purge-conversations/route";
import { MAINTENANT_DEMO, creerFlotteDemo, numeroAvis, type IdsDemo } from "../../evaluation/agent/flotte-demo";
import { fauxAgent, idEvenement, messageAgent, type Scenario } from "../agent";
import { PNG, admin, passerEnPro, premiereConnexion, suffixeUnique, supprimerGestionnaire, type Gestionnaire } from "./outils";

// Demande à Désigno (phase 26) sur le Supabase local, avec un faux Claude Managed Agents qui joue un scénario
// d'événements : la CI n'appelle jamais l'API. Les outils, eux, lisent pour de vrai, sous la session du gestionnaire.
// Le contexte de l'écran, les étapes et « Arrêter » (phase 28) ont leur bloc, comme l'historique (phase 32).

const suffixe = suffixeUnique();
const gestionnaires: Gestionnaire[] = [];

afterAll(async () => {
  for (const g of gestionnaires) await supprimerGestionnaire(g);
});

async function compte(nom: string, { pro = true } = {}) {
  const g = await premiereConnexion(`agent-${nom}-${suffixe}@exemple.fr`);
  gestionnaires.push(g);
  if (pro) await passerEnPro(g.entrepriseId);
  return g;
}

function verifier<T>({ data, error }: { data: T; error: unknown }): NonNullable<T> {
  if (error) throw error;
  return data as NonNullable<T>;
}

/** Un véhicule, un conducteur et un avis, semés hors RLS. */
async function semerFlotte(g: Gestionnaire, plaque: string) {
  const entreprise_id = g.entrepriseId;
  const vehicule = verifier(
    await admin.from("vehicule").insert({ entreprise_id, plaque, modele: "Renault Master", type: "attitre" }).select("id").single(),
  );
  const conducteur = verifier(
    await admin.from("conducteur").insert({ entreprise_id, prenom: "Karim", nom: "Benali" }).select("id").single(),
  );
  verifier(
    await admin.from("affectation").insert({
      entreprise_id,
      vehicule_id: vehicule.id,
      conducteur_id: conducteur.id,
      debut: "2026-01-05T07:00:00Z",
    }),
  );
  const avis = verifier(
    await admin
      .from("avis")
      .insert({
        entreprise_id,
        numero: String(Date.now()).slice(-10),
        plaque,
        vehicule_id: vehicule.id,
        infraction_le: "2026-03-12T07:00:00Z",
        date_envoi: "2026-03-18",
        fichier: `${entreprise_id}/${crypto.randomUUID()}.png`,
        fichier_type: "image/png",
      })
      .select("id")
      .single(),
  );
  return { vehicule: vehicule.id, conducteur: conducteur.id, avis: avis.id };
}

const ctx = (g: Gestionnaire, maintenant = new Date()): ContexteOutils => ({
  supabase: g.client,
  maintenant,
  connus: new Set(),
});

async function conversationsDe(g: Gestionnaire) {
  return verifier(
    await admin
      .from("conversation")
      .select("id, session_id, premiere_demande, terminee_le, session_effacee_le, demande_en_cours_depuis, elements_connus")
      .eq("entreprise_id", g.entrepriseId)
      .order("debut"),
  );
}

async function messagesDe(g: Gestionnaire) {
  return verifier(
    await admin
      .from("message")
      .select("role, contenu, erreur, elements_cites, evenement_id")
      .eq("entreprise_id", g.entrepriseId)
      .order("cree_le"),
  );
}

/** Une demande, avec ce que la route en renverrait au panneau. */
async function demander(
  g: Gestionnaire,
  client: ReturnType<typeof fauxAgent>["client"],
  texte: string,
  options: { maintenant?: Date; delaiMs?: number; contexte?: RefContexte } = {},
) {
  const evenements: EvenementDemande[] = [];
  await traiterDemande({ admin, supabase: g.client, client, texte, surEvenement: (e) => evenements.push(e), ...options });
  return evenements;
}

/** L'agent cherche le véhicule, puis le cite, avec un lien inventé et un lien externe. */
const scenarioNominal: Scenario = (envoyes) => {
  if (envoyes.some(({ type }) => type === "demande")) {
    const outil = idEvenement();
    return [
      messageAgent("Je cherche le véhicule."),
      { type: "outil", id: outil, nom: "chercher_vehicules", entree: { texte: "ab 123" } },
      { type: "attente", ids: [outil] },
    ];
  }
  const resultat = envoyes.find((e): e is Extract<EvenementEnvoye, { type: "resultat" }> => e.type === "resultat");
  if (!resultat) return [];
  const { vehicules } = JSON.parse(resultat.contenu) as { vehicules: { plaque: string; lien: string }[] };
  return [
    messageAgent(
      `[${vehicules[0].plaque}](${vehicules[0].lien}) est conduit par Karim Benali. ` +
        `Voir [l'avis](/avis/${crypto.randomUUID()}) et [le site](https://exemple.fr).`,
    ),
    { type: "fin" },
  ];
};

describe("l'isolation entre entreprises", () => {
  let a: Gestionnaire;
  let b: Gestionnaire;
  let flotteB: Awaited<ReturnType<typeof semerFlotte>>;

  beforeAll(async () => {
    [a, b] = await Promise.all([compte("iso-a"), compte("iso-b")]);
    flotteB = await semerFlotte(b, "BB-321-CC");
    const conversation = verifier(
      await admin
        .from("conversation")
        .insert({ entreprise_id: b.entrepriseId, session_id: `sesn_iso_${suffixe}`, premiere_demande: "Bonjour" })
        .select("id")
        .single(),
    );
    verifier(
      await admin
        .from("message")
        .insert({ conversation_id: conversation.id, entreprise_id: b.entrepriseId, role: "gestionnaire", contenu: "Bonjour" }),
    );
  });

  it("ne laisse voir à chacun que sa conversation et ses messages, sans l'id de la session ni écriture", async () => {
    expect(verifier(await a.client.from("conversation").select("id"))).toEqual([]);
    expect(verifier(await a.client.from("message").select("id"))).toEqual([]);
    expect(verifier(await b.client.from("conversation").select("id, premiere_demande"))).toHaveLength(1);
    expect(verifier(await b.client.from("message").select("contenu"))).toEqual([{ contenu: "Bonjour" }]);

    expect((await b.client.from("conversation").select("session_id")).error?.code).toBe("42501");
    expect((await b.client.from("conversation").select("elements_connus")).error?.code).toBe("42501");
    const [conversation] = verifier(await b.client.from("conversation").select("id"));
    const ecriture = await b.client
      .from("message")
      .insert({ conversation_id: conversation.id, entreprise_id: b.entrepriseId, role: "agent", contenu: "Piège" });
    expect(ecriture.error).not.toBeNull();
    expect((await b.client.from("conversation").update({ premiere_demande: "x" }).eq("id", conversation.id)).error).not.toBeNull();
  });

  it("n'exécute les outils que sur l'entreprise du gestionnaire, même avec les ids d'une autre", async () => {
    const fiche = await executerOutil(ctx(a), "fiche_conducteur", { conducteur_id: flotteB.conducteur });
    expect(fiche).toEqual({ contenu: JSON.stringify({ erreur: "Ce conducteur est introuvable." }), erreur: true });
    const moment = await executerOutil(ctx(a), "conducteur_au_moment", { vehicule_id: flotteB.vehicule, date: "2026-03-12" });
    expect(moment.erreur).toBe(true);
    const avis = await executerOutil(ctx(a), "lister_avis", { vehicule_id: flotteB.vehicule });
    expect(JSON.parse(avis.contenu)).toMatchObject({ total: 0, avis: [] });
    const vehicules = await executerOutil(ctx(a), "chercher_vehicules", {});
    expect(JSON.parse(vehicules.contenu)).toMatchObject({ total: 0 });

    const chezB = await executerOutil(ctx(b), "fiche_conducteur", { conducteur_id: flotteB.conducteur });
    expect(JSON.parse(chezB.contenu)).toMatchObject({ nom: "Karim Benali", lien: `/flotte/conducteurs/${flotteB.conducteur}` });
  });

  it("refuse une entrée mal formée, ou un outil inconnu", async () => {
    expect((await executerOutil(ctx(a), "lister_avis", { statut: "ouvert" })).erreur).toBe(true);
    expect(await executerOutil(ctx(a), "supprimer_vehicule", {})).toEqual({
      contenu: JSON.stringify({ erreur: "Outil inconnu : supprimer_vehicule." }),
      erreur: true,
    });
  });
});

describe("une demande", () => {
  let g: Gestionnaire;
  let flotte: Awaited<ReturnType<typeof semerFlotte>>;

  beforeAll(async () => {
    g = await compte("nominal");
    flotte = await semerFlotte(g, "AB-123-CD");
  });

  it("exécute l'outil appelé, renvoie son résultat, puis enregistre la réponse sans lien inconnu", async () => {
    const agent = fauxAgent(scenarioNominal);
    const maintenant = new Date();
    const evenements = await demander(g, agent.client, "  Qui conduit AB-123-CD ?  ", { maintenant });

    const lien = `/flotte/vehicules/${flotte.vehicule}`;
    const contenu = `[AB-123-CD](${lien}) est conduit par Karim Benali. Voir l'avis et le site.`;
    expect(evenements).toEqual([
      { type: "attente", demandes: 1 },
      { type: "etape", texte: "Je cherche ab 123 dans les véhicules…" },
      { type: "message", message: expect.objectContaining({ role: "agent", contenu, erreur: false, arret: false }) },
    ]);

    // La session ne porte que l'id de l'entreprise ; la demande part avec la date du jour.
    const [session] = [...agent.sessions.values()];
    expect(session.metadonnees).toEqual({ entreprise_id: g.entrepriseId });
    const [envoiDemande, envoiResultat] = agent.envois;
    expect(envoiDemande.evenements).toEqual([
      { type: "demande", texte: "Qui conduit AB-123-CD ?", contexte: `${contexteDate(maintenant)}\n\n${noteContexte(null)}` },
    ]);
    expect(envoiResultat.evenements).toEqual([
      expect.objectContaining({ type: "resultat", erreur: false, contenu: expect.stringContaining('"plaque":"AB-123-CD"') }),
    ]);

    expect(await messagesDe(g)).toEqual([
      { role: "gestionnaire", contenu: "Qui conduit AB-123-CD ?", erreur: false, elements_cites: [], evenement_id: null },
      {
        role: "agent",
        contenu,
        erreur: false,
        elements_cites: [{ type: "vehicule", id: flotte.vehicule, lien }],
        evenement_id: expect.stringMatching(/^sevt_/),
      },
    ]);
    const [conversation] = await conversationsDe(g);
    expect(conversation).toMatchObject({
      session_id: session.id,
      premiere_demande: "Qui conduit AB-123-CD ?",
      demande_en_cours_depuis: null,
      terminee_le: null,
    });
    expect(conversation.elements_connus).toContain(cleElement("vehicule", flotte.vehicule));

    const lue = await lireConversation(g.client);
    expect(lue.enCours).toBe(false);
    expect(lue.messages.map(({ role }) => role)).toEqual(["gestionnaire", "agent"]);
  });

  it("garde la session de la conversation, et les éléments déjà renvoyés restent citables", async () => {
    const lien = `/flotte/vehicules/${flotte.vehicule}`;
    const agent = fauxAgent(() => [messageAgent(`Toujours [AB-123-CD](${lien}).`), { type: "fin" }]);
    const [conversation] = await conversationsDe(g);
    agent.ajouterSession(conversation.session_id!);

    await demander(g, agent.client, "Et maintenant ?");
    expect(agent.envois[0].sessionId).toBe(conversation.session_id);
    expect((await messagesDe(g)).at(-1)).toMatchObject({ contenu: `Toujours [AB-123-CD](${lien}).` });
  });

  it("refuse une seconde demande pendant que la première est traitée", async () => {
    const [conversation] = await conversationsDe(g);
    const maintenant = new Date();
    verifier(
      await admin
        .from("conversation")
        .update({ demande_en_cours_depuis: new Date(maintenant.getTime() - 10_000).toISOString() })
        .eq("id", conversation.id),
    );
    const agent = fauxAgent(scenarioNominal);
    const avant = await messagesDe(g);
    expect(await demander(g, agent.client, "Encore ?", { maintenant })).toEqual([
      { type: "erreur", erreur: MESSAGES_AGENT.enCours },
    ]);
    expect(agent.envois).toEqual([]);
    expect(await messagesDe(g)).toEqual(avant);
    expect((await lireConversation(g.client, maintenant)).enCours).toBe(true);
    verifier(await admin.from("conversation").update({ demande_en_cours_depuis: null }).eq("id", conversation.id));
  });

  it("interrompt une demande trop longue, et enregistre le message qui le dit", async () => {
    const [conversation] = await conversationsDe(g);
    const agent = fauxAgent(() => []);
    agent.ajouterSession(conversation.session_id!);
    const evenements = await demander(g, agent.client, "Une question sans fin ?", { delaiMs: 300 });

    expect(evenements.at(-1)).toEqual({
      type: "message",
      message: expect.objectContaining({ role: "agent", contenu: MESSAGES_AGENT.delai, erreur: true }),
    });
    expect(agent.envois.at(-1)?.evenements).toEqual([{ type: "interruption" }]);
    expect((await conversationsDe(g))[0].demande_en_cours_depuis).toBeNull();
  });

  it("« Nouvelle conversation » termine la conversation et efface sa session ; la demande suivante en ouvre une neuve", async () => {
    const [conversation] = await conversationsDe(g);
    const agent = fauxAgent(scenarioNominal);
    agent.ajouterSession(conversation.session_id!);

    expect(await nouvelleConversation({ admin, supabase: g.client, client: agent.client })).toEqual({ ok: true });
    expect(agent.effacees).toEqual([conversation.session_id]);
    const [terminee] = await conversationsDe(g);
    expect(terminee.terminee_le).not.toBeNull();
    expect(terminee.session_effacee_le).not.toBeNull();
    expect(await lireConversation(g.client)).toEqual({ messages: [], enCours: false, etape: null });

    await demander(g, agent.client, "Qui conduit AB-123-CD ?");
    const conversations = await conversationsDe(g);
    expect(conversations).toHaveLength(2);
    expect(conversations[1].session_id).not.toBe(conversation.session_id);
    expect((await lireConversation(g.client)).messages).toHaveLength(2);
  });

  it("refuse « Nouvelle conversation » pendant une demande, et laisse la purge effacer une session restée", async () => {
    const conversations = await conversationsDe(g);
    const enCours = conversations.at(-1)!;
    verifier(
      await admin.from("conversation").update({ demande_en_cours_depuis: new Date().toISOString() }).eq("id", enCours.id),
    );
    const agent = fauxAgent();
    expect(await nouvelleConversation({ admin, supabase: g.client, client: agent.client })).toEqual({
      ok: false,
      erreur: MESSAGES_AGENT.enCours,
    });

    verifier(await admin.from("conversation").update({ demande_en_cours_depuis: null }).eq("id", enCours.id));
    agent.echouerEffacement(enCours.session_id!);
    expect(await nouvelleConversation({ admin, supabase: g.client, client: agent.client })).toEqual({ ok: true });
    expect((await conversationsDe(g)).at(-1)).toMatchObject({ session_effacee_le: null });
    expect((await conversationsDe(g)).at(-1)?.terminee_le).not.toBeNull();
  });
});

describe("le contexte de l'écran, les étapes et « Arrêter » (phase 28)", () => {
  let g: Gestionnaire;
  let autre: Gestionnaire;
  let flotte: Awaited<ReturnType<typeof semerFlotte>>;
  let flotteAutre: Awaited<ReturnType<typeof semerFlotte>>;

  beforeAll(async () => {
    [g, autre] = await Promise.all([compte("contexte"), compte("contexte-autre")]);
    [flotte, flotteAutre] = await Promise.all([semerFlotte(g, "CT-123-AB"), semerFlotte(autre, "CT-456-AB")]);
  });

  /** La conversation en cours, lue hors RLS : l'étape, le verrou et l'arrêt demandé. */
  async function suivi() {
    return verifier(
      await admin
        .from("conversation")
        .select("id, etape, demande_en_cours_depuis, arret_demande, session_id")
        .eq("entreprise_id", g.entrepriseId)
        .is("terminee_le", null)
        .maybeSingle(),
    );
  }

  async function messagesAvecContexte() {
    return verifier(
      await admin
        .from("message")
        .select("role, contenu, erreur, arret, contexte")
        .eq("entreprise_id", g.entrepriseId)
        .order("cree_le"),
    );
  }

  it("enregistre le contexte avec la demande, joint sa note, et garde le lien vers l'élément de l'écran", async () => {
    const { numero } = verifier(await admin.from("avis").select("numero").eq("id", flotte.avis).single());
    const avis = `/avis/${flotte.avis}`;
    const vehicule = `/flotte/vehicules/${flotte.vehicule}`;
    // Sans appeler d'outil, l'agent cite l'avis de l'écran et son véhicule : la note lui a donné leurs liens.
    const agent = fauxAgent(() => [messageAgent(`[Cet avis](${avis}) vise [CT-123-AB](${vehicule}).`), { type: "fin" }]);
    const maintenant = new Date();
    const evenements = await demander(g, agent.client, "Que dit cet avis ?", {
      maintenant,
      contexte: { type: "avis", id: flotte.avis },
    });

    const contexte = { type: "avis", id: flotte.avis, libelle: `avis n° ${numero}` };
    expect(agent.envois[0].evenements).toEqual([
      {
        type: "demande",
        texte: "Que dit cet avis ?",
        contexte: [
          contexteDate(maintenant),
          noteContexte({ type: "avis", id: flotte.avis, libelle: `avis n° ${numero}` }, {
            vehicule: { id: flotte.vehicule, libelle: "CT-123-AB" },
          }),
        ].join("\n\n"),
      },
    ]);
    expect(await messagesAvecContexte()).toEqual([
      { role: "gestionnaire", contenu: "Que dit cet avis ?", erreur: false, arret: false, contexte },
      { role: "agent", contenu: `[Cet avis](${avis}) vise [CT-123-AB](${vehicule}).`, erreur: false, arret: false, contexte: null },
    ]);
    expect(evenements.at(-1)).toMatchObject({ type: "message", message: { contenu: `[Cet avis](${avis}) vise [CT-123-AB](${vehicule}).` } });
    // Le panneau relit le contexte avec la conversation.
    expect((await lireConversation(g.client)).messages[0]).toMatchObject({ contexte, arret: false });
  });

  it("ignore l'élément d'une autre entreprise : ni contexte, ni lien", async () => {
    const lien = `/avis/${flotteAutre.avis}`;
    const agent = fauxAgent(() => [messageAgent(`Voir [l'avis](${lien}).`), { type: "fin" }]);
    const conversation = await suivi();
    agent.ajouterSession(conversation!.session_id!);
    await demander(g, agent.client, "Et cet avis ?", { contexte: { type: "avis", id: flotteAutre.avis } });

    expect(agent.envois[0].evenements[0]).toMatchObject({ contexte: expect.stringContaining(noteContexte(null)) });
    expect((await messagesAvecContexte()).slice(-2)).toEqual([
      { role: "gestionnaire", contenu: "Et cet avis ?", erreur: false, arret: false, contexte: null },
      { role: "agent", contenu: "Voir l'avis.", erreur: false, arret: false, contexte: null },
    ]);
  });

  it("signale chaque étape dans l'ordre des appels d'outil, avant la réponse, puis la vide", async () => {
    const conversation = await suivi();
    let tours = 0;
    const agent = fauxAgent((envoyes) => {
      if (!envoyes.some(({ type }) => type === "demande" || type === "resultat")) return [];
      tours += 1;
      if (tours === 1) {
        const [chercher, planning] = [idEvenement(), idEvenement()];
        return [
          { type: "outil", id: chercher, nom: "chercher_vehicules", entree: { texte: "CT-123" } },
          { type: "outil", id: planning, nom: "lister_affectations", entree: { vehicule_id: flotte.vehicule } },
          { type: "attente", ids: [chercher, planning] },
        ];
      }
      return [messageAgent("Karim Benali le conduit."), { type: "fin" }];
    });
    agent.ajouterSession(conversation!.session_id!);
    const evenements = await demander(g, agent.client, "Qui conduit ce véhicule ?", {
      contexte: { type: "vehicule", id: flotte.vehicule },
    });

    expect(evenements.map(({ type }) => type)).toEqual(["attente", "etape", "etape", "message"]);
    expect(evenements.filter((e) => e.type === "etape")).toEqual([
      { type: "etape", texte: "Je cherche CT-123 dans les véhicules…" },
      { type: "etape", texte: "Je consulte le planning de CT-123-AB…" },
    ]);
    // Sur un véhicule, « ce conducteur » est celui de l'affectation en cours.
    expect(agent.envois[0].evenements[0]).toMatchObject({
      contexte: expect.stringContaining(`« Ce conducteur » désigne Karim Benali (conducteur_id : ${flotte.conducteur}`),
    });
    expect(await suivi()).toMatchObject({ etape: null, demande_en_cours_depuis: null });
    expect((await lireConversation(g.client)).etape).toBeNull();
  });

  it("filtre lister_avis par id, même pour un avis sans n°, et seulement dans l'entreprise", async () => {
    verifier(await admin.from("avis").update({ numero: null }).eq("id", flotte.avis));
    const { contenu } = await executerOutil(ctx(g), "lister_avis", { avis_id: flotte.avis });
    expect(JSON.parse(contenu)).toMatchObject({ total: 1, avis: [{ id: flotte.avis, numero: null, plaque: "CT-123-AB" }] });
    const ailleurs = await executerOutil(ctx(g), "lister_avis", { avis_id: flotteAutre.avis });
    expect(JSON.parse(ailleurs.contenu)).toMatchObject({ total: 0, avis: [] });
  });

  it("« Arrêter » interrompt la demande en quelques secondes, expire son récapitulatif et écarte sa réponse partielle", async () => {
    const conversation = await suivi();
    let demandes = 0;
    const agent = fauxAgent((envoyes) => {
      if (envoyes.some(({ type }) => type === "demande")) {
        demandes += 1;
        if (demandes > 1) return [messageAgent("Voici la suite."), { type: "fin" }];
        const outil = idEvenement();
        return [
          {
            type: "outil",
            id: outil,
            nom: "proposer_modifications",
            entree: { modifications: [{ operation: "creer_vehicule", plaque: "AR-123-ET", type: "attitre" }] },
          },
          { type: "attente", ids: [outil] },
        ];
      }
      // Après le récapitulatif, l'agent écrit un début de réponse, puis ne finit jamais.
      if (envoyes.some(({ type }) => type === "resultat")) return [messageAgent("Voici les modifications prévues, et")];
      return [];
    });
    agent.ajouterSession(conversation!.session_id!);
    const { demandes: avant } = verifier(
      await admin.from("usage_agent").select("demandes").eq("entreprise_id", g.entrepriseId).single(),
    );

    const evenements: EvenementDemande[] = [];
    const traitement = traiterDemande({
      admin,
      supabase: g.client,
      client: agent.client,
      texte: "Ajoute AR-123-ET",
      surEvenement: (e) => evenements.push(e),
    });
    // L'étape est écrite sur la conversation : un panneau rouvert la relit.
    await expect.poll(async () => (await suivi())?.etape, { timeout: 5000 }).toBe("Je prépare le récapitulatif…");
    expect((await lireConversation(g.client)).etape).toBe("Je prépare le récapitulatif…");
    await expect
      .poll(async () => verifier(await admin.from("recapitulatif").select("statut").eq("conversation_id", conversation!.id).eq("statut", "propose")).length)
      .toBe(1);

    const debut = Date.now();
    expect(await arreterDemande({ admin, supabase: g.client })).toEqual({ ok: true });
    expect((await suivi())?.arret_demande).not.toBeNull();
    await traitement;
    expect(Date.now() - debut).toBeLessThan(3000);

    expect(agent.envois.at(-1)?.evenements).toEqual([{ type: "interruption" }]);
    expect(evenements.at(-1)).toEqual({
      type: "message",
      message: expect.objectContaining({ role: "agent", contenu: MESSAGES_AGENT.arretee, arret: true, erreur: false }),
    });
    expect((await messagesAvecContexte()).slice(-2)).toEqual([
      { role: "gestionnaire", contenu: "Ajoute AR-123-ET", erreur: false, arret: false, contexte: null },
      { role: "agent", contenu: MESSAGES_AGENT.arretee, erreur: false, arret: true, contexte: null },
    ]);
    const recapitulatifs = verifier(await admin.from("recapitulatif").select("statut, message_id").eq("conversation_id", conversation!.id));
    expect(recapitulatifs).toEqual([{ statut: "expire", message_id: null }]);
    expect(await suivi()).toMatchObject({ etape: null, demande_en_cours_depuis: null });
    expect(await lireConversation(g.client)).toMatchObject({ enCours: false, etape: null });
    // La demande arrêtée reste comptée.
    expect(verifier(await admin.from("usage_agent").select("demandes").eq("entreprise_id", g.entrepriseId).single())).toEqual({
      demandes: avant + 1,
    });

    // La demande suivante porte la note d'arrêt, et la réponse partielle n'est jamais enregistrée.
    const envoisAvant = agent.envois.length;
    await demander(g, agent.client, "Finalement, non.");
    const envoiSuivant = agent.envois.slice(envoisAvant).find(({ evenements: e }) => e[0]?.type === "demande");
    expect(envoiSuivant?.evenements[0]).toMatchObject({ contexte: expect.stringContaining(NOTE_ARRET) });
    const contenus = (await messagesAvecContexte()).map(({ contenu }) => contenu);
    expect(contenus.slice(-4)).toEqual(["Ajoute AR-123-ET", MESSAGES_AGENT.arretee, "Finalement, non.", "Voici la suite."]);
    expect(contenus.join(" ")).not.toContain("Voici les modifications prévues");
    // La note d'arrêt ne part qu'une fois.
    await demander(g, agent.client, "Merci.");
    expect(agent.envois.at(-1)?.evenements[0]).not.toMatchObject({ contexte: expect.stringContaining(NOTE_ARRET) });
  }, 15_000);

  it("« Arrêter » sans demande en cours ne fait rien", async () => {
    const avant = await suivi();
    expect(avant?.demande_en_cours_depuis).toBeNull();
    const arretAvant = avant?.arret_demande ?? null;
    expect(await arreterDemande({ admin, supabase: g.client })).toEqual({ ok: true });
    expect((await suivi())?.arret_demande ?? null).toBe(arretAvant);

    const neuf = await compte("arret-vide");
    expect(await arreterDemande({ admin, supabase: neuf.client })).toEqual({ ok: true });
    expect(await conversationsDe(neuf)).toEqual([]);
  });
});

describe("une demande coupée net", () => {
  it("est rattrapée par la suivante : l'outil resté sans réponse reçoit une erreur, et sa réponse est enregistrée", async () => {
    const g = await compte("coupee");
    const sessionId = `sesn_coupee_${suffixe}`;
    const orphelin = idEvenement();
    const il = (secondes: number) => new Date(Date.now() - secondes * 1000).toISOString();
    // La demande précédente a planté pendant l'outil : son verrou est resté, sa réponse manque.
    const conversation = verifier(
      await admin
        .from("conversation")
        .insert({
          entreprise_id: g.entrepriseId,
          session_id: sessionId,
          debut: il(600),
          premiere_demande: "Coupée ?",
          demande_en_cours_depuis: il(400),
        })
        .select("id")
        .single(),
    );
    verifier(
      await admin.from("message").insert({
        conversation_id: conversation.id,
        entreprise_id: g.entrepriseId,
        role: "gestionnaire",
        contenu: "Coupée ?",
        cree_le: il(400),
      }),
    );
    const agent = fauxAgent((envoyes) => {
      const resultat = envoyes.find((e) => e.type === "resultat");
      if (resultat?.type === "resultat" && resultat.outilId === orphelin) {
        return [messageAgent("La recherche a été interrompue.", il(300)), { type: "fin" }];
      }
      if (envoyes.some(({ type }) => type === "demande")) return [messageAgent("Nouvelle réponse."), { type: "fin" }];
      return [];
    });
    agent.ajouterSession(sessionId, [
      { type: "demande", id: idEvenement() },
      { type: "outil", id: orphelin, nom: "lister_avis", entree: {} },
      { type: "attente", ids: [orphelin] },
    ]);

    await demander(g, agent.client, "Et alors ?");
    expect(agent.envois[0].evenements).toEqual([
      { type: "resultat", outilId: orphelin, contenu: JSON.stringify({ erreur: MESSAGES_AGENT.interrompue }), erreur: true },
    ]);
    expect((await messagesDe(g)).map(({ role, contenu }) => [role, contenu])).toEqual([
      ["gestionnaire", "Coupée ?"],
      ["agent", "La recherche a été interrompue."],
      ["gestionnaire", "Et alors ?"],
      ["agent", "Nouvelle réponse."],
    ]);
    expect((await conversationsDe(g))[0].demande_en_cours_depuis).toBeNull();

    // Un rattrapage relancé n'enregistre pas deux fois la même réponse.
    verifier(await admin.from("conversation").update({ demande_en_cours_depuis: il(400) }).eq("id", conversation.id));
    await demander(g, agent.client, "Encore une ?");
    expect((await messagesDe(g)).map(({ contenu }) => contenu).slice(-3)).toEqual([
      "Nouvelle réponse.",
      "Encore une ?",
      "Nouvelle réponse.",
    ]);
    expect(await messagesDe(g)).toHaveLength(6);
  });
});

describe("le plan", () => {
  it("ne traite rien en Free", async () => {
    const g = await compte("free", { pro: false });
    const agent = fauxAgent(scenarioNominal);
    expect(await demander(g, agent.client, "Qui conduit AB-123-CD ?")).toEqual([{ type: "erreur", erreur: MESSAGES_AGENT.pro }]);
    expect(agent.sessions.size).toBe(0);
    expect(await conversationsDe(g)).toEqual([]);
  });

  it("ne traite plus rien au retour en Free, sans toucher à la conversation", async () => {
    const g = await compte("retour-free");
    const agent = fauxAgent(scenarioNominal);
    await semerFlotte(g, "RF-123-AB");
    await demander(g, agent.client, "Qui conduit RF-123-AB ?");
    verifier(await admin.from("entreprise").update({ plan: "free" }).eq("id", g.entrepriseId));

    const avant = await messagesDe(g);
    expect(await demander(g, agent.client, "Et maintenant ?")).toEqual([{ type: "erreur", erreur: MESSAGES_AGENT.pro }]);
    expect(await messagesDe(g)).toEqual(avant);
  });
});

describe("la purge à 30 jours", () => {
  const il = (jours: number) => new Date(Date.now() - jours * 86_400_000).toISOString();
  const session = (nom: string) => `sesn_purge_${nom}_${suffixe}`;

  it("refuse un appel sans le secret, et répond 503 sans agent configuré", async () => {
    expect((await purgeRoute(new Request("http://localhost/api/cron/purge-conversations"))).status).toBe(401);
    const autorise = new Request("http://localhost/api/cron/purge-conversations", {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    });
    expect((await purgeRoute(autorise)).status).toBe(503);
  });

  it("efface chez Anthropic, puis en base, ce qui a plus de 30 jours ; relancée, elle ne fait rien de plus", async () => {
    const [p, q] = await Promise.all([compte("purge-p"), compte("purge-q")]);
    const inserer = async (g: Gestionnaire, ligne: Record<string, unknown>) =>
      verifier(await admin.from("conversation").insert({ entreprise_id: g.entrepriseId, ...ligne }).select("id").single()).id;

    const vieille = await inserer(p, { debut: il(31), session_id: session("vieille") });
    verifier(await admin.from("message").insert({ conversation_id: vieille, entreprise_id: p.entrepriseId, role: "gestionnaire", contenu: "Ancienne" }));
    const terminee = await inserer(p, { debut: il(2), terminee_le: il(1), session_id: session("terminee") });
    const sansSession = await inserer(p, { debut: il(40), terminee_le: il(39) });
    const enPanne = await inserer(p, { debut: il(35), terminee_le: il(34), session_id: session("panne") });
    const recente = await inserer(q, { debut: il(3), session_id: session("recente") });

    const agent = fauxAgent();
    agent.echouerEffacement(session("panne"));
    const bilan = await purgerConversations({ admin, client: agent.client });
    expect(agent.effacees).toEqual(expect.arrayContaining([session("vieille"), session("terminee")]));
    expect(agent.effacees).not.toContain(session("recente"));
    expect(bilan.echecs).toBeGreaterThanOrEqual(1);

    const restantes = verifier(
      await admin
        .from("conversation")
        .select("id, session_effacee_le")
        .in("id", [vieille, terminee, sansSession, enPanne, recente]),
    );
    expect(restantes.map(({ id }) => id).toSorted()).toEqual([terminee, enPanne, recente].toSorted());
    expect(restantes.find(({ id }) => id === terminee)?.session_effacee_le).not.toBeNull();
    expect(restantes.find(({ id }) => id === enPanne)?.session_effacee_le).toBeNull();
    expect(verifier(await admin.from("message").select("id").eq("conversation_id", vieille))).toEqual([]);

    const effaceesAvant = agent.effacees.length;
    await purgerConversations({ admin, client: agent.client });
    expect(agent.effacees.slice(effaceesAvant)).not.toEqual(expect.arrayContaining([session("vieille")]));
    expect(agent.effacees.slice(effaceesAvant)).not.toContain(session("terminee"));
  });
});

describe("l'historique (phase 32)", () => {
  const il = (jours: number) => new Date(Date.now() - jours * 86_400_000).toISOString();
  const dans = (jours: number) => new Date(Date.now() + jours * 86_400_000);
  let h: Gestionnaire;
  let autre: Gestionnaire;
  // La conversation en cours, une terminée avec 2 récapitulatifs appliqués, une sans demande, une de 29 jours et une
  // de 31 jours, encore en base : la purge n'est pas passée.
  const ids = {} as Record<"enCours" | "recente" | "sansDemande" | "ancienne" | "expiree", string>;
  const recapsDe = {} as Record<"ancienne" | "expiree", string>;
  let propose31: string;

  async function inserer(g: Gestionnaire, ligne: Record<string, unknown>) {
    return verifier(await admin.from("conversation").insert({ entreprise_id: g.entrepriseId, ...ligne }).select("id").single()).id;
  }

  async function message(g: Gestionnaire, conversation_id: string, role: "gestionnaire" | "agent", contenu: string) {
    return verifier(
      await admin.from("message").insert({ conversation_id, entreprise_id: g.entrepriseId, role, contenu }).select("id").single(),
    ).id;
  }

  /** Les lignes d'un archivage, préparées sous la session du gestionnaire, comme l'outil de l'agent. */
  async function lignesArchivage(g: Gestionnaire, conducteur_id: string) {
    const entrees: EntreeModification[] = [{ operation: "archiver_conducteur", conducteur_id }];
    const preparation = preparerRecapitulatif(await lireInstantane(g.client, ciblesDesEntrees(entrees)), entrees);
    if (!preparation.ok) throw new Error(JSON.stringify(preparation.motifs));
    return preparation.lignes;
  }

  /** Un récapitulatif semé hors RLS dans une conversation, sous une réponse de l'agent ; son statut suit le trigger. */
  async function recapitulatif(g: Gestionnaire, conversation_id: string, lignes: unknown) {
    const message_id = await message(g, conversation_id, "agent", "Voici le récapitulatif.");
    return verifier(
      await admin
        .from("recapitulatif")
        .insert({ entreprise_id: g.entrepriseId, conversation_id, message_id, lignes })
        .select("id")
        .single(),
    ).id;
  }

  beforeAll(async () => {
    [h, autre] = await Promise.all([compte("histo"), compte("histo-autre")]);
    const [paul, jeanne] = verifier(
      await admin
        .from("conducteur")
        .insert([
          { entreprise_id: h.entrepriseId, prenom: "Paul", nom: "Martin" },
          { entreprise_id: h.entrepriseId, prenom: "Jeanne", nom: "Roux" },
        ])
        .select("id, prenom")
        .order("prenom", { ascending: false }),
    ).map(({ id }) => id);
    // Les lignes semées dans les autres conversations : elles n'y sont jamais appliquées.
    const semees = await lignesArchivage(h, paul);

    // Deux archivages proposés, puis confirmés par le gestionnaire, avant « Nouvelle conversation ».
    const recente = await conversationEnCours(admin, h.entrepriseId, new Date());
    ids.recente = recente.id;
    verifier(await admin.from("conversation").update({ premiere_demande: "Archive Paul et Jeanne" }).eq("id", recente.id));
    await message(h, recente.id, "gestionnaire", "Archive Paul et Jeanne");
    for (const conducteur of [paul, jeanne]) {
      const { id } = await enregistrerRecapitulatif(admin, recente, await lignesArchivage(h, conducteur));
      const reponse = await message(h, recente.id, "agent", "Voici le récapitulatif.");
      await rattacherRecapitulatifs(admin, recente.id, reponse);
      expect((await confirmerRecapitulatif(h.client, id)).ok).toBe(true);
    }
    verifier(await admin.from("conversation").update({ debut: il(5), terminee_le: il(4) }).eq("id", recente.id));


    ids.sansDemande = await inserer(h, { debut: il(3), terminee_le: il(3) });
    ids.ancienne = await inserer(h, { debut: il(29), terminee_le: il(28), premiere_demande: "Ancienne" });
    await message(h, ids.ancienne, "gestionnaire", "Ancienne");
    recapsDe.ancienne = await recapitulatif(h, ids.ancienne, semees);
    ids.expiree = await inserer(h, { debut: il(31), terminee_le: il(30), premiere_demande: "Expirée" });
    await message(h, ids.expiree, "gestionnaire", "Expirée");
    recapsDe.expiree = await recapitulatif(h, ids.expiree, semees);
    // Plus ancienne que la précédente : la conversation en cours reste en tête de la liste.
    ids.enCours = await inserer(h, { debut: il(6), premiere_demande: "En cours" });
    await message(h, ids.enCours, "gestionnaire", "En cours");

    // Une conversation de 31 jours jamais terminée, avec un récapitulatif encore en attente.
    const vieille = await inserer(autre, { debut: il(31), premiere_demande: "Vieille" });
    propose31 = await recapitulatif(autre, vieille, semees);
  });

  it("liste les conversations des 30 derniers jours qui ont une demande, la conversation en cours en tête", async () => {
    const liste = await listerConversations(h.client);
    expect(liste.map(({ id, premiereDemande, enCours, appliques }) => ({ id, premiereDemande, enCours, appliques }))).toEqual([
      { id: ids.enCours, premiereDemande: "En cours", enCours: true, appliques: 0 },
      { id: ids.recente, premiereDemande: "Archive Paul et Jeanne", enCours: false, appliques: 2 },
      { id: ids.ancienne, premiereDemande: "Ancienne", enCours: false, appliques: 0 },
    ]);
    expect(Date.parse(liste[2].debut)).toBeLessThan(Date.parse(liste[1].debut));

    // Deux jours plus tard, la conversation de 29 jours sort de la liste, même avant la purge.
    expect((await listerConversations(h.client, dans(2))).map(({ id }) => id)).toEqual([ids.enCours, ids.recente]);
    expect(await listerConversations(autre.client)).toEqual([]);
  });

  it("rouvre une conversation terminée avec ses messages et ses récapitulatifs appliqués", async () => {
    const passee = await lireConversationPassee(h.client, ids.recente);
    expect(passee).not.toBeNull();
    expect(passee!.messages.map(({ role, contenu, recapitulatif }) => [role, contenu, recapitulatif?.statut ?? null])).toEqual([
      ["gestionnaire", "Archive Paul et Jeanne", null],
      ["agent", "Voici le récapitulatif.", "applique"],
      ["agent", "Voici le récapitulatif.", "applique"],
    ]);
    expect(passee!.messages[1].recapitulatif?.applique_le).not.toBeNull();
    expect((await lireConversationPassee(h.client, ids.ancienne))?.messages[1].recapitulatif?.id).toBe(recapsDe.ancienne);
  });

  it("ne rouvre ni la conversation en cours, ni celle d'une autre entreprise, ni une conversation de plus de 30 jours", async () => {
    expect(await lireConversationPassee(h.client, ids.enCours)).toBeNull();
    expect(await lireConversationPassee(autre.client, ids.recente)).toBeNull();
    expect(await lireConversationPassee(h.client, ids.expiree)).toBeNull();
    expect(await lireConversationPassee(h.client, ids.ancienne, dans(2))).toBeNull();
    expect(await lireConversationPassee(h.client, "pas-un-id")).toBeNull();
  });

  it("coupe à 30 jours dans la RLS : rien d'une conversation plus ancienne ne se lit, même encore en base", async () => {
    const sous = async (g: Gestionnaire, conversation: string) => ({
      conversation: verifier(await g.client.from("conversation").select("id").eq("id", conversation)).length,
      messages: verifier(await g.client.from("message").select("id").eq("conversation_id", conversation)).length,
      recapitulatifs: verifier(await g.client.from("recapitulatif").select("id").eq("conversation_id", conversation)).length,
    });
    expect(await sous(h, ids.expiree)).toEqual({ conversation: 0, messages: 0, recapitulatifs: 0 });
    expect(await sous(h, ids.ancienne)).toEqual({ conversation: 1, messages: 2, recapitulatifs: 1 });
    expect(verifier(await admin.from("message").select("id").eq("conversation_id", ids.expiree))).toHaveLength(2);
    expect(verifier(await admin.from("recapitulatif").select("id").eq("id", recapsDe.expiree))).toHaveLength(1);
  });

  it("n'annule plus un récapitulatif resté en attente dans une conversation de plus de 30 jours", async () => {
    expect(await annulerRecapitulatif(autre.client, propose31)).toEqual({ ok: false, erreur: MESSAGES_RECAPITULATIF.plusApplicable });
    expect(verifier(await admin.from("recapitulatif").select("statut").eq("id", propose31).single()).statut).toBe("propose");
  });
});

describe("les outils sur le compte de démonstration", () => {
  let d: Gestionnaire;
  let ids: IdsDemo;
  const outil = async (nom: string, entree: object) => {
    const { contenu, erreur } = await executerOutil(ctx(d, MAINTENANT_DEMO), nom, entree);
    expect(erreur, contenu).toBe(false);
    return JSON.parse(contenu);
  };

  beforeAll(async () => {
    d = await compte("demo", { pro: false });
    ids = await creerFlotteDemo(admin, d.entrepriseId, PNG);
  }, 60_000);

  it("donne les avis bloqués attendus par l'évaluation, et leurs motifs", async () => {
    const { total, avis } = await outil("lister_avis", { bloques_seulement: true });
    expect(total).toBe(12);
    const rangs = (avis as { id: string }[]).map(({ id }) => Number(Object.entries(ids.avis).find(([, v]) => v === id)![0]));
    expect(rangs.toSorted((x, y) => x - y)).toEqual([20, 21, 22, 23, 26, 27, 28, 29, 30, 31, 33, 40]);
    const motifs = (avis as { numero: string; blocages: { motif: string }[] }[]).flatMap(({ blocages }) => blocages.map(({ motif }) => motif));
    expect(motifs.join(" ")).toContain("Sarah Lefèvre");
    expect(motifs.join(" ")).toContain("Julien Morel conduisait KL-123-MN");
    expect(motifs.join(" ")).toContain("ZZ-999-ZZ");
  });

  it("donne le conducteur à un instant, ou les voisins sans affectation", async () => {
    const vehicule = (plaque: string) => ids.vehicules[plaque];
    expect(await outil("conducteur_au_moment", { vehicule_id: vehicule("AB-123-CD"), date: "2026-03-12", heure: "08:00" })).toMatchObject({
      affectation: { conducteur: { nom: "Karim Benali" } },
    });
    expect(await outil("conducteur_au_moment", { vehicule_id: vehicule("KL-123-MN"), date: "2026-08-20", heure: "09:15" })).toMatchObject({
      affectation: null,
      message: "Aucune affectation sur KL-123-MN le 20/08/2026 à 09:15.",
      avant: { conducteur: { nom: "Julien Morel" } },
      apres: { conducteur: { nom: "Chloé Bonnet" } },
    });
  });

  it("donne les fiches incomplètes, les totaux et les avis par n°", async () => {
    const { conducteurs } = await outil("chercher_conducteurs", {});
    expect((conducteurs as { nom: string; fiche: string }[]).filter(({ fiche }) => fiche === "incomplète").map(({ nom }) => nom)).toEqual([
      "Inès Garnier",
      "Sarah Lefèvre",
      "Manon Rousseau",
    ]);
    expect(await outil("lister_avis", { statut: "classe" })).toMatchObject({ total: 4, montant_total: formaterMontant(37300) });
    expect(await outil("lister_avis", { statut: "a_valider" })).toMatchObject({ total: 17 });
    expect(await outil("lister_avis", { numero: numeroAvis(13) })).toMatchObject({
      total: 1,
      avis: [{ statut: "Désigné", conducteur_valide: { nom: "Hugo Blanc" } }],
    });
    const { avis } = await outil("lister_avis", { numero: numeroAvis(28) });
    expect(avis[0]).toMatchObject({ echeance: "12/10/2026", jours_restants: "J+19", echeance_depassee: true });
  });
});
