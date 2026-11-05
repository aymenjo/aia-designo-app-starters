import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMANDES_AGENT_PAR_MOIS } from "@/lib/abonnement/plans";
import { purgerConversations } from "@/lib/agent/conversations";
import { traiterDemande, type EvenementDemande } from "@/lib/agent/demande";
import { MESSAGES_AGENT, moisDemandes, remiseAZeroDemandes } from "@/lib/agent/regles";
import { compterDemande, lireDemandesDuMois } from "@/lib/agent/usage";
import { instantParis } from "@/lib/dates";
import { fauxAgent, messageAgent, type Scenario } from "../agent";
import { admin, passerEnPro, premiereConnexion, suffixeUnique, supprimerGestionnaire, type Gestionnaire } from "./outils";

// La limite de 100 demandes par mois de Demande à Désigno (phase 27), sur le Supabase local, avec le faux Claude Managed
// Agents de tests/agent.ts : une demande compte dès qu'elle est acceptée, même si Désigno échoue ensuite ; un refus qui ne
// laisse aucune trace ne compte pas.

const suffixe = suffixeUnique();
const gestionnaires: Gestionnaire[] = [];

afterAll(async () => {
  for (const g of gestionnaires) await supprimerGestionnaire(g);
});

async function compte(nom: string, { pro = true } = {}) {
  const g = await premiereConnexion(`limite-${nom}-${suffixe}@exemple.fr`);
  gestionnaires.push(g);
  if (pro) await passerEnPro(g.entrepriseId);
  return g;
}

function verifier<T>({ data, error }: { data: T; error: unknown }): NonNullable<T> {
  if (error) throw error;
  return data as NonNullable<T>;
}

/** Une demande, avec ce que la route en renverrait au panneau. */
async function demander(
  g: Gestionnaire,
  client: ReturnType<typeof fauxAgent>["client"],
  texte: string,
  options: { maintenant?: Date; delaiMs?: number } = {},
) {
  const evenements: EvenementDemande[] = [];
  await traiterDemande({ admin, supabase: g.client, client, texte, surEvenement: (e) => evenements.push(e), ...options });
  return evenements;
}

/** L'agent répond tout de suite, sans outil. */
const repond: Scenario = (envoyes) =>
  envoyes.some(({ type }) => type === "demande") ? [messageAgent("Aucune affectation."), { type: "fin" }] : [];

async function semerUsage(g: Gestionnaire, demandes: number, mois = moisDemandes(new Date())) {
  verifier(await admin.from("usage_agent").upsert({ entreprise_id: g.entrepriseId, mois, demandes }));
}

async function usageDe(g: Gestionnaire) {
  return verifier(
    await admin.from("usage_agent").select("mois, demandes").eq("entreprise_id", g.entrepriseId).order("mois"),
  );
}

async function messagesDe(g: Gestionnaire) {
  return verifier(await admin.from("message").select("role, contenu, erreur").eq("entreprise_id", g.entrepriseId).order("cree_le"));
}

async function conversationDe(g: Gestionnaire) {
  return verifier(
    await admin
      .from("conversation")
      .select("id, session_id, demande_en_cours_depuis")
      .eq("entreprise_id", g.entrepriseId)
      .is("terminee_le", null)
      .maybeSingle(),
  );
}

describe("ce qui compte", () => {
  let g: Gestionnaire;

  beforeAll(async () => {
    g = await compte("compte");
  });

  it("compte une demande acceptée, même si Désigno échoue ou dépasse le délai ; « attente » porte le total", async () => {
    const evenements = await demander(g, fauxAgent(repond).client, "Qui avait AB-123-CD ?");
    expect(evenements[0]).toEqual({ type: "attente", demandes: 1 });
    expect(evenements.at(-1)).toMatchObject({ type: "message", message: { role: "agent", erreur: false } });

    // L'agent échoue : la réponse est une erreur, et la demande compte.
    const { session_id } = await conversationDe(g);
    const enEchec = fauxAgent((envoyes) => (envoyes.some(({ type }) => type === "demande") ? [{ type: "echec", raison: "panne" }] : []));
    enEchec.ajouterSession(session_id!);
    expect((await demander(g, enEchec.client, "Et ensuite ?"))[0]).toEqual({ type: "attente", demandes: 2 });

    // Le délai est dépassé : la demande compte encore.
    const muet = fauxAgent(() => []);
    muet.ajouterSession(session_id!);
    const evenementsDelai = await demander(g, muet.client, "Une question sans fin ?", { delaiMs: 300 });
    expect(evenementsDelai[0]).toEqual({ type: "attente", demandes: 3 });
    expect(evenementsDelai.at(-1)).toMatchObject({ type: "message", message: { contenu: MESSAGES_AGENT.delai, erreur: true } });

    expect(await lireDemandesDuMois(g.client)).toBe(3);
    expect(await usageDe(g)).toEqual([{ mois: moisDemandes(new Date()), demandes: 3 }]);
  });

  it("ne compte pas un refus sans trace : demande vide, demande précédente en cours, plan Free", async () => {
    const agent = fauxAgent(repond);
    expect(await demander(g, agent.client, "   ")).toEqual([{ type: "erreur", erreur: MESSAGES_AGENT.vide }]);

    const { id } = await conversationDe(g);
    verifier(await admin.from("conversation").update({ demande_en_cours_depuis: new Date().toISOString() }).eq("id", id));
    expect(await demander(g, agent.client, "Encore ?")).toEqual([{ type: "erreur", erreur: MESSAGES_AGENT.enCours }]);
    verifier(await admin.from("conversation").update({ demande_en_cours_depuis: null }).eq("id", id));
    expect(await lireDemandesDuMois(g.client)).toBe(3);

    const free = await compte("free", { pro: false });
    expect(await demander(free, agent.client, "Qui avait AB-123-CD ?")).toEqual([{ type: "erreur", erreur: MESSAGES_AGENT.pro }]);
    expect(await lireDemandesDuMois(free.client)).toBe(0);
    expect(await usageDe(free)).toEqual([]);
    expect(agent.envois).toEqual([]);
  });

  it("garde le compteur quand la purge à 30 jours efface les conversations", async () => {
    const p = await compte("purge");
    await semerUsage(p, 7);
    const vieille = new Date(Date.now() - 31 * 86_400_000).toISOString();
    verifier(await admin.from("conversation").insert({ entreprise_id: p.entrepriseId, debut: vieille, terminee_le: vieille }));

    // Un Anthropic qui n'efface rien : la purge, globale, ne touche pas aux sessions des autres fichiers de test.
    const { client } = fauxAgent();
    await purgerConversations({
      admin,
      client: { ...client, effacerSession: async () => Promise.reject(new Error("hors de ce test")) },
    });
    expect(verifier(await admin.from("conversation").select("id").eq("entreprise_id", p.entrepriseId))).toEqual([]);
    expect(await lireDemandesDuMois(p.client)).toBe(7);
  });
});

describe("la limite", () => {
  it("laisse passer la 100ᵉ demande, puis refuse la 101ᵉ sans rien enregistrer ni appeler l'agent", async () => {
    const g = await compte("cent");
    await semerUsage(g, DEMANDES_AGENT_PAR_MOIS - 1);
    const maintenant = new Date();

    const centieme = await demander(g, fauxAgent(repond).client, "La centième ?", { maintenant });
    expect(centieme[0]).toEqual({ type: "attente", demandes: DEMANDES_AGENT_PAR_MOIS });
    expect(centieme.at(-1)).toMatchObject({ type: "message", message: { role: "agent", erreur: false } });

    const agent = fauxAgent(repond);
    const avant = await messagesDe(g);
    expect(await demander(g, agent.client, "La cent unième ?", { maintenant })).toEqual([
      { type: "erreur", erreur: MESSAGES_AGENT.limite(remiseAZeroDemandes(maintenant)) },
    ]);
    expect(agent.sessions.size).toBe(0);
    expect(agent.envois).toEqual([]);
    expect(await messagesDe(g)).toEqual(avant);
    // Le verrou est libéré : la conversation reste utilisable, par exemple pour « Nouvelle conversation ».
    expect((await conversationDe(g)).demande_en_cours_depuis).toBeNull();
    expect(await lireDemandesDuMois(g.client)).toBe(DEMANDES_AGENT_PAR_MOIS);
  });

  it("repart à zéro le 1er du mois, à minuit à Paris", async () => {
    const g = await compte("bascule");
    const retour = remiseAZeroDemandes(new Date());
    const minuit = Date.parse(instantParis(retour, "00:00")!);
    const veille = new Date(minuit - 30 * 60_000);
    const lendemain = new Date(minuit + 30 * 60_000);
    await semerUsage(g, DEMANDES_AGENT_PAR_MOIS, moisDemandes(veille));

    expect(await demander(g, fauxAgent(repond).client, "Encore une ?", { maintenant: veille })).toEqual([
      { type: "erreur", erreur: MESSAGES_AGENT.limite(retour) },
    ]);
    const evenements = await demander(g, fauxAgent(repond).client, "Encore une ?", { maintenant: lendemain });
    expect(evenements[0]).toEqual({ type: "attente", demandes: 1 });
    expect(await usageDe(g)).toEqual([
      { mois: moisDemandes(veille), demandes: DEMANDES_AGENT_PAR_MOIS },
      { mois: retour, demandes: 1 },
    ]);
  });

  it("n'accepte qu'une demande sur deux simultanées à 99", async () => {
    const g = await compte("concurrence");
    await semerUsage(g, DEMANDES_AGENT_PAR_MOIS - 1);
    const resultats = await Promise.all([compterDemande(admin, g.entrepriseId), compterDemande(admin, g.entrepriseId)]);
    expect(resultats.toSorted()).toEqual([DEMANDES_AGENT_PAR_MOIS, null]);
    expect(await lireDemandesDuMois(g.client)).toBe(DEMANDES_AGENT_PAR_MOIS);
  });
});

describe("l'isolation et l'écriture", () => {
  let a: Gestionnaire;
  let b: Gestionnaire;

  beforeAll(async () => {
    [a, b] = await Promise.all([compte("iso-a"), compte("iso-b")]);
    await Promise.all([semerUsage(a, 12), semerUsage(b, 40)]);
  });

  it("ne laisse voir à chacun que son compteur", async () => {
    expect(verifier(await a.client.from("usage_agent").select("entreprise_id, demandes"))).toEqual([
      { entreprise_id: a.entrepriseId, demandes: 12 },
    ]);
    expect(await lireDemandesDuMois(b.client)).toBe(40);
  });

  it("interdit au gestionnaire d'écrire le compteur, ou de compter lui-même", async () => {
    const mois = moisDemandes(new Date());
    const insertion = await a.client.from("usage_agent").insert({ entreprise_id: a.entrepriseId, mois: "2020-01-01", demandes: 0 });
    expect(insertion.error?.code).toBe("42501");
    const remiseAZero = await a.client.from("usage_agent").update({ demandes: 0 }).eq("entreprise_id", a.entrepriseId);
    expect(remiseAZero.error?.code).toBe("42501");
    const suppression = await a.client.from("usage_agent").delete().eq("entreprise_id", a.entrepriseId);
    expect(suppression.error?.code).toBe("42501");
    const appel = await a.client.rpc("compter_demande_agent", {
      p_entreprise_id: a.entrepriseId,
      p_mois: mois,
      p_limite: 1000,
    });
    expect(appel.error?.code).toBe("42501");
    expect(await lireDemandesDuMois(a.client)).toBe(12);
  });
});
