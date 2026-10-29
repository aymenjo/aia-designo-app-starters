import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AbonnementDuClient, ClientStripe } from "@/lib/abonnement/stripe";
import type { ClientAgenda } from "@/lib/agenda/composio";
import { BUCKET_AVIS, creerAvisGmail } from "@/lib/avis/avis";
import { MESSAGES_COMPTE } from "@/lib/compte/regles";
import { supprimerCompte } from "@/lib/compte/suppression";
import type { ClientComposio } from "@/lib/gmail/composio";
import { BUCKET_RAPPORTS, cheminRapport } from "@/lib/rapport/liste";
import { CONTENU_PDF, idComposio } from "../composio";
import { idStripe } from "../stripe";
import {
  PNG,
  admin,
  deposerAvis,
  passerEnPro,
  premiereConnexion,
  suffixeUnique,
  supprimerGestionnaire,
  type Gestionnaire,
} from "./outils";

// La suppression de compte (phase 20) sur le Supabase local, avec un faux Stripe et un faux Composio qui notent leurs
// appels : la CI ne parle jamais ni à l'un ni à l'autre. Le compte A a une ligne dans chaque table, un dossier de plus
// de 100 fichiers, une boîte Gmail et un agenda connectés, et trois abonnements ; le compte B, à côté, ne doit rien
// perdre.

const suffixe = suffixeUnique();
const gestionnaires: Gestionnaire[] = [];

afterAll(async () => {
  for (const g of gestionnaires) await supprimerGestionnaire(g);
});

async function compte(nom: string) {
  const g = await premiereConnexion(`suppression-${nom}-${suffixe}@exemple.fr`);
  gestionnaires.push(g);
  return g;
}

/** Les données d'une réponse de Supabase, ou son erreur levée. */
function verifier<T>({ data, error }: { data: T; error: unknown }): NonNullable<T> {
  if (error) throw error;
  return data as NonNullable<T>;
}

// Les tables

/** Les tables exposées par PostgREST et leurs colonnes, d'après son schéma OpenAPI, lu avec la clé secrète. */
async function tablesDuSchema(): Promise<Record<string, string[]>> {
  const reponse = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/`, {
    headers: { apikey: process.env.SUPABASE_SECRET_KEY! },
  });
  if (!reponse.ok) throw new Error(`schéma OpenAPI : ${reponse.status}`);
  const { definitions } = (await reponse.json()) as { definitions: Record<string, { properties: object }> };
  return Object.fromEntries(Object.entries(definitions).map(([table, { properties }]) => [table, Object.keys(properties)]));
}

/**
 * Les lignes d'une entreprise, table par table, pour chaque table du schéma : une table ajoutée plus tard (l'agenda,
 * les conversations) est comptée d'office. Une table qu'on ne sait pas rattacher à une entreprise fait échouer le test.
 */
async function lignesDe(entrepriseId: string, avisIds: string[]): Promise<Record<string, number>> {
  const lignes: Record<string, number> = {};
  for (const [table, colonnes] of Object.entries(await tablesDuSchema())) {
    const requete = admin.from(table).select("*", { count: "exact", head: true });
    let filtree;
    if (colonnes.includes("entreprise_id")) filtree = requete.eq("entreprise_id", entrepriseId);
    else if (table === "entreprise") filtree = requete.eq("id", entrepriseId);
    else if (table === "alerte_envoyee") filtree = requete.in("avis_id", avisIds);
    else {
      throw new Error(
        `La table « ${table} » n'a pas d'entreprise_id : dites ici comment compter ses lignes, et vérifiez que la ` +
          "suppression de compte l'efface (règle d'extension du PLAN).",
      );
    }
    const { count, error } = await filtree;
    if (error) throw error;
    lignes[table] = count ?? 0;
  }
  return lignes;
}

async function fichiersDe(entrepriseId: string) {
  return verifier(await admin.storage.from(BUCKET_AVIS).list(entrepriseId, { limit: 1000 })).map(({ name }) => name);
}

/** Les PDF des rapports mensuels de l'entreprise (phase 25). */
async function rapportsDe(entrepriseId: string) {
  return verifier(await admin.storage.from(BUCKET_RAPPORTS).list(entrepriseId)).map(({ name }) => name);
}

// Les faux clients

type Appel = { methode: string; id: string; detail?: string };

/** Un faux Stripe : les abonnements du client, dont l'état suit les annulations. */
function fauxStripe(abonnements: AbonnementDuClient[], { factureEnPanne }: { factureEnPanne?: string } = {}) {
  const appels: Appel[] = [];
  const nonUtilise = async () => {
    throw new Error("non utilisé ici");
  };
  const stripe: ClientStripe = {
    tarif: nonUtilise,
    creerClient: nonUtilise,
    mettreAJourClient: nonUtilise,
    sessionCheckout: nonUtilise,
    sessionPortail: nonUtilise,
    abonnement: nonUtilise,
    async abonnementsDuClient(clientId) {
      appels.push({ methode: "abonnementsDuClient", id: clientId });
      return abonnements.map((abonnement) => ({ ...abonnement }));
    },
    async annulerAbonnement(id, commentaire) {
      appels.push({ methode: "annulerAbonnement", id, detail: commentaire });
      abonnements.find((abonnement) => abonnement.id === id)!.statut = "canceled";
    },
    async annulerFacture(id, cle) {
      appels.push({ methode: "annulerFacture", id, detail: cle });
      if (id === factureEnPanne) throw new Error("Stripe en panne");
      abonnements.find(({ factureId }) => factureId === id)!.factureStatut = "void";
    },
  };
  return { stripe, appels };
}

function fauxComposio() {
  const nonUtilise = vi.fn(async () => {
    throw new Error("non utilisé ici");
  });
  return {
    lienConnexion: nonUtilise,
    statutCompte: nonUtilise,
    adresse: nonUtilise,
    libelles: nonUtilise,
    creerDeclencheur: nonUtilise,
    supprimerDeclencheur: vi.fn(async () => undefined),
    supprimerCompte: vi.fn(async () => undefined),
    pieceJointe: nonUtilise,
  } satisfies ClientComposio;
}

function fauxAgenda() {
  const nonUtilise = vi.fn(async () => {
    throw new Error("non utilisé ici");
  });
  return {
    lienConnexion: nonUtilise,
    statutCompte: nonUtilise,
    adresse: nonUtilise,
    agendaExiste: nonUtilise,
    creerAgenda: nonUtilise,
    supprimerAgenda: vi.fn(async () => undefined),
    poserEvenement: nonUtilise,
    retirerEvenement: nonUtilise,
    supprimerCompte: vi.fn(async () => undefined),
  } satisfies ClientAgenda;
}

// Les données

/**
 * Un compte Pro avec une ligne dans chaque table, un dossier de 103 fichiers, Gmail et l'agenda connectés, et trois
 * abonnements.
 */
async function semerCompteComplet(g: Gestionnaire) {
  const raisonSociale = `Plomberie Martin ${suffixe}`;
  const clientId = idStripe("cus");
  const abonnements: AbonnementDuClient[] = [
    { id: idStripe("sub"), statut: "active", factureId: idStripe("in"), factureStatut: "paid" },
    { id: idStripe("sub"), statut: "past_due", factureId: idStripe("in"), factureStatut: "open" },
    { id: idStripe("sub"), statut: "canceled", factureId: idStripe("in"), factureStatut: "void" },
  ];
  await passerEnPro(g.entrepriseId);
  verifier(
    await admin
      .from("entreprise")
      .update({
        raison_sociale: raisonSociale,
        stripe_client_id: clientId,
        stripe_abonnement_id: abonnements[0].id,
        abonnement_statut: "active",
        stripe_evenement_le: new Date().toISOString(),
      })
      .eq("id", g.entrepriseId),
  );

  const entreprise_id = g.entrepriseId;
  const vehicule = verifier(
    await admin.from("vehicule").insert({ entreprise_id, plaque: "SC-123-AA", type: "attitre" }).select("id").single(),
  );
  const conducteur = verifier(
    await admin.from("conducteur").insert({ entreprise_id, prenom: "Karim", nom: "Benali" }).select("id").single(),
  );
  verifier(
    await admin.from("affectation").insert({
      entreprise_id,
      vehicule_id: vehicule.id,
      conducteur_id: conducteur.id,
      debut: "2026-03-01T07:00:00Z",
    }),
  );

  const avis = await deposerAvis(g);
  verifier(await admin.from("alerte_envoyee").insert({ avis_id: avis.id, seuil: 15 }));
  verifier(await admin.from("facture_envoyee").insert({ facture_id: idStripe("in"), entreprise_id }));
  verifier(await admin.from("impaye_signale").insert({ facture_id: idStripe("in"), entreprise_id }));

  const connexion = {
    compte_id: idComposio("ca"),
    declencheur_id: idComposio("ti"),
  };
  verifier(
    await admin.from("connexion_google").insert({
      entreprise_id,
      service: "gmail",
      ...connexion,
      email_compte: "boite@exemple.fr",
      libelle_id: "Label_avis",
      libelle_nom: "Avis",
      active_depuis: new Date().toISOString(),
    }),
  );
  const email = verifier(
    await admin
      .from("email_gmail")
      .insert({ entreprise_id, message_id: idComposio("msg"), etat: "releve" })
      .select("id")
      .single(),
  );
  const avisGmail = await creerAvisGmail(admin, {
    entrepriseId: entreprise_id,
    emailGmailId: email.id,
    pieceJointe: "ANGpiece",
    contenu: CONTENU_PDF,
    type: "application/pdf",
    nom: "avis.pdf",
  });
  if (!avisGmail.ok) throw new Error(`avis Gmail : ${avisGmail.erreur}`);

  // Interrompue : la tâche de la nuit, testée en parallèle (rappels-agenda.test.ts), ne touche pas à ses événements.
  const agenda = { compte_id: idComposio("ca"), agenda_id: `designo-${suffixe}@group.calendar.google.com` };
  verifier(
    await admin.from("connexion_google").insert({
      entreprise_id,
      service: "agenda",
      ...agenda,
      email_compte: "agenda@exemple.fr",
      active_depuis: new Date().toISOString(),
      interrompue_le: new Date().toISOString(),
    }),
  );
  verifier(
    await admin.from("evenement_agenda").insert({
      entreprise_id,
      agenda_id: agenda.agenda_id,
      avis_id: avis.id,
      jour: "2026-11-16",
      titre: "Désigner – SC-123-AA – avant le 18/11",
    }),
  );

  // Le rapport mensuel (phase 25) : sa ligne et son PDF, dans le bucket des rapports.
  const rapport = { mois: "2026-10-01", fichier: cheminRapport(entreprise_id, "2026-10-01") };
  verifier(
    await admin.storage
      .from(BUCKET_RAPPORTS)
      .upload(rapport.fichier, CONTENU_PDF, { contentType: "application/pdf" }),
  );
  verifier(await admin.from("rapport_mensuel").insert({ entreprise_id, ...rapport }));

  // Plus d'une page de 100 : le dossier se vide page après page.
  const bucket = admin.storage.from(BUCKET_AVIS);
  for (let lot = 0; lot < 101; lot += 25) {
    await Promise.all(
      Array.from({ length: Math.min(25, 101 - lot) }, async () => {
        const envoi = await bucket.upload(`${entreprise_id}/${crypto.randomUUID()}.png`, PNG, { contentType: "image/png" });
        if (envoi.error) throw envoi.error;
      }),
    );
  }

  return { raisonSociale, clientId, abonnements, connexion, agenda, avisIds: [avis.id, avisGmail.id] };
}

describe("suppression de compte", () => {
  let a: Gestionnaire;
  let b: Gestionnaire;
  let semis: Awaited<ReturnType<typeof semerCompteComplet>>;
  let lignesAvant: Record<string, number>;
  let lignesB: Record<string, number>;
  let fichiersB: string[];
  let avisB: string[];

  beforeAll(async () => {
    [a, b] = await Promise.all([compte("a"), compte("b")]);
    semis = await semerCompteComplet(a);
    lignesAvant = await lignesDe(a.entrepriseId, semis.avisIds);

    verifier(await admin.from("vehicule").insert({ entreprise_id: b.entrepriseId, plaque: "SC-456-BB", type: "pool" }));
    avisB = [(await deposerAvis(b)).id];
    lignesB = await lignesDe(b.entrepriseId, avisB);
    fichiersB = await fichiersDe(b.entrepriseId);
  }, 60_000);

  it("a semé une ligne dans chaque table, et plus d'une page de fichiers", async () => {
    for (const [table, n] of Object.entries(lignesAvant)) {
      expect(n, `${table} : semez-y une ligne, pour prouver que la suppression l'efface (règle d'extension du PLAN)`).toBeGreaterThan(0);
    }
    expect(await fichiersDe(a.entrepriseId)).toHaveLength(103);
    expect(await rapportsDe(a.entrepriseId)).toEqual(["2026-10.pdf"]);
  });

  it("refuse une saisie qui n'est pas la raison sociale exacte, sans rien effacer ni appeler", async () => {
    const { stripe, appels } = fauxStripe(semis.abonnements);
    const composio = fauxComposio();
    const agenda = fauxAgenda();
    for (const saisie of ["", "plomberie martin", semis.raisonSociale.slice(0, -1)]) {
      expect(await supprimerCompte({ supabase: a.client, admin, stripe, composio, agenda, saisie })).toEqual({
        ok: false,
        erreur: MESSAGES_COMPTE.saisie(semis.raisonSociale),
      });
    }
    expect(appels).toEqual([]);
    expect(composio.supprimerDeclencheur).not.toHaveBeenCalled();
    expect(composio.supprimerCompte).not.toHaveBeenCalled();
    expect(agenda.supprimerAgenda).not.toHaveBeenCalled();
    expect(await lignesDe(a.entrepriseId, semis.avisIds)).toEqual(lignesAvant);
  });

  it("ne commence rien sans Composio pour révoquer Gmail ou l'agenda, ni sans Stripe pour annuler l'abonnement", async () => {
    const { stripe, appels } = fauxStripe(semis.abonnements);
    const composio = fauxComposio();
    const agenda = fauxAgenda();
    const saisie = semis.raisonSociale;
    const indisponible = { ok: false, erreur: MESSAGES_COMPTE.indisponible };

    const supprimer = (clients: Partial<Parameters<typeof supprimerCompte>[0]>) =>
      supprimerCompte({ supabase: a.client, admin, stripe, composio, agenda, saisie, ...clients });
    expect(await supprimer({ composio: null })).toEqual(indisponible);
    expect(await supprimer({ agenda: null })).toEqual(indisponible);
    expect(await supprimer({ stripe: null })).toEqual(indisponible);
    expect(appels).toEqual([]);
    expect(composio.supprimerCompte).not.toHaveBeenCalled();
    expect(agenda.supprimerCompte).not.toHaveBeenCalled();
    expect(await lignesDe(a.entrepriseId, semis.avisIds)).toEqual(lignesAvant);
    expect(await fichiersDe(a.entrepriseId)).toHaveLength(103);
  });

  it("révoque Gmail et l'agenda, annule les abonnements en cours, puis efface les lignes, les fichiers et l'utilisateur", async () => {
    const { stripe, appels } = fauxStripe(semis.abonnements);
    const composio = fauxComposio();
    const agenda = fauxAgenda();
    const [actif, impaye, annule] = semis.abonnements;

    expect(
      await supprimerCompte({ supabase: a.client, admin, stripe, composio, agenda, saisie: `  ${semis.raisonSociale} ` }),
    ).toEqual({ ok: true });

    expect(composio.supprimerDeclencheur).toHaveBeenCalledWith(semis.connexion.declencheur_id);
    expect(composio.supprimerCompte).toHaveBeenCalledWith(semis.connexion.compte_id);
    expect(agenda.supprimerAgenda).toHaveBeenCalledWith(semis.agenda.compte_id, semis.agenda.agenda_id);
    expect(agenda.supprimerCompte).toHaveBeenCalledWith(semis.agenda.compte_id);
    // L'abonnement annulé et sa facture ne sont pas touchés.
    expect(appels).toEqual([
      { methode: "abonnementsDuClient", id: semis.clientId },
      { methode: "annulerAbonnement", id: actif.id, detail: "Suppression du compte Désigno." },
      { methode: "annulerAbonnement", id: impaye.id, detail: "Suppression du compte Désigno." },
      { methode: "annulerFacture", id: impaye.factureId, detail: `suppression/void/${impaye.factureId}` },
    ]);
    expect(appels.some(({ id }) => id === annule.id || id === annule.factureId)).toBe(false);

    expect(await lignesDe(a.entrepriseId, semis.avisIds)).toEqual(
      Object.fromEntries(Object.keys(lignesAvant).map((table) => [table, 0])),
    );
    expect(await fichiersDe(a.entrepriseId)).toEqual([]);
    expect(await rapportsDe(a.entrepriseId)).toEqual([]);
    expect((await admin.auth.admin.getUserById(a.userId)).error).not.toBeNull();
  });

  it("laisse intactes les lignes et les fichiers d'un autre compte", async () => {
    expect(await lignesDe(b.entrepriseId, avisB)).toEqual(lignesB);
    expect(await fichiersDe(b.entrepriseId)).toEqual(fichiersB);
  });

  it("laisse le même email recréer un compte vierge", async () => {
    const neuf = await compte("a");
    expect(neuf.userId).not.toBe(a.userId);
    expect(neuf.entrepriseId).not.toBe(a.entrepriseId);
    const entreprise = verifier(
      await admin
        .from("entreprise")
        .select("plan, raison_sociale, stripe_client_id")
        .eq("id", neuf.entrepriseId)
        .single(),
    );
    expect(entreprise).toEqual({ plan: "free", raison_sociale: null, stripe_client_id: null });
    expect(await lignesDe(neuf.entrepriseId, [])).toMatchObject({ vehicule: 0, conducteur: 0, avis: 0 });
  });
});

it("reprend là où elle s'était arrêtée : une facture restée ouverte après une panne est annulée à la relance", async () => {
  const g = await compte("relance");
  const raisonSociale = `Relance ${suffixe}`;
  const clientId = idStripe("cus");
  const abonnement: AbonnementDuClient = {
    id: idStripe("sub"),
    statut: "past_due",
    factureId: idStripe("in"),
    factureStatut: "open",
  };
  verifier(
    await admin
      .from("entreprise")
      .update({
        plan: "pro",
        raison_sociale: raisonSociale,
        stripe_client_id: clientId,
        stripe_abonnement_id: abonnement.id,
        abonnement_statut: "past_due",
        stripe_evenement_le: new Date().toISOString(),
      })
      .eq("id", g.entrepriseId),
  );
  const avis = await deposerAvis(g);
  const abonnements = [abonnement];

  // L'abonnement est annulé, puis Stripe tombe : rien d'autre n'est effacé.
  const panne = fauxStripe(abonnements, { factureEnPanne: abonnement.factureId! });
  await expect(
    supprimerCompte({ supabase: g.client, admin, stripe: panne.stripe, composio: null, agenda: null, saisie: raisonSociale }),
  ).rejects.toThrow("Stripe en panne");
  expect(abonnements[0]).toMatchObject({ statut: "canceled", factureStatut: "open" });
  expect(await fichiersDe(g.entrepriseId)).toEqual([avis.chemin.split("/")[1]]);
  expect((await admin.auth.admin.getUserById(g.userId)).error).toBeNull();

  // La relance n'annule plus l'abonnement, mais rattrape sa facture.
  const relance = fauxStripe(abonnements);
  expect(
    await supprimerCompte({ supabase: g.client, admin, stripe: relance.stripe, composio: null, agenda: null, saisie: raisonSociale }),
  ).toEqual({ ok: true });
  expect(relance.appels).toEqual([
    { methode: "abonnementsDuClient", id: clientId },
    { methode: "annulerFacture", id: abonnement.factureId, detail: `suppression/void/${abonnement.factureId}` },
  ]);
  expect(await fichiersDe(g.entrepriseId)).toEqual([]);
  expect((await admin.auth.admin.getUserById(g.userId)).error).not.toBeNull();
});
