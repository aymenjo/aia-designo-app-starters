import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BUCKET_AVIS, creerAvis } from "@/lib/avis/avis";
import { lireEtRemplirAvis, type Lecteur, type Lecture } from "@/lib/avis/lecture";
import { CHAMPS_AVIS, MESSAGES_AVIS, type ChampAvis } from "@/lib/avis/regles";
import type { Email, Envoyeur } from "@/lib/email/envoi";
import { creerVehicule } from "@/lib/flotte/vehicules";
import { AccesGmailRefuse, type ClientComposio, type StatutCompte } from "@/lib/gmail/composio";
import {
  choisirLibelle,
  deconnecterGmail,
  demarrerConnexion,
  enregistrerRetour,
  lireConnexionGmail,
} from "@/lib/gmail/connexion";
import { SUJET_INTERRUPTION } from "@/lib/gmail/email-interruption";
import { traiterEmail } from "@/lib/gmail/emails";
import { MESSAGES_GMAIL } from "@/lib/gmail/regles";
import { traiterWebhookComposio } from "@/lib/gmail/webhook";
import {
  CONTENU_PDF,
  CONTENU_PNG,
  SECRET_COMPOSIO,
  evenementEmail,
  evenementExpiration,
  idComposio,
  piece,
  signer,
} from "../composio";
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

// La relève Gmail (phase 23) sur le Supabase local, avec un faux client Composio, un faux lecteur et un faux envoyeur :
// la CI ne parle jamais à Composio, à Gmail ni à l'API Claude. Les événements sont signés comme Composio les signe.

const suffixe = suffixeUnique();
const URL_SITE = "https://designo.test";
const LIBELLE = { id: "Label_avis", nom: "Avis" };
const gestionnaires: Gestionnaire[] = [];

async function compte(nom: string, { pro = true } = {}) {
  const g = await premiereConnexion(`gmail-${nom}-${suffixe}@exemple.fr`);
  gestionnaires.push(g);
  if (pro) await passerEnPro(g.entrepriseId);
  return g;
}

afterAll(async () => {
  for (const g of gestionnaires) await supprimerGestionnaire(g);
});

/** Un faux Composio : les pièces jointes viennent de `contenus` (par attachmentId), sinon un PDF. */
function fauxComposio({
  statut = "ACTIVE",
  libelles = [LIBELLE],
  refus = false,
}: { statut?: StatutCompte | null; libelles?: { id: string; nom: string }[]; refus?: boolean } = {}) {
  const contenus = new Map<string, Buffer>();
  const client = {
    lienConnexion: vi.fn(async (entrepriseId: string, urlRetour: string) => `https://composio.test/lien?u=${entrepriseId}&r=${urlRetour}`),
    statutCompte: vi.fn(async () => statut),
    adresse: vi.fn(async () => "boite@exemple.fr"),
    libelles: vi.fn(async () => {
      if (refus) throw new AccesGmailRefuse("401");
      return libelles;
    }),
    creerDeclencheur: vi.fn(async () => idComposio("ti")),
    supprimerDeclencheur: vi.fn(async () => undefined),
    supprimerCompte: vi.fn(async () => undefined),
    pieceJointe: vi.fn(async (_compte: string, _message: string, piece: string) => {
      if (refus) throw new AccesGmailRefuse("401");
      return contenus.get(piece) ?? CONTENU_PDF;
    }),
  } satisfies ClientComposio;
  return { client, contenus };
}

function fauxEnvoyeur() {
  const envoyes: Email[] = [];
  const envoyeur: Envoyeur = async (email) => {
    envoyes.push(email);
  };
  return { envoyeur, envoyes };
}

const enPanne: Envoyeur = async () => {
  throw new Error("Resend en panne");
};

/** La connexion d'une entreprise, comme après la connexion et le choix du libellé. */
async function connecter(g: Gestionnaire, champs: Record<string, unknown> = {}) {
  const connexion = {
    entreprise_id: g.entrepriseId,
    service: "gmail",
    compte_id: idComposio("ca"),
    email_compte: "boite@exemple.fr",
    libelle_id: LIBELLE.id,
    libelle_nom: LIBELLE.nom,
    declencheur_id: idComposio("ti"),
    active_depuis: new Date().toISOString(),
    ...champs,
  };
  const { error } = await admin.from("connexion_google").insert(connexion);
  if (error) throw error;
  return connexion as typeof connexion & { compte_id: string; declencheur_id: string };
}

function poster(
  evenement: unknown,
  {
    composio = fauxComposio().client,
    envoyeur = fauxEnvoyeur().envoyeur,
    secret = SECRET_COMPOSIO,
  }: { composio?: ClientComposio | null; envoyeur?: Envoyeur | null; secret?: string } = {},
) {
  const { corps, entetes } = signer(evenement, secret);
  return traiterWebhookComposio({ corps, entetes, secret: SECRET_COMPOSIO, supabase: admin, composio, envoyeur, urlSite: URL_SITE });
}

async function emailEnBase(g: Gestionnaire, messageId: string) {
  const { data } = await admin
    .from("email_gmail")
    .select("*")
    .eq("entreprise_id", g.entrepriseId)
    .eq("message_id", messageId)
    .maybeSingle();
  return data;
}

async function avisDeLEmail(emailId: string) {
  const { data, error } = await admin.from("avis").select("*").eq("email_gmail_id", emailId);
  if (error) throw error;
  return data;
}

const LUES: Record<ChampAvis, string> = {
  numero: "7770000001",
  plaque: "GM-101-AA",
  infraction_date: "03/10/2026",
  infraction_heure: "08:30",
  lieu: "A6, Auxerre",
  infraction: "Excès de vitesse inférieur à 20 km/h",
  montant: "135,00",
  date_envoi: "06/10/2026",
};

function lecteur(autres: Partial<Record<ChampAvis, string>> = {}) {
  const lue = Object.fromEntries(
    CHAMPS_AVIS.map((champ) => [champ, { valeur: autres[champ] ?? LUES[champ], confiance: "sur" }]),
  ) as Lecture;
  return vi.fn<Lecteur>(async () => lue);
}

describe("webhook Composio : signature et événements ignorés", () => {
  it("refuse une signature forgée", async () => {
    const resultat = await poster(evenementExpiration("ca_inconnu"), { secret: "forge" });
    expect(resultat).toMatchObject({ statut: 400, message: "Signature invalide" });
  });

  it("ignore un autre type d'événement, un ancien déclencheur, et un compte inconnu", async () => {
    expect(await poster({ type: "composio.autre", data: {} })).toMatchObject({ statut: 200 });
    const g = await compte("ignore");
    const connexion = await connecter(g);
    const ancien = evenementEmail({ declencheur: idComposio("ti"), compte: connexion.compte_id, pieces: [piece({ nom: "a.pdf" })] });
    expect(await poster(ancien)).toMatchObject({ statut: 200, message: "ignoré : déclencheur inconnu" });
    expect(await poster(evenementExpiration(idComposio("ca")))).toMatchObject({ statut: 200, message: "compte inconnu : ignoré" });
    expect(await emailEnBase(g, ancien.data.id)).toBeNull();
  });

  it("ignore un email hors du libellé, et tout email d'une entreprise en Free", async () => {
    const g = await compte("pause");
    const connexion = await connecter(g);
    const hors = evenementEmail({
      declencheur: connexion.declencheur_id,
      compte: connexion.compte_id,
      libelles: ["INBOX"],
      pieces: [piece({ nom: "a.pdf" })],
    });
    expect(await poster(hors)).toMatchObject({ statut: 200, message: "ignoré : hors du libellé" });

    await admin.from("entreprise").update({ plan: "free" }).eq("id", g.entrepriseId);
    const enFree = evenementEmail({ declencheur: connexion.declencheur_id, compte: connexion.compte_id, pieces: [piece({ nom: "a.pdf" })] });
    expect(await poster(enFree)).toMatchObject({ statut: 200, message: "ignoré : relève en pause (Free)" });
    expect(await emailEnBase(g, hors.data.id)).toBeNull();
    expect(await emailEnBase(g, enFree.data.id)).toBeNull();
  });

  it("répond 500 à un événement attendu d'une forme inattendue : Composio relancera", async () => {
    const casse = { type: "composio.trigger.message", metadata: {}, data: {} };
    expect(await poster(casse)).toMatchObject({ statut: 500 });
  });
});

describe("webhook Composio : relève d'un email", () => {
  let g: Gestionnaire;
  let connexion: Awaited<ReturnType<typeof connecter>>;

  beforeAll(async () => {
    g = await compte("releve");
    connexion = await connecter(g);
  });

  const email = (pieces: ReturnType<typeof piece>[], autres: Partial<Parameters<typeof evenementEmail>[0]> = {}) =>
    evenementEmail({ declencheur: connexion.declencheur_id, compte: connexion.compte_id, libelles: [LIBELLE.id], pieces, ...autres });

  it("un PDF devient un avis « À traiter » de l'entreprise, rattaché à son email, puis lu par l'IA", async () => {
    const evenement = email([piece({ nom: "avis.pdf" })], { objet: "Votre avis", expediteur: "ANTAI <x@antai.fr>" });
    const resultat = await poster(evenement);
    expect(resultat).toMatchObject({ statut: 200 });

    const releve = await emailEnBase(g, evenement.data.id);
    expect(releve).toMatchObject({
      etat: "releve",
      ecarts: [],
      boite: "boite@exemple.fr",
      expediteur: "ANTAI <x@antai.fr>",
      objet: "Votre avis",
      recu_le: expect.stringMatching(/^2026-10-26T08:12:00/),
    });
    const [avis] = await avisDeLEmail(releve!.id);
    expect(avis).toMatchObject({
      entreprise_id: g.entrepriseId,
      source: "gmail",
      statut: "a_traiter",
      piece_jointe: "1",
      fichier_type: "application/pdf",
      fichier_nom: "avis.pdf",
      lecture_ia: null,
    });
    expect(avis.fichier).toMatch(new RegExp(`^${g.entrepriseId}/`));
    expect(resultat.aLire).toEqual([avis.id]);

    // La lecture tourne sous la clé secrète, comme après la réponse du webhook.
    expect(await lireEtRemplirAvis(admin, avis.id, lecteur())).toEqual({ lecture: "lue" });
    expect(await avisEnBase(avis.id)).toMatchObject({ numero: "7770000001", lecture_ia: "lue", statut: "a_valider" });
  });

  it("le même événement livré deux fois ne crée rien de plus", async () => {
    const evenement = email([piece({ nom: "deux-fois.pdf" })]);
    await poster(evenement);
    const second = await poster(evenement);
    expect(second.statut).toBe(200);
    const releve = await emailEnBase(g, evenement.data.id);
    expect(await avisDeLEmail(releve!.id)).toHaveLength(1);
  });

  it("un email mixte donne un avis, et va dans les non exploitables avec la pièce jointe écartée", async () => {
    const evenement = email([piece({ nom: "avis.pdf" }), piece({ nom: "photo.heic", type: "image/heic" })]);
    expect(await poster(evenement)).toMatchObject({ statut: 200 });
    const releve = await emailEnBase(g, evenement.data.id);
    expect(releve).toMatchObject({ etat: "non_exploitable", ecarts: [{ nom: "photo.heic", motif: "heic" }] });
    expect(await avisDeLEmail(releve!.id)).toHaveLength(1);
  });

  it("un email sans pièce jointe va dans les non exploitables, sans écart", async () => {
    const evenement = email([]);
    expect(await poster(evenement)).toMatchObject({ statut: 200, aLire: [] });
    expect(await emailEnBase(g, evenement.data.id)).toMatchObject({ etat: "non_exploitable", ecarts: [] });
  });

  it("un fichier renommé en .pdf est écarté", async () => {
    const { client, contenus } = fauxComposio();
    const p = piece({ nom: "faux.pdf" });
    contenus.set(p.body.attachmentId, CONTENU_PNG);
    const evenement = email([p]);
    expect(await poster(evenement, { composio: client })).toMatchObject({ statut: 200 });
    expect(await emailEnBase(g, evenement.data.id)).toMatchObject({
      etat: "non_exploitable",
      ecarts: [{ nom: "faux.pdf", motif: "format" }],
    });
  });

  it("sans Composio configuré, un email à télécharger répond 503 : Composio relancera", async () => {
    const evenement = email([piece({ nom: "plus-tard.pdf" })]);
    expect(await poster(evenement, { composio: null })).toMatchObject({ statut: 503 });
    // La relance aboutit, sur l'email déjà réservé.
    expect(await poster(evenement)).toMatchObject({ statut: 200 });
    const releve = await emailEnBase(g, evenement.data.id);
    expect(releve).toMatchObject({ etat: "releve" });
    expect(await avisDeLEmail(releve!.id)).toHaveLength(1);
  });

  it("un email que le gestionnaire a déjà ignoré garde son état", async () => {
    const evenement = email([]);
    await poster(evenement);
    const releve = await emailEnBase(g, evenement.data.id);
    expect(await traiterEmail(g.client, releve!.id, "ignore")).toBe(true);
    await poster(evenement);
    expect(await emailEnBase(g, evenement.data.id)).toMatchObject({ etat: "ignore" });
  });
});

describe("relève sous la clé secrète : l'entreprise de l'avis fait foi", () => {
  let a: Gestionnaire;
  let b: Gestionnaire;
  let connexion: Awaited<ReturnType<typeof connecter>>;

  beforeAll(async () => {
    [a, b] = await Promise.all([compte("ent-a"), compte("ent-b")]);
    connexion = await connecter(a);
  });

  async function relever(nom: string) {
    const evenement = evenementEmail({ declencheur: connexion.declencheur_id, compte: connexion.compte_id, pieces: [piece({ nom })] });
    const { aLire } = await poster(evenement);
    return aLire[0];
  }

  /** Un avis de l'entreprise, déjà identifié par son n°. */
  async function avisNumerote(g: Gestionnaire, numero: string) {
    const { error } = await admin.from("avis").insert({
      entreprise_id: g.entrepriseId,
      fichier: await envoyerFichierAvis(g),
      fichier_type: "image/png",
      numero,
    });
    if (error) throw error;
  }

  it("un n° déjà pris dans l'entreprise abandonne le dépôt relevé, fichier compris", async () => {
    await avisNumerote(a, "7770000002");
    const id = await relever("doublon.pdf");
    const { fichier } = (await avisEnBase(id))!;
    const resultat = await lireEtRemplirAvis(admin, id, lecteur({ numero: "7770000002" }));
    expect(resultat).toMatchObject({ lecture: "doublon", existant: { numero: "7770000002" } });
    expect(await avisEnBase(id)).toBeNull();
    const { data } = await admin.storage.from(BUCKET_AVIS).list(a.entrepriseId, { search: fichier.split("/")[1] });
    expect(data).toEqual([]);
  });

  it("un n° porté par une autre entreprise n'est pas un doublon", async () => {
    await avisNumerote(b, "7770000003");
    const id = await relever("autre-entreprise.pdf");
    expect(await lireEtRemplirAvis(admin, id, lecteur({ numero: "7770000003" }))).toEqual({ lecture: "lue" });
    expect(await avisEnBase(id)).toMatchObject({ numero: "7770000003", entreprise_id: a.entrepriseId });
  });

  it("une plaque présente dans deux entreprises rattache le véhicule de l'entreprise de l'avis", async () => {
    const [deA, deB] = await Promise.all([
      creerVehicule(a.client, { plaque: "GM-202-BB", type: "attitre" }),
      creerVehicule(b.client, { plaque: "GM-202-BB", type: "attitre" }),
    ]);
    if (!deA.ok || !deB.ok) throw new Error("véhicules");
    const id = await relever("plaque.pdf");
    expect(await lireEtRemplirAvis(admin, id, lecteur({ numero: "7770000004", plaque: "GM-202-BB" }))).toEqual({
      lecture: "lue",
    });
    expect(await avisEnBase(id)).toMatchObject({ vehicule_id: deA.vehicule.id });
  });
});

describe("interruption de la relève", () => {
  it("un compte expiré date l'interruption et prévient le gestionnaire une seule fois", async () => {
    const g = await compte("expire");
    const connexion = await connecter(g);
    const { envoyeur, envoyes } = fauxEnvoyeur();

    expect(await poster(evenementExpiration(connexion.compte_id), { envoyeur })).toMatchObject({
      statut: 200,
      message: "interruption signalée",
    });
    expect(await poster(evenementExpiration(connexion.compte_id), { envoyeur })).toMatchObject({
      statut: 200,
      message: "interruption déjà signalée",
    });
    expect(envoyes).toHaveLength(1);
    expect(envoyes[0]).toMatchObject({ a: `gmail-expire-${suffixe}@exemple.fr`, sujet: SUJET_INTERRUPTION });
    const { data } = await lireConnexionGmail(admin, g.entrepriseId);
    expect(data?.interrompue_le).not.toBeNull();
    expect(data?.interruption_signalee_le).not.toBeNull();
  });

  it("avec un agenda connecté à côté (phase 22), l'expiration de Gmail ne change pas, et ne touche pas l'agenda", async () => {
    const g = await compte("expire-agenda");
    const connexion = await connecter(g);
    const agenda = await admin.from("connexion_google").insert({
      entreprise_id: g.entrepriseId,
      service: "agenda",
      compte_id: idComposio("ca"),
      agenda_id: `designo-${suffixe}@group.calendar.google.com`,
      active_depuis: new Date().toISOString(),
    });
    if (agenda.error) throw agenda.error;
    const { envoyeur, envoyes } = fauxEnvoyeur();

    expect(await poster(evenementExpiration(connexion.compte_id), { envoyeur })).toMatchObject({
      statut: 200,
      message: "interruption signalée",
    });
    expect(envoyes).toHaveLength(1);
    const { data } = await admin
      .from("connexion_google")
      .select("service, interrompue_le")
      .eq("entreprise_id", g.entrepriseId)
      .order("service");
    expect(data).toEqual([
      { service: "gmail", interrompue_le: expect.any(String) },
      { service: "agenda", interrompue_le: null },
    ]);
  });

  it("un envoi en échec libère le signalement : Composio relance, et l'email part", async () => {
    const g = await compte("expire-panne");
    const connexion = await connecter(g);
    expect(await poster(evenementExpiration(connexion.compte_id), { envoyeur: enPanne })).toMatchObject({ statut: 500 });
    const { envoyeur, envoyes } = fauxEnvoyeur();
    expect(await poster(evenementExpiration(connexion.compte_id), { envoyeur })).toMatchObject({ statut: 200 });
    expect(envoyes).toHaveLength(1);
  });

  it("en Free, l'interruption est datée, sans email", async () => {
    const g = await compte("expire-free", { pro: false });
    const connexion = await connecter(g);
    const { envoyeur, envoyes } = fauxEnvoyeur();
    expect(await poster(evenementExpiration(connexion.compte_id), { envoyeur })).toMatchObject({ statut: 200 });
    expect(envoyes).toEqual([]);
    expect((await lireConnexionGmail(admin, g.entrepriseId)).data?.interrompue_le).not.toBeNull();
  });

  it("un téléchargement refusé interrompt la relève, et l'email va dans les non exploitables", async () => {
    const g = await compte("refus");
    const connexion = await connecter(g);
    const { envoyeur, envoyes } = fauxEnvoyeur();
    const evenement = evenementEmail({ declencheur: connexion.declencheur_id, compte: connexion.compte_id, pieces: [piece({ nom: "avis.pdf" })] });
    expect(await poster(evenement, { composio: fauxComposio({ refus: true }).client, envoyeur })).toMatchObject({
      statut: 200,
    });
    expect(await emailEnBase(g, evenement.data.id)).toMatchObject({
      etat: "non_exploitable",
      ecarts: [{ nom: "avis.pdf", motif: "connexion" }],
    });
    expect(envoyes).toHaveLength(1);
    expect((await lireConnexionGmail(admin, g.entrepriseId)).data?.interrompue_le).not.toBeNull();
  });
});

describe("connexion de la boîte", () => {
  let g: Gestionnaire;

  beforeEach(async () => {
    g = await compte(`connexion-${Math.random().toString(36).slice(2, 6)}`);
  });

  it("le lien de connexion est réservé au Pro, et revient sur l'écran Intégrations", async () => {
    const { client } = fauxComposio();
    const resultat = await demarrerConnexion({ supabase: g.client, composio: client, urlSite: URL_SITE });
    expect(resultat).toMatchObject({ ok: true });
    expect(client.lienConnexion).toHaveBeenCalledWith(g.entrepriseId, `${URL_SITE}/parametres/integrations/retour`);

    await admin.from("entreprise").update({ plan: "free" }).eq("id", g.entrepriseId);
    expect(await demarrerConnexion({ supabase: g.client, composio: client, urlSite: URL_SITE })).toEqual({
      ok: false,
      erreur: MESSAGES_GMAIL.fonctionPro,
    });
    expect(await demarrerConnexion({ supabase: g.client, composio: null, urlSite: URL_SITE })).toEqual({
      ok: false,
      erreur: MESSAGES_GMAIL.indisponible,
    });
  });

  it("le retour enregistre un compte actif de l'entreprise, et refuse un compte venu d'ailleurs", async () => {
    const etranger = fauxComposio({ statut: null }).client;
    const retour = (composio: ClientComposio, compteId = idComposio("ca")) =>
      enregistrerRetour({ supabase: g.client, admin, composio, compteId, attente: 0 });
    expect(await retour(etranger)).toEqual({ ok: false, erreur: MESSAGES_GMAIL.compteInconnu });
    expect(await retour(fauxComposio({ statut: "FAILED" }).client)).toEqual({
      ok: false,
      erreur: MESSAGES_GMAIL.connexionRefusee,
    });
    expect(await retour(fauxComposio().client, "pas-un-compte")).toMatchObject({ ok: false });

    const compteId = idComposio("ca");
    expect(await retour(fauxComposio().client, compteId)).toEqual({ ok: true, reconnecte: false });
    // Le gestionnaire lit sa connexion, sous sa session.
    expect((await lireConnexionGmail(g.client)).data).toMatchObject({
      compte_id: compteId,
      email_compte: "boite@exemple.fr",
      libelle_id: null,
      declencheur_id: null,
    });
  });

  it("choisir un libellé crée le déclencheur ; en changer supprime l'ancien", async () => {
    const autre = { id: "Label_autre", nom: "Contraventions" };
    const { client } = fauxComposio({ libelles: [LIBELLE, autre] });
    await enregistrerRetour({ supabase: g.client, admin, composio: client, compteId: idComposio("ca"), attente: 0 });

    const choisir = (libelleId: string) => choisirLibelle({ supabase: g.client, admin, composio: client, libelleId });
    expect(await choisir("Label_inconnu")).toEqual({ ok: false, erreur: MESSAGES_GMAIL.libelleIntrouvable });
    expect(await choisir("")).toEqual({ ok: false, erreur: MESSAGES_GMAIL.libelleVide });
    expect(await choisir(LIBELLE.id)).toEqual({ ok: true });
    const premier = (await lireConnexionGmail(g.client)).data!;
    expect(premier).toMatchObject({ libelle_id: LIBELLE.id, libelle_nom: "Avis", active_depuis: expect.any(String) });

    expect(await choisir(autre.id)).toEqual({ ok: true });
    const second = (await lireConnexionGmail(g.client)).data!;
    expect(second).toMatchObject({ libelle_id: autre.id, libelle_nom: "Contraventions" });
    expect(second.declencheur_id).not.toBe(premier.declencheur_id);
    expect(client.supprimerDeclencheur).toHaveBeenCalledWith(premier.declencheur_id);
  });

  it("une reconnexion garde le libellé, relance la relève et oublie l'ancien compte chez Composio", async () => {
    const ancienne = await connecter(g, { interrompue_le: new Date().toISOString(), interruption_signalee_le: new Date().toISOString() });
    const { client } = fauxComposio();
    const compteId = idComposio("ca");
    expect(await enregistrerRetour({ supabase: g.client, admin, composio: client, compteId, attente: 0 })).toEqual({
      ok: true,
      reconnecte: true,
    });
    const nouvelle = (await lireConnexionGmail(g.client)).data!;
    expect(nouvelle).toMatchObject({
      compte_id: compteId,
      libelle_id: LIBELLE.id,
      interrompue_le: null,
      interruption_signalee_le: null,
    });
    expect(nouvelle.declencheur_id).not.toBe(ancienne.declencheur_id);
    expect(client.creerDeclencheur).toHaveBeenCalledWith(g.entrepriseId, compteId, LIBELLE.id);
    expect(client.supprimerDeclencheur).toHaveBeenCalledWith(ancienne.declencheur_id);
    expect(client.supprimerCompte).toHaveBeenCalledWith(ancienne.compte_id);
  });

  it("déconnecter révoque le compte chez Composio, efface la connexion, et garde les avis relevés", async () => {
    const connexion = await connecter(g);
    await poster(evenementEmail({ declencheur: connexion.declencheur_id, compte: connexion.compte_id, pieces: [piece({ nom: "garde.pdf" })] }));
    const { client } = fauxComposio();
    await deconnecterGmail({ admin, composio: client, entrepriseId: g.entrepriseId });
    expect(client.supprimerDeclencheur).toHaveBeenCalledWith(connexion.declencheur_id);
    expect(client.supprimerCompte).toHaveBeenCalledWith(connexion.compte_id);
    expect((await lireConnexionGmail(admin, g.entrepriseId)).data).toBeNull();
    const { count } = await admin.from("avis").select("id", { count: "exact", head: true }).eq("entreprise_id", g.entrepriseId);
    expect(count).toBe(1);
  });
});

describe("RLS et dépôt manuel", () => {
  let a: Gestionnaire;
  let b: Gestionnaire;
  let emailA: string;

  beforeAll(async () => {
    [a, b] = await Promise.all([compte("rls-a"), compte("rls-b")]);
    const connexion = await connecter(a);
    const evenement = evenementEmail({ declencheur: connexion.declencheur_id, compte: connexion.compte_id });
    await poster(evenement);
    emailA = (await emailEnBase(a, evenement.data.id))!.id;
  });

  it("chacun ne voit que sa connexion et ses emails", async () => {
    expect((await lireConnexionGmail(a.client)).data).not.toBeNull();
    expect((await lireConnexionGmail(b.client)).data).toBeNull();
    const { data } = await b.client.from("email_gmail").select("id").eq("id", emailA);
    expect(data).toEqual([]);
  });

  it("le gestionnaire n'écrit pas sa connexion : seul le serveur le fait", async () => {
    const insertion = await a.client
      .from("connexion_google")
      .insert({ entreprise_id: a.entrepriseId, service: "gmail", compte_id: idComposio("ca") });
    expect(insertion.error).not.toBeNull();
    const modification = await a.client.from("connexion_google").update({ interrompue_le: null }).eq("entreprise_id", a.entrepriseId).select("id");
    expect(modification.error ?? modification.data).toBeTruthy();
    expect(modification.data ?? []).toEqual([]);
  });

  it("un autre gestionnaire n'ignore pas l'email, et le gestionnaire ne le remet pas « relevé »", async () => {
    expect(await traiterEmail(b.client, emailA, "ignore")).toBe(false);
    const retour = await a.client.from("email_gmail").update({ etat: "releve" }).eq("id", emailA).select("id");
    expect(retour.data ?? []).toEqual([]);
  });

  it("le dépôt manuel rattache l'avis à l'email ; l'email d'une autre entreprise est refusé", async () => {
    const refuse = await creerAvis(b.client, { chemin: await envoyerFichierAvis(b), nom: "avis.png", emailGmailId: emailA });
    expect(refuse).toEqual({ ok: false, erreur: MESSAGES_AVIS.enregistrementImpossible });

    const depot = await creerAvis(a.client, { chemin: await envoyerFichierAvis(a), nom: "avis.png", emailGmailId: emailA });
    if (!depot.ok) throw new Error(depot.erreur);
    expect(await avisEnBase(depot.id)).toMatchObject({ email_gmail_id: emailA, source: "depot", piece_jointe: null });
    expect(await traiterEmail(a.client, emailA, "depose")).toBe(true);
    expect(await traiterEmail(a.client, emailA, "ignore")).toBe(false);
    const { data } = await a.client.from("email_gmail").select("etat, traite_le").eq("id", emailA).single();
    expect(data).toMatchObject({ etat: "depose", traite_le: expect.any(String) });
  });
});
