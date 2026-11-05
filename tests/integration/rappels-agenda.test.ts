import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as tacheAgenda } from "@/app/api/cron/agenda/route";
import { AccesAgendaRefuse, type ClientAgenda, type EvenementAgenda } from "@/lib/agenda/composio";
import { deconnecterAgenda, demarrerConnexion, enregistrerRetour, lireConnexionAgenda } from "@/lib/agenda/connexion";
import { MESSAGES_AGENDA, idEvenement } from "@/lib/agenda/regles";
import { synchroniserAgenda, synchroniserTousLesAgendas } from "@/lib/agenda/synchro";
import { classerAvis, modifierAvis, rouvrirAvis } from "@/lib/avis/avis";
import type { SaisieAvis } from "@/lib/avis/regles";
import type { Email, Envoyeur } from "@/lib/email/envoi";
import type { StatutCompte } from "@/lib/gmail/composio";
import { lireConnexionGmail } from "@/lib/gmail/connexion";
import { traiterWebhookComposio } from "@/lib/gmail/webhook";
import { SECRET_COMPOSIO, evenementExpiration, idComposio, signer } from "../composio";
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

// Les rappels Google Calendar (phase 22) sur le Supabase local, avec un faux client de l'agenda qui tient ses
// événements en mémoire : la CI ne parle jamais à Composio ni à Google. La synchronisation est appelée directement,
// comme après une action du gestionnaire ou par la tâche de la nuit.

const suffixe = suffixeUnique();
const URL_SITE = "https://designo.test";
const gestionnaires: Gestionnaire[] = [];

async function compte(nom: string, { pro = true } = {}) {
  const g = await premiereConnexion(`agenda-${nom}-${suffixe}@exemple.fr`);
  gestionnaires.push(g);
  if (pro) await passerEnPro(g.entrepriseId);
  return g;
}

afterAll(async () => {
  for (const g of gestionnaires) await supprimerGestionnaire(g);
});

let agendas = 0;
const nouvelAgenda = () => `designo-${suffixe}-${++agendas}@group.calendar.google.com`;

/**
 * Un faux agenda : ses événements, par agenda puis par id, comme Google les garde. `etat.refus` simule un accès retiré :
 * chaque appel à l'API Calendar lève alors `AccesAgendaRefuse`.
 */
function fauxAgenda({ statut = "ACTIVE", existe = true }: { statut?: StatutCompte | null; existe?: boolean } = {}) {
  const evenements = new Map<string, Map<string, EvenementAgenda>>();
  const etat = { refus: false };
  const refuser = () => {
    if (etat.refus) throw new AccesAgendaRefuse("401");
  };
  const de = (agendaId: string) => evenements.get(agendaId) ?? evenements.set(agendaId, new Map()).get(agendaId)!;
  const client = {
    lienConnexion: vi.fn(async (entrepriseId: string, urlRetour: string) => `https://composio.test/lien?u=${entrepriseId}&r=${urlRetour}`),
    statutCompte: vi.fn(async () => statut),
    adresse: vi.fn(async () => "agenda@exemple.fr"),
    agendaExiste: vi.fn(async () => existe),
    creerAgenda: vi.fn(async () => nouvelAgenda()),
    supprimerAgenda: vi.fn(async (_compte: string, agendaId: string) => {
      refuser();
      evenements.delete(agendaId);
    }),
    poserEvenement: vi.fn(async (_compte: string, agendaId: string, evenement: EvenementAgenda) => {
      refuser();
      de(agendaId).set(evenement.id, evenement);
    }),
    retirerEvenement: vi.fn(async (_compte: string, agendaId: string, id: string) => {
      refuser();
      de(agendaId).delete(id);
    }),
    supprimerCompte: vi.fn(async () => undefined),
  } satisfies ClientAgenda;
  return { client, evenements, etat };
}

/** La connexion de l'agenda d'une entreprise, comme après « Connecter Google Calendar ». */
async function connecter(g: Gestionnaire, champs: Record<string, unknown> = {}) {
  const connexion = {
    entreprise_id: g.entrepriseId,
    service: "agenda",
    compte_id: idComposio("ca"),
    email_compte: "agenda@exemple.fr",
    agenda_id: nouvelAgenda(),
    active_depuis: new Date().toISOString(),
    ...champs,
  };
  const { error } = await admin.from("connexion_google").insert(connexion);
  if (error) throw error;
  return connexion as typeof connexion & { compte_id: string; agenda_id: string };
}

const synchroniser = (g: Gestionnaire, agenda: ClientAgenda | null) =>
  synchroniserAgenda({ admin, agenda, entrepriseId: g.entrepriseId, urlSite: URL_SITE });

/** Les événements posés de l'entreprise, tels que la base les note. */
async function poses(g: Gestionnaire) {
  const { data, error } = await admin
    .from("evenement_agenda")
    .select("agenda_id, avis_id, jour, titre")
    .eq("entreprise_id", g.entrepriseId)
    .order("avis_id");
  if (error) throw error;
  return data;
}

/** Saisit des champs de l'avis sous la session du gestionnaire, comme l'écran. */
async function saisir(g: Gestionnaire, id: string, saisie: SaisieAvis) {
  const resultat = await modifierAvis(g.client, id, saisie);
  if (!resultat.ok) throw new Error(`saisie : ${JSON.stringify(resultat.erreurs)}`);
}

/** Un avis déposé, avec sa plaque et sa date d'envoi : il a une échéance. */
async function avisAvecEcheance(g: Gestionnaire, { plaque = "AG-101-AA", date_envoi = "06/10/2026" } = {}) {
  const { id } = await deposerAvis(g);
  await saisir(g, id, { plaque, date_envoi });
  return id;
}

describe("connexion de l'agenda", () => {
  let g: Gestionnaire;

  beforeEach(async () => {
    g = await compte(`connexion-${Math.random().toString(36).slice(2, 6)}`);
  });

  it("le lien de connexion est réservé au Pro, et revient sur le retour de l'agenda", async () => {
    const { client } = fauxAgenda();
    expect(await demarrerConnexion({ supabase: g.client, agenda: client, urlSite: URL_SITE })).toMatchObject({ ok: true });
    expect(client.lienConnexion).toHaveBeenCalledWith(g.entrepriseId, `${URL_SITE}/parametres/integrations/retour/agenda`);

    await admin.from("entreprise").update({ plan: "free" }).eq("id", g.entrepriseId);
    expect(await demarrerConnexion({ supabase: g.client, agenda: client, urlSite: URL_SITE })).toEqual({
      ok: false,
      erreur: MESSAGES_AGENDA.fonctionPro,
    });
    expect(await demarrerConnexion({ supabase: g.client, agenda: null, urlSite: URL_SITE })).toEqual({
      ok: false,
      erreur: MESSAGES_AGENDA.indisponible,
    });
  });

  it("le retour vérifie le compte, crée l'agenda « Désigno » et enregistre la connexion", async () => {
    const retour = (agenda: ClientAgenda, compteId = idComposio("ca")) =>
      enregistrerRetour({ supabase: g.client, admin, agenda, compteId, attente: 0 });
    expect(await retour(fauxAgenda({ statut: null }).client)).toEqual({ ok: false, erreur: MESSAGES_AGENDA.compteInconnu });
    expect(await retour(fauxAgenda({ statut: "FAILED" }).client)).toEqual({
      ok: false,
      erreur: MESSAGES_AGENDA.connexionRefusee,
    });
    expect(await retour(fauxAgenda().client, "pas-un-compte")).toMatchObject({ ok: false });

    const { client } = fauxAgenda();
    const compteId = idComposio("ca");
    expect(await retour(client, compteId)).toEqual({ ok: true, entrepriseId: g.entrepriseId, reconnecte: false });
    expect(client.creerAgenda).toHaveBeenCalledWith(compteId);
    const agendaId = await client.creerAgenda.mock.results[0].value;
    // Le gestionnaire lit sa connexion, sous sa session.
    expect((await lireConnexionAgenda(g.client)).data).toMatchObject({
      compte_id: compteId,
      email_compte: "agenda@exemple.fr",
      agenda_id: agendaId,
      active_depuis: expect.any(String),
      interrompue_le: null,
    });
    // Le même retour rechargé ne crée rien de plus.
    expect(await retour(client, compteId)).toMatchObject({ ok: true, reconnecte: false });
    expect(client.creerAgenda).toHaveBeenCalledTimes(1);
  });

  it("une reconnexion garde l'agenda qui existe encore, et oublie l'ancien compte", async () => {
    const ancienne = await connecter(g, { interrompue_le: new Date().toISOString() });
    const { client } = fauxAgenda({ existe: true });
    const compteId = idComposio("ca");
    expect(await enregistrerRetour({ supabase: g.client, admin, agenda: client, compteId, attente: 0 })).toMatchObject({
      ok: true,
      reconnecte: true,
    });
    expect(client.agendaExiste).toHaveBeenCalledWith(compteId, ancienne.agenda_id);
    expect(client.creerAgenda).not.toHaveBeenCalled();
    expect(client.supprimerAgenda).not.toHaveBeenCalled();
    expect(client.supprimerCompte).toHaveBeenCalledWith(ancienne.compte_id);
    expect((await lireConnexionAgenda(g.client)).data).toMatchObject({
      compte_id: compteId,
      agenda_id: ancienne.agenda_id,
      interrompue_le: null,
    });
  });

  it("une reconnexion sur un autre compte Google crée un nouvel agenda, et supprime l'ancien", async () => {
    const ancienne = await connecter(g);
    const { client } = fauxAgenda({ existe: false });
    const compteId = idComposio("ca");
    expect(await enregistrerRetour({ supabase: g.client, admin, agenda: client, compteId, attente: 0 })).toMatchObject({
      ok: true,
      reconnecte: false,
    });
    expect(client.creerAgenda).toHaveBeenCalledWith(compteId);
    expect(client.supprimerAgenda).toHaveBeenCalledWith(ancienne.compte_id, ancienne.agenda_id);
    expect(client.supprimerCompte).toHaveBeenCalledWith(ancienne.compte_id);
    expect((await lireConnexionAgenda(g.client)).data?.agenda_id).not.toBe(ancienne.agenda_id);
  });

  it("passé en Free entre le lien et le retour : le compte tout juste créé est révoqué", async () => {
    await admin.from("entreprise").update({ plan: "free" }).eq("id", g.entrepriseId);
    const { client } = fauxAgenda();
    const compteId = idComposio("ca");
    expect(await enregistrerRetour({ supabase: g.client, admin, agenda: client, compteId, attente: 0 })).toEqual({
      ok: false,
      erreur: MESSAGES_AGENDA.fonctionPro,
    });
    expect(client.supprimerCompte).toHaveBeenCalledWith(compteId);
    expect(client.creerAgenda).not.toHaveBeenCalled();
    expect((await lireConnexionAgenda(g.client)).data).toBeNull();
  });
});

describe("synchronisation", () => {
  it("suit l'avis : posé à la date d'envoi, déplacé, retiré à la désignation, reposé à la réouverture, retiré au classement", async () => {
    const g = await compte("cycle");
    const connexion = await connecter(g);
    const { client, evenements } = fauxAgenda();
    const { id } = await deposerAvis(g);

    // Sans date d'envoi, pas d'échéance : rien à poser.
    expect(await synchroniser(g, client)).toEqual({ etat: "faite", poses: 0, retires: 0, echecs: 0 });

    await saisir(g, id, { plaque: "AG-101-AA", date_envoi: "06/10/2026" });
    expect(await synchroniser(g, client)).toMatchObject({ poses: 1, retires: 0 });
    const attendu = {
      id: idEvenement(id),
      jour: "2026-11-18",
      titre: "Désigner – AG-101-AA – avant le 20/11",
      description: `À désigner sur l'ANTAI avant le 20/11/2026.\n\n${URL_SITE}/avis/${id}`,
    };
    expect(client.poserEvenement).toHaveBeenLastCalledWith(connexion.compte_id, connexion.agenda_id, attendu);
    expect(await poses(g)).toEqual([
      { agenda_id: connexion.agenda_id, avis_id: id, jour: "2026-11-18", titre: attendu.titre },
    ]);

    // Rien n'a changé : aucun appel à Google.
    expect(await synchroniser(g, client)).toMatchObject({ poses: 0, retires: 0 });
    expect(client.poserEvenement).toHaveBeenCalledTimes(1);

    // La date d'envoi corrigée déplace le même événement.
    await saisir(g, id, { plaque: "AG-101-AA", date_envoi: "08/10/2026" });
    await synchroniser(g, client);
    expect(client.poserEvenement).toHaveBeenLastCalledWith(
      connexion.compte_id,
      connexion.agenda_id,
      expect.objectContaining({ id: idEvenement(id), jour: "2026-11-20", titre: "Désigner – AG-101-AA – avant le 22/11" }),
    );
    expect(evenements.get(connexion.agenda_id)?.size).toBe(1);

    // Désigné : retiré.
    const conducteur = await admin
      .from("conducteur")
      .insert({ entreprise_id: g.entrepriseId, prenom: "Karim", nom: "Benali" })
      .select("id")
      .single();
    if (conducteur.error) throw conducteur.error;
    const designation = await admin
      .from("avis")
      .update({ statut: "designe", designe_le: new Date().toISOString(), conducteur_id: conducteur.data.id })
      .eq("id", id);
    if (designation.error) throw designation.error;
    expect(await synchroniser(g, client)).toMatchObject({ poses: 0, retires: 1 });
    expect(client.retirerEvenement).toHaveBeenLastCalledWith(connexion.compte_id, connexion.agenda_id, idEvenement(id));
    expect(await poses(g)).toEqual([]);

    // Rouvert : reposé, sous le même id.
    expect((await rouvrirAvis(g.client, id)).ok).toBe(true);
    expect(await synchroniser(g, client)).toMatchObject({ poses: 1 });
    expect(evenements.get(connexion.agenda_id)?.has(idEvenement(id))).toBe(true);

    // Classé : retiré.
    expect((await classerAvis(g.client, id, { motif: "conteste" })).ok).toBe(true);
    expect(await synchroniser(g, client)).toMatchObject({ retires: 1 });
    expect(evenements.get(connexion.agenda_id)?.size).toBe(0);
    expect(await poses(g)).toEqual([]);
  });

  it("retire l'événement d'un dépôt en double abandonné", async () => {
    const g = await compte("doublon");
    const connexion = await connecter(g);
    const { client } = fauxAgenda();
    const original = await avisAvecEcheance(g);
    await saisir(g, original, { plaque: "AG-101-AA", date_envoi: "06/10/2026", numero: "7770000022" });
    const double = await avisAvecEcheance(g, { plaque: "AG-202-BB" });
    await synchroniser(g, client);
    expect((await poses(g)).map(({ avis_id }) => avis_id).sort()).toEqual([original, double].sort());

    const resultat = await modifierAvis(g.client, double, { plaque: "AG-202-BB", date_envoi: "06/10/2026", numero: "7770000022" });
    expect(resultat).toMatchObject({ ok: false, depotAbandonne: true });
    expect(await avisEnBase(double)).toBeNull();

    await synchroniser(g, client);
    expect(client.retirerEvenement).toHaveBeenCalledWith(connexion.compte_id, connexion.agenda_id, idEvenement(double));
    expect((await poses(g)).map(({ avis_id }) => avis_id)).toEqual([original]);
  });

  it("en Free, ne crée ni ne déplace rien mais retire ce qui est faux ; le retour en Pro recrée ce qui manque", async () => {
    const g = await compte("free");
    const connexion = await connecter(g);
    const { client, evenements } = fauxAgenda();
    const a = await avisAvecEcheance(g);
    await synchroniser(g, client);
    expect(await poses(g)).toHaveLength(1);

    await admin.from("entreprise").update({ plan: "free" }).eq("id", g.entrepriseId);
    const b = await avisAvecEcheance(g, { plaque: "AG-303-CC" });
    expect(await synchroniser(g, client)).toMatchObject({ poses: 0, retires: 0 });
    expect(client.poserEvenement).toHaveBeenCalledTimes(1);

    expect((await classerAvis(g.client, a, { motif: "conteste" })).ok).toBe(true);
    expect(await synchroniser(g, client)).toMatchObject({ poses: 0, retires: 1 });
    expect((await rouvrirAvis(g.client, a)).ok).toBe(true);
    expect(await synchroniser(g, client)).toMatchObject({ poses: 0, retires: 0 });
    expect(await poses(g)).toEqual([]);

    await passerEnPro(g.entrepriseId);
    expect(await synchroniser(g, client)).toMatchObject({ poses: 2, retires: 0 });
    expect([...evenements.get(connexion.agenda_id)!.keys()].sort()).toEqual([idEvenement(a), idEvenement(b)].sort());
  });

  it("un refus de Google date l'interruption et arrête la synchronisation, jusqu'à la reconnexion", async () => {
    const g = await compte("refus");
    await connecter(g);
    const { client, etat } = fauxAgenda();
    await avisAvecEcheance(g);
    await avisAvecEcheance(g, { plaque: "AG-404-DD" });
    etat.refus = true;

    expect(await synchroniser(g, client)).toMatchObject({ etat: "interrompue", poses: 0, echecs: 0 });
    expect((await lireConnexionAgenda(g.client)).data?.interrompue_le).not.toBeNull();
    expect(await poses(g)).toEqual([]);

    client.poserEvenement.mockClear();
    expect(await synchroniser(g, client)).toEqual({ etat: "sans_connexion", poses: 0, retires: 0, echecs: 0 });
    expect(client.poserEvenement).not.toHaveBeenCalled();
  });

  it("une panne de Google est comptée, sans interrompre : la synchronisation suivante la reprend", async () => {
    const g = await compte("panne");
    await connecter(g);
    const { client } = fauxAgenda();
    await avisAvecEcheance(g);
    client.poserEvenement.mockRejectedValueOnce(new Error("Google Calendar POST : 503"));

    expect(await synchroniser(g, client)).toMatchObject({ etat: "faite", poses: 0, echecs: 1 });
    expect((await lireConnexionAgenda(g.client)).data?.interrompue_le).toBeNull();
    expect(await poses(g)).toEqual([]);
    expect(await synchroniser(g, client)).toMatchObject({ etat: "faite", poses: 1, echecs: 0 });
  });

  it("deux synchronisations simultanées ne posent chaque événement qu'une fois, sous le même id", async () => {
    const g = await compte("concurrence");
    const connexion = await connecter(g);
    const { client, evenements } = fauxAgenda();
    const ids = [
      await avisAvecEcheance(g),
      await avisAvecEcheance(g, { plaque: "AG-505-EE" }),
      await avisAvecEcheance(g, { plaque: "AG-606-FF" }),
    ];

    await Promise.all([synchroniser(g, client), synchroniser(g, client)]);
    expect([...evenements.get(connexion.agenda_id)!.keys()].sort()).toEqual(ids.map(idEvenement).sort());
    expect((await poses(g)).map(({ avis_id }) => avis_id).sort()).toEqual([...ids].sort());
    for (const [, , evenement] of client.poserEvenement.mock.calls) {
      expect(ids.map(idEvenement)).toContain(evenement.id);
    }
  });

  it("oublie, sans appeler Google, les lignes d'un ancien agenda", async () => {
    const g = await compte("ancien-agenda");
    const connexion = await connecter(g);
    const { client } = fauxAgenda();
    const id = await avisAvecEcheance(g);
    const ancien = "ancien@group.calendar.google.com";
    await admin
      .from("evenement_agenda")
      .insert({ entreprise_id: g.entrepriseId, agenda_id: ancien, avis_id: id, jour: "2026-11-18", titre: "ancien" });

    expect(await synchroniser(g, client)).toMatchObject({ poses: 1, retires: 0 });
    expect(client.retirerEvenement).not.toHaveBeenCalled();
    expect((await poses(g)).map(({ agenda_id }) => agenda_id)).toEqual([connexion.agenda_id]);
  });
});

describe("compte expiré, déconnexion et isolation", () => {
  it("un compte agenda expiré date l'interruption, sans email ni effet sur la relève Gmail", async () => {
    const g = await compte("expire");
    const agenda = await connecter(g);
    const gmail = {
      entreprise_id: g.entrepriseId,
      service: "gmail",
      compte_id: idComposio("ca"),
      email_compte: "boite@exemple.fr",
      libelle_id: "Label_avis",
      libelle_nom: "Avis",
      declencheur_id: idComposio("ti"),
      active_depuis: new Date().toISOString(),
    };
    const insertion = await admin.from("connexion_google").insert(gmail);
    if (insertion.error) throw insertion.error;

    const envoyes: Email[] = [];
    const envoyeur: Envoyeur = async (email) => {
      envoyes.push(email);
    };
    const { corps, entetes } = signer(evenementExpiration(agenda.compte_id));
    const resultat = await traiterWebhookComposio({
      corps,
      entetes,
      secret: SECRET_COMPOSIO,
      supabase: admin,
      composio: null,
      envoyeur,
      urlSite: URL_SITE,
    });
    expect(resultat).toMatchObject({ statut: 200, message: "rappels interrompus" });
    expect(envoyes).toEqual([]);
    expect((await lireConnexionAgenda(g.client)).data?.interrompue_le).not.toBeNull();
    expect((await lireConnexionGmail(g.client)).data).toMatchObject({ interrompue_le: null, interruption_signalee_le: null });
  });

  it("déconnecter supprime l'agenda chez Google, révoque le compte, et efface la connexion et ses événements", async () => {
    const g = await compte("deconnexion");
    const connexion = await connecter(g);
    const { client } = fauxAgenda();
    await avisAvecEcheance(g);
    await synchroniser(g, client);
    expect(await poses(g)).toHaveLength(1);

    await deconnecterAgenda({ admin, agenda: client, entrepriseId: g.entrepriseId });
    expect(client.supprimerAgenda).toHaveBeenCalledWith(connexion.compte_id, connexion.agenda_id);
    expect(client.supprimerCompte).toHaveBeenCalledWith(connexion.compte_id);
    expect((await lireConnexionAgenda(admin, g.entrepriseId)).data).toBeNull();
    expect(await poses(g)).toEqual([]);

    // Une relance ne fait rien de plus.
    await deconnecterAgenda({ admin, agenda: client, entrepriseId: g.entrepriseId });
    expect(client.supprimerCompte).toHaveBeenCalledTimes(1);
  });

  it("un accès déjà retiré n'empêche pas de révoquer le compte ; sans Composio, rien ne bouge", async () => {
    const g = await compte("deconnexion-refus");
    const connexion = await connecter(g);
    await expect(deconnecterAgenda({ admin, agenda: null, entrepriseId: g.entrepriseId })).rejects.toThrow();
    expect((await lireConnexionAgenda(admin, g.entrepriseId)).data).not.toBeNull();

    const { client, etat } = fauxAgenda();
    etat.refus = true;
    await deconnecterAgenda({ admin, agenda: client, entrepriseId: g.entrepriseId });
    expect(client.supprimerCompte).toHaveBeenCalledWith(connexion.compte_id);
    expect((await lireConnexionAgenda(admin, g.entrepriseId)).data).toBeNull();
  });

  it("le gestionnaire voit sa connexion, mais ni les événements posés ni la connexion d'un autre", async () => {
    const [a, b] = await Promise.all([compte("rls-a"), compte("rls-b")]);
    await connecter(a);
    await avisAvecEcheance(a);
    await synchroniser(a, fauxAgenda().client);
    expect(await poses(a)).toHaveLength(1);

    expect((await lireConnexionAgenda(a.client)).data).not.toBeNull();
    expect((await lireConnexionAgenda(b.client)).data).toBeNull();
    const lecture = await a.client.from("evenement_agenda").select("avis_id");
    expect(lecture.data ?? []).toEqual([]);
    const ecriture = await a.client
      .from("evenement_agenda")
      .insert({ entreprise_id: a.entrepriseId, agenda_id: "x", avis_id: crypto.randomUUID(), jour: "2026-11-18", titre: "x" });
    expect(ecriture.error).not.toBeNull();
  });
});

describe("tâche de la nuit", () => {
  it("refuse un appel sans le secret", async () => {
    const appel = (entetes: Record<string, string> = {}) =>
      tacheAgenda(new Request("http://127.0.0.1:3000/api/cron/agenda", { headers: entetes }));
    expect((await appel()).status).toBe(401);
    expect((await appel({ authorization: "Bearer mauvais" })).status).toBe(401);
  });

  it("rattrape les agendas connectés, et laisse ceux dont les rappels sont interrompus", async () => {
    const [actif, interrompu] = await Promise.all([compte("nuit-actif"), compte("nuit-interrompu")]);
    const connexion = await connecter(actif);
    await connecter(interrompu, { interrompue_le: new Date().toISOString() });
    const id = await avisAvecEcheance(actif);
    await avisAvecEcheance(interrompu);
    const { client } = fauxAgenda();

    const bilan = await synchroniserTousLesAgendas({ admin, agenda: client, urlSite: URL_SITE });
    expect(bilan.entreprises).toBeGreaterThanOrEqual(1);
    expect(client.poserEvenement).toHaveBeenCalledWith(
      connexion.compte_id,
      connexion.agenda_id,
      expect.objectContaining({ id: idEvenement(id) }),
    );
    expect(await poses(actif)).toHaveLength(1);
    expect(await poses(interrompu)).toEqual([]);
  });
});
