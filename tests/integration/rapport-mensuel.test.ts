import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as tacheRapport } from "@/app/api/cron/rapport-mensuel/route";
import type { Email, Envoyeur } from "@/lib/email/envoi";
import { BUCKET_RAPPORTS, cheminRapport, listerRapports } from "@/lib/rapport/liste";
import { produireRapports } from "@/lib/rapport/rapports";
import {
  admin,
  passerEnPro,
  premiereConnexion,
  suffixeUnique,
  supprimerGestionnaire,
  type Gestionnaire,
} from "./outils";

// La tâche du rapport mensuel (phase 25), avec un faux envoyeur. Les jours sont simulés en 2025, un mois par scénario,
// et les entreprises antidatées : une entreprise créée aujourd'hui, par un autre test, n'a pas de rapport à recevoir
// pour 2025. Seules les lignes et les emails des entreprises de ce fichier sont vérifiés.

const suffixe = suffixeUnique();
const gestionnaires: Gestionnaire[] = [];
const emails = new Map<Gestionnaire, string>();

afterAll(async () => {
  for (const g of gestionnaires) await supprimerGestionnaire(g);
});

async function compte(nom: string, { pro = true, creeeLe = "2025-01-15T08:00:00Z" } = {}) {
  const email = `rapport-${nom}-${suffixe}@exemple.fr`;
  const g = await premiereConnexion(email);
  gestionnaires.push(g);
  emails.set(g, email);
  if (pro) await passerEnPro(g.entrepriseId);
  if (creeeLe) {
    const { error } = await admin.from("entreprise").update({ created_at: creeeLe }).eq("id", g.entrepriseId);
    if (error) throw error;
  }
  return g;
}

/** Un envoyeur qui garde les emails au lieu de les envoyer ; `enPanne` refuse ceux qui partent à cette adresse. */
function fauxEnvoyeur(enPanne?: string) {
  const envoyes: Email[] = [];
  const envoyeur: Envoyeur = async (email) => {
    const a = [email.a].flat();
    if (enPanne && a.includes(enPanne)) throw new Error("service indisponible");
    envoyes.push(email);
  };
  return { envoyeur, pour: (destinataire: string) => envoyes.filter(({ a }) => [a].flat().includes(destinataire)) };
}

async function rapportDe(g: Gestionnaire, mois: string) {
  const { data, error } = await admin
    .from("rapport_mensuel")
    .select("fichier, envoye_le, envoye_a")
    .eq("entreprise_id", g.entrepriseId)
    .eq("mois", mois)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function semerAvis(g: Gestionnaire, champs: Record<string, unknown>[]) {
  const { error } = await admin.from("avis").insert(
    champs.map((un) => ({
      entreprise_id: g.entrepriseId,
      fichier: `${g.entrepriseId}/${crypto.randomUUID()}.png`,
      fichier_type: "image/png",
      ...un,
    })),
    { defaultToNull: false },
  );
  if (error) throw error;
}

describe("produireRapports", () => {
  let a: Gestionnaire;
  const direction = [`dg-${suffixe}@exemple.fr`, `daf-${suffixe}@exemple.fr`];

  beforeAll(async () => {
    a = await compte("a");
    const { error } = await admin
      .from("entreprise")
      .update({ raison_sociale: "Plomberie Martin SARL", emails_direction: direction })
      .eq("id", a.entrepriseId);
    if (error) throw error;
    const vehicule = await admin
      .from("vehicule")
      .insert({ entreprise_id: a.entrepriseId, plaque: "RM-123-AA", type: "attitre" })
      .select("id")
      .single();
    const conducteur = await admin
      .from("conducteur")
      .insert({ entreprise_id: a.entrepriseId, prenom: "Karim", nom: "Benali" })
      .select("id")
      .single();
    if (vehicule.error || conducteur.error) throw vehicule.error ?? conducteur.error;
    await semerAvis(a, [
      { plaque: "RM-123-AA", vehicule_id: vehicule.data.id, depose_le: "2025-03-10T09:00:00Z" },
      {
        plaque: "RM-123-AA",
        vehicule_id: vehicule.data.id,
        conducteur_id: conducteur.data.id,
        date_envoi: "2025-02-20",
        statut: "designe",
        designe_le: "2025-03-12T09:00:00Z",
        depose_le: "2025-02-25T09:00:00Z",
      },
    ]);
  });

  it("archive le PDF du mois écoulé et l'envoie à la direction, avec le gestionnaire en copie", async () => {
    const { envoyeur, pour } = fauxEnvoyeur();
    const bilan = await produireRapports({ admin, envoyeur, aujourdhui: "2025-04-01" });
    expect(bilan.envoyes).toBeGreaterThanOrEqual(1);

    const rapport = await rapportDe(a, "2025-03-01");
    expect(rapport).toMatchObject({
      fichier: cheminRapport(a.entrepriseId, "2025-03-01"),
      envoye_a: [...direction, emails.get(a)],
    });
    expect(rapport?.envoye_le).not.toBeNull();
    const fichier = await admin.storage.from(BUCKET_RAPPORTS).download(rapport!.fichier);
    expect(Buffer.from(await fichier.data!.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");

    const envoyes = pour(direction[0]);
    expect(envoyes).toHaveLength(1);
    const [email] = envoyes;
    expect(email).toMatchObject({
      a: direction,
      cc: [emails.get(a)],
      sujet: "Rapport de flotte – mars 2025",
      expediteur: "Plomberie Martin SARL via Désigno",
      repondreA: emails.get(a),
    });
    expect(email.texte).toContain("Avis reçus : 1");
    expect(email.texte).toContain("Avis désignés : 1");
    expect(email.texte).toContain("Amendes de non-désignation évitées : 675 €");
    expect(email.cleIdempotence).toMatch(new RegExp(`^rapport/${a.entrepriseId}/2025-03-01/[0-9a-f]{32}$`));
    expect(email.piecesJointes).toHaveLength(1);
    const [piece] = email.piecesJointes!;
    expect(piece).toMatchObject({ nom: "rapport-flotte-2025-03.pdf", type: "application/pdf" });
    expect(piece.contenu.subarray(0, 5).toString()).toBe("%PDF-");

    // Relancée le même jour, ou un jour suivant, la tâche n'envoie rien de plus.
    const relance = fauxEnvoyeur();
    await produireRapports({ admin, envoyeur: relance.envoyeur, aujourdhui: "2025-04-01" });
    await produireRapports({ admin, envoyeur: relance.envoyeur, aujourdhui: "2025-04-02" });
    expect(relance.pour(direction[0])).toEqual([]);
  });

  it("ne produit rien en Free, ni pour une entreprise créée après le mois", async () => {
    const free = await compte("free", { pro: false });
    const recente = await compte("recente", { creeeLe: "2025-05-03T08:00:00Z" });
    const { envoyeur, pour } = fauxEnvoyeur();
    await produireRapports({ admin, envoyeur, aujourdhui: "2025-05-02" });

    expect(await rapportDe(free, "2025-04-01")).toBeNull();
    expect(await rapportDe(recente, "2025-04-01")).toBeNull();
    expect(pour(emails.get(free)!)).toEqual([]);
    expect(pour(emails.get(recente)!)).toEqual([]);
    // L'entreprise Pro qui existait en avril reçoit le rapport d'avril, même sans avis.
    expect((await rapportDe(a, "2025-04-01"))?.envoye_le).not.toBeNull();
  });

  it("sans adresse « direction », écrit au gestionnaire seul ; un envoi échoué est retenté, sans doublon", async () => {
    const seul = await compte("seul");
    const email = emails.get(seul)!;

    const panne = fauxEnvoyeur(email);
    const bilan = await produireRapports({ admin, envoyeur: panne.envoyeur, aujourdhui: "2025-06-01" });
    expect(bilan.echecs).toBeGreaterThanOrEqual(1);
    // Le PDF est archivé, mais l'envoi est libéré pour la relance.
    const archive = await rapportDe(seul, "2025-05-01");
    expect(archive).toMatchObject({ envoye_le: null, envoye_a: null });
    const fichiers = await admin.storage.from(BUCKET_RAPPORTS).list(seul.entrepriseId);
    expect(fichiers.data?.map(({ name }) => name)).toEqual(["2025-05.pdf"]);

    const relance = fauxEnvoyeur();
    await produireRapports({ admin, envoyeur: relance.envoyeur, aujourdhui: "2025-06-02" });
    const envoyes = relance.pour(email);
    expect(envoyes).toHaveLength(1);
    expect(envoyes[0]).toMatchObject({ a: [email], cc: [], sujet: "Rapport de flotte – mai 2025" });
    expect(envoyes[0].texte).toContain("Ce rapport ne part qu'à vous.");
    expect(await rapportDe(seul, "2025-05-01")).toMatchObject({ envoye_a: [email] });

    const encore = fauxEnvoyeur();
    await produireRapports({ admin, envoyeur: encore.envoyeur, aujourdhui: "2025-06-03" });
    expect(encore.pour(email)).toEqual([]);
  });
});

describe("isolation et contraintes", () => {
  let a: Gestionnaire;
  let b: Gestionnaire;

  beforeAll(async () => {
    [a, b] = await Promise.all([compte("iso-a"), compte("iso-b")]);
    const { envoyeur } = fauxEnvoyeur();
    await produireRapports({ admin, envoyeur, aujourdhui: "2025-08-01" });
  });

  it("le gestionnaire lit son rapport et son PDF, jamais ceux d'une autre entreprise", async () => {
    expect((await listerRapports(a.client)).map(({ mois }) => mois)).toContain("2025-07-01");
    const sien = await a.client.storage.from(BUCKET_RAPPORTS).download(cheminRapport(a.entrepriseId, "2025-07-01"));
    expect(sien.error).toBeNull();

    const autres = await b.client.from("rapport_mensuel").select("entreprise_id").eq("entreprise_id", a.entrepriseId);
    expect(autres.data).toEqual([]);
    const fichier = await b.client.storage.from(BUCKET_RAPPORTS).download(cheminRapport(a.entrepriseId, "2025-07-01"));
    expect(fichier.error).not.toBeNull();
  });

  it("le gestionnaire n'écrit ni rapport ni fichier", async () => {
    const fichier = cheminRapport(a.entrepriseId, "2025-01-01");
    const ligne = await a.client
      .from("rapport_mensuel")
      .insert({ entreprise_id: a.entrepriseId, mois: "2025-01-01", fichier });
    expect(ligne.error).not.toBeNull();
    const envoi = await a.client
      .from("rapport_mensuel")
      .update({ envoye_le: null })
      .eq("entreprise_id", a.entrepriseId)
      .select();
    expect(envoi.data ?? []).toEqual([]);
    const depot = await a.client.storage
      .from(BUCKET_RAPPORTS)
      .upload(fichier, Buffer.from("%PDF-1.4"), { contentType: "application/pdf" });
    expect(depot.error).not.toBeNull();
  });

  it("la base n'accepte que 3 adresses « direction » au plus, en minuscules et sans doublon", async () => {
    const ecrire = (emails_direction: string[]) =>
      a.client.from("entreprise").update({ emails_direction }).eq("id", a.entrepriseId);
    expect((await ecrire(["dg@exemple.fr", "daf@exemple.fr", "rh@exemple.fr"])).error).toBeNull();
    expect((await ecrire(["a@exemple.fr", "b@exemple.fr", "c@exemple.fr", "d@exemple.fr"])).error).not.toBeNull();
    expect((await ecrire(["DG@exemple.fr"])).error).not.toBeNull();
    expect((await ecrire(["dg@exemple.fr", "dg@exemple.fr"])).error).not.toBeNull();
    expect((await ecrire([])).error).toBeNull();
  });

  it("la tâche refuse un appel sans le secret", async () => {
    const appel = (entetes: Record<string, string> = {}) =>
      tacheRapport(new Request("http://127.0.0.1:3000/api/cron/rapport-mensuel", { headers: entetes }));
    expect((await appel()).status).toBe(401);
    expect((await appel({ authorization: "Bearer mauvais" })).status).toBe(401);
  });
});
