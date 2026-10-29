import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LIMITES_FREE } from "@/lib/abonnement/plans";
import { envoyerAlertes } from "@/lib/avis/alertes";
import { classerAvis, rouvrirAvis } from "@/lib/avis/avis";
import { DELAI_DESIGNATION_JOURS } from "@/lib/avis/echeance";
import type { StatutAvis } from "@/lib/avis/regles";
import { ajouterJours } from "@/lib/dates";
import type { Email, Envoyeur } from "@/lib/email/envoi";
import { creerConducteur } from "@/lib/flotte/conducteurs";
import { admin, avisEnBase, premiereConnexion, suffixeUnique, supprimerGestionnaire, type Gestionnaire } from "./outils";

// Alertes J-15, J-7, J-2 (phase 14), avec un faux envoyeur. Les jours sont simulés en 2025, un mois par scénario :
// aucun ne croise les avis des autres tests, ni ceux d'un autre scénario.

const suffixe = suffixeUnique();
const URL_SITE = "https://designo.test";
let a: Gestionnaire;
let b: Gestionnaire;
const emailA = `alertes-a-${suffixe}@exemple.fr`;
const emailB = `alertes-b-${suffixe}@exemple.fr`;
let conducteurA: string;

beforeAll(async () => {
  a = await premiereConnexion(emailA);
  b = await premiereConnexion(emailB);
  const conducteur = await creerConducteur(a.client, { prenom: "Karim", nom: "Benali" });
  if (!conducteur.ok) throw new Error(`conducteur : ${JSON.stringify(conducteur.erreurs)}`);
  conducteurA = conducteur.conducteur.id;
});

afterAll(async () => {
  for (const g of [a, b]) if (g) await supprimerGestionnaire(g);
});

/**
 * Sème un avis hors RLS, dont l'échéance tombe le jour donné ; renvoie son id. Il est déposé le jour de son envoi : chaque
 * scénario compte dans le quota Free (5 avis par mois) de son propre mois.
 */
async function semer(g: Gestionnaire, echeance: string, champs: { statut?: StatutAvis } & Record<string, unknown> = {}) {
  const envoi = ajouterJours(echeance, -DELAI_DESIGNATION_JOURS);
  const { data, error } = await admin
    .from("avis")
    .insert({
      entreprise_id: g.entrepriseId,
      fichier: `${g.entrepriseId}/${crypto.randomUUID()}.png`,
      fichier_type: "image/png",
      plaque: "AL-001-AA",
      date_envoi: envoi,
      depose_le: `${envoi}T10:00:00Z`,
      ...champs,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

/** Un envoyeur qui garde les emails au lieu de les envoyer. */
function fauxEnvoyeur() {
  const envoyes: Email[] = [];
  const envoyeur: Envoyeur = async (email) => {
    envoyes.push(email);
  };
  return { envoyeur, pour: (destinataire: string) => envoyes.filter(({ a }) => a === destinataire) };
}

/** Les avis cités par un email, d'après leurs liens. */
function avisCites(email: Email) {
  return [...email.texte.matchAll(/\/avis\/([0-9a-f-]{36})/g)].map(([, id]) => id).toSorted();
}

async function seuilsEnvoyes(avisId: string) {
  const { data, error } = await admin.from("alerte_envoyee").select("seuil").eq("avis_id", avisId);
  if (error) throw error;
  return data.map(({ seuil }) => seuil).toSorted((x, y) => y - x);
}

const passer = (envoyeur: Envoyeur, aujourdhui: string) =>
  envoyerAlertes({ supabase: admin, envoyeur, urlSite: URL_SITE, aujourdhui });

describe("envoyerAlertes", () => {
  it("un seul email par entreprise, avec ses avis ouverts à J-15, J-7 et J-2, et rien d'autre", async () => {
    const jour = "2025-03-10";
    const a15 = await semer(a, ajouterJours(jour, 15));
    const a7 = await semer(a, ajouterJours(jour, 7), { statut: "a_valider" });
    const a2 = await semer(a, ajouterJours(jour, 2));
    await semer(a, ajouterJours(jour, 10));
    await semer(a, ajouterJours(jour, 7), {
      statut: "designe",
      conducteur_id: conducteurA,
      designe_le: new Date().toISOString(),
    });
    await semer(a, ajouterJours(jour, 7), {
      statut: "classe",
      classe_le: new Date().toISOString(),
      motif_classement: "conteste",
    });
    const b7 = await semer(b, ajouterJours(jour, 7));

    const { envoyeur, pour } = fauxEnvoyeur();
    await passer(envoyeur, jour);

    expect(pour(emailA)).toHaveLength(1);
    expect(avisCites(pour(emailA)[0])).toEqual([a15, a7, a2].toSorted());
    expect(pour(emailA)[0].sujet).toBe("3 avis à désigner · échéance la plus proche le 12/03 (J-2)");
    expect(pour(emailA)[0].html).toContain(`href="${URL_SITE}/avis/${a2}"`);
    expect(pour(emailB)).toHaveLength(1);
    expect(avisCites(pour(emailB)[0])).toEqual([b7]);
    expect(await seuilsEnvoyes(a15)).toEqual([15]);
    expect(await seuilsEnvoyes(a7)).toEqual([7]);
    expect(await seuilsEnvoyes(a2)).toEqual([2]);

    // Relancée le même jour, la tâche n'envoie rien et ne réserve rien de plus.
    const relance = fauxEnvoyeur();
    await passer(relance.envoyeur, jour);
    expect(relance.pour(emailA)).toHaveLength(0);
    expect(relance.pour(emailB)).toHaveLength(0);
    for (const id of [a15, a7, a2]) expect(await seuilsEnvoyes(id)).toHaveLength(1);
  });

  it("suivi jour par jour de J-20 à J+1, un avis reçoit ses alertes à J-15, J-7 et J-2 seulement", async () => {
    const echeance = "2025-05-31";
    const id = await semer(a, echeance);

    const jours: number[] = [];
    for (let restants = 20; restants >= -1; restants -= 1) {
      const { envoyeur, pour } = fauxEnvoyeur();
      await passer(envoyeur, ajouterJours(echeance, -restants));
      if (pour(emailA).some((email) => avisCites(email).includes(id))) jours.push(restants);
    }
    expect(jours).toEqual([15, 7, 2]);
    expect(await seuilsEnvoyes(id)).toEqual([15, 7, 2]);
  });

  it("un avis arrivé à J-10 n'a pas d'alerte J-15 : il reçoit J-7", async () => {
    const echeance = "2025-07-31";
    const id = await semer(a, echeance);

    const recus: number[] = [];
    for (const restants of [10, 9, 8, 7]) {
      const { envoyeur, pour } = fauxEnvoyeur();
      await passer(envoyeur, ajouterJours(echeance, -restants));
      if (pour(emailA).some((email) => avisCites(email).includes(id))) recus.push(restants);
    }
    expect(recus).toEqual([7]);
    expect(await seuilsEnvoyes(id)).toEqual([7]);
  });

  it("un avis classé ne reçoit plus rien ; rouvert, il reçoit les seuils suivants", async () => {
    const echeance = "2025-09-30";
    const id = await semer(a, echeance);
    const recu = async (restants: number) => {
      const { envoyeur, pour } = fauxEnvoyeur();
      await passer(envoyeur, ajouterJours(echeance, -restants));
      return pour(emailA).some((email) => avisCites(email).includes(id));
    };

    expect(await recu(15)).toBe(true);
    expect((await classerAvis(a.client, id, { motif: "conteste" })).ok).toBe(true);
    expect(await recu(7)).toBe(false);
    expect((await rouvrirAvis(a.client, id)).ok).toBe(true);
    expect(await recu(2)).toBe(true);
    expect(await seuilsEnvoyes(id)).toEqual([15, 2]);
  });

  it("si l'envoi échoue, les seuils sont libérés : une relance envoie l'email", async () => {
    const jour = "2025-11-10";
    const id = await semer(a, ajouterJours(jour, 7));
    const b2 = await semer(b, ajouterJours(jour, 2));

    // L'échec de A n'empêche pas B de recevoir le sien.
    const envoyesB: Email[] = [];
    const enPanne: Envoyeur = async (email) => {
      if (email.a === emailA) throw new Error("service indisponible");
      envoyesB.push(email);
    };
    const bilan = await passer(enPanne, jour);
    expect(bilan.echecs).toBeGreaterThanOrEqual(1);
    expect(await seuilsEnvoyes(id)).toEqual([]);
    expect(envoyesB.filter(({ a }) => a === emailB).map(avisCites)).toEqual([[b2]]);

    const { envoyeur, pour } = fauxEnvoyeur();
    await passer(envoyeur, jour);
    expect(pour(emailA).map(avisCites)).toEqual([[id]]);
    expect(pour(emailB)).toHaveLength(0);
    expect(await seuilsEnvoyes(id)).toEqual([7]);
  });

  it("un avis verrouillé (plan Free) avec sa date d'envoi reçoit ses alertes", async () => {
    // Juillet 2025 : 5 avis déposés, dont l'échéance est passée le jour de l'alerte, puis un 6e, verrouillé.
    const jour = "2025-08-25";
    for (let n = 0; n < LIMITES_FREE.avisParMois; n++) await semer(a, "2025-08-20");
    const id = await semer(a, ajouterJours(jour, 7));
    expect(await avisEnBase(id)).toMatchObject({ verrouille: true, date_envoi: "2025-07-18" });

    const { envoyeur, pour } = fauxEnvoyeur();
    await passer(envoyeur, jour);
    expect(pour(emailA).map(avisCites)).toEqual([[id]]);
    expect(await seuilsEnvoyes(id)).toEqual([7]);
  });

  it("une clé d'idempotence par entreprise, par jour et par contenu", async () => {
    const jour = "2025-12-10";
    await semer(a, ajouterJours(jour, 15));
    const { envoyeur, pour } = fauxEnvoyeur();
    await passer(envoyeur, jour);
    expect(pour(emailA)[0].cleIdempotence).toMatch(new RegExp(`^alertes/${a.entrepriseId}/${jour}/[0-9a-f]{32}$`));
  });
});

describe("alerte_envoyee", () => {
  it("le gestionnaire n'y lit ni n'y écrit rien : seule la tâche y accède", async () => {
    const lecture = await a.client.from("alerte_envoyee").select("avis_id");
    expect(lecture.error?.code).toBe("42501");
    const id = await semer(a, "2026-01-31");
    const ecriture = await a.client.from("alerte_envoyee").insert({ avis_id: id, seuil: 7 });
    expect(ecriture.error?.code).toBe("42501");
  });

  it("suit l'avis : supprimer l'entreprise emporte ses alertes", async () => {
    const c = await premiereConnexion(`alertes-c-${suffixe}@exemple.fr`);
    const jour = "2025-04-10";
    const id = await semer(c, ajouterJours(jour, 2));
    await passer(fauxEnvoyeur().envoyeur, jour);
    expect(await seuilsEnvoyes(id)).toEqual([2]);

    await supprimerGestionnaire(c);
    expect(await seuilsEnvoyes(id)).toEqual([]);
  });
});
