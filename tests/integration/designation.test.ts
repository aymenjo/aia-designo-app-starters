import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { marquerDesigne, modifierAvis, validerConducteur } from "@/lib/avis/avis";
import { MESSAGES_AVIS, type SaisieAvis } from "@/lib/avis/regles";
import { completerFiche, enregistrerFiche } from "@/lib/entreprise/fiche";
import { MESSAGES as MESSAGES_ENTREPRISE } from "@/lib/entreprise/regles";
import { archiverConducteur, completerConducteur, creerConducteur } from "@/lib/flotte/conducteurs";
import { MESSAGES, type SaisieConducteur } from "@/lib/flotte/regles";
import { creerVehicule } from "@/lib/flotte/vehicules";
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

// « J'ai désigné sur l'ANTAI » et la complétion des fiches depuis le récap (phase 11), sous la session du gestionnaire.

const suffixe = suffixeUnique();
let a: Gestionnaire;
let b: Gestionnaire;

const FICHE = {
  raison_sociale: "Plomberie Martin SARL",
  siren: "404833048",
  tva: "FR83404833048",
  representant_prenom: "Claire",
  representant_nom: "Martin",
  representant_fonction: "Gérante",
  siege_adresse: "12 rue des Lilas",
  siege_code_postal: "69003",
  siege_ville: "Lyon",
};

/** Une fiche conducteur complète : le récap s'ouvre. */
const fiche = (prenom: string, nom: string, permis: string): SaisieConducteur => ({
  civilite: "m",
  prenom,
  nom,
  date_naissance: "12/03/1985",
  adresse: "3 allée des Peupliers",
  code_postal: "93100",
  ville: "Montreuil",
  permis_numero: permis,
  permis_delivre_le: "01/06/2004",
});

beforeAll(async () => {
  a = await premiereConnexion(`designation-a-${suffixe}@exemple.fr`);
  b = await premiereConnexion(`designation-b-${suffixe}@exemple.fr`);
  // Plus de 3 véhicules actifs ou de 5 avis par mois : le plan Free a ses propres tests (plan-free.test.ts).
  await Promise.all([passerEnPro(a.entrepriseId), passerEnPro(b.entrepriseId)]);
  const enregistree = await enregistrerFiche(a.client, FICHE);
  if (!enregistree.ok) throw new Error(`fiche : ${JSON.stringify(enregistree.erreurs)}`);
});

afterAll(async () => {
  for (const g of [a, b]) if (g) await supprimerGestionnaire(g);
});

async function vehicule(g: Gestionnaire, plaque: string) {
  const cree = await creerVehicule(g.client, { plaque, type: "attitre" });
  if (!cree.ok) throw new Error(`véhicule ${plaque} : ${JSON.stringify(cree.erreurs)}`);
}

async function conducteur(g: Gestionnaire, saisie: SaisieConducteur) {
  const cree = await creerConducteur(g.client, saisie);
  if (!cree.ok) throw new Error(`conducteur ${saisie.prenom} : ${JSON.stringify(cree.erreurs)}`);
  return cree.conducteur.id;
}

const complet = (numero: string, plaque: string): SaisieAvis => ({
  numero,
  plaque,
  infraction_date: "03/10/2026",
  infraction_heure: "08:30",
  lieu: "A6, Auxerre",
  infraction: "Excès de vitesse inférieur à 20 km/h",
  montant: "135",
  date_envoi: "06/10/2026",
});

/** Un avis « À valider » rattaché au véhicule, et son conducteur validé s'il est donné. */
async function avisAValider(g: Gestionnaire, numero: string, plaque: string, conducteurId?: string) {
  const { id } = await deposerAvis(g);
  const modifie = await modifierAvis(g.client, id, complet(numero, plaque));
  if (!modifie.ok) throw new Error(`avis : ${JSON.stringify(modifie.erreurs)}`);
  if (conducteurId) {
    const valide = await validerConducteur(g.client, id, conducteurId);
    if (!valide.ok) throw new Error(`validation : ${JSON.stringify(valide.erreurs)}`);
  }
  return id;
}

const refus = (general: string) => ({ ok: false, erreurs: { general } });

describe("marquerDesigne", () => {
  let karim: string;

  beforeAll(async () => {
    await vehicule(a, "DS-101-AA");
    karim = await conducteur(a, fiche("Karim", "Benali", "090169201087"));
  });

  it("passe l'avis « Désigné », avec la date du clic", async () => {
    const id = await avisAValider(a, "6100000001", "DS-101-AA", karim);
    const avant = Date.now();
    const resultat = await marquerDesigne(a.client, id);

    expect(resultat).toMatchObject({ ok: true, avis: { id, statut: "designe", conducteur_id: karim } });
    const enBase = await avisEnBase(id);
    expect(enBase?.statut).toBe("designe");
    const clic = Date.parse(enBase?.designe_le);
    expect(clic).toBeGreaterThanOrEqual(avant - 1_000);
    expect(clic).toBeLessThanOrEqual(Date.now() + 1_000);

    // Un second clic ne change rien : la date reste celle du premier.
    expect(await marquerDesigne(a.client, id)).toEqual(refus(MESSAGES_AVIS.dejaDesigne));
    expect((await avisEnBase(id))?.designe_le).toBe(enBase?.designe_le);
  });

  it("refusée sur un avis « À traiter »", async () => {
    const { id } = await deposerAvis(a);
    expect(await marquerDesigne(a.client, id)).toEqual(refus(MESSAGES_AVIS.validationAvantVerification));
    expect((await avisEnBase(id))?.statut).toBe("a_traiter");
  });

  it("refusée sans conducteur validé : jamais d'office, même s'il n'y a qu'un candidat", async () => {
    const id = await avisAValider(a, "6100000002", "DS-101-AA");
    expect(await marquerDesigne(a.client, id)).toEqual(refus(MESSAGES_AVIS.recapSansConducteur));
    expect(await avisEnBase(id)).toMatchObject({ statut: "a_valider", designe_le: null });
  });

  it("refusée quand le conducteur validé a été archivé depuis", async () => {
    const nora = await conducteur(a, fiche("Nora", "Archivée", "190169201087"));
    const id = await avisAValider(a, "6100000003", "DS-101-AA", nora);
    expect((await archiverConducteur(a.client, nora)).ok).toBe(true);
    expect(await marquerDesigne(a.client, id)).toEqual(refus(MESSAGES_AVIS.recapConducteurArchive("Nora Archivée")));
    expect((await avisEnBase(id))?.statut).toBe("a_valider");
  });

  it("refusée tant que la fiche du conducteur est incomplète", async () => {
    const paul = await conducteur(a, { prenom: "Paul", nom: "Incomplet" });
    const id = await avisAValider(a, "6100000004", "DS-101-AA", paul);
    expect(await marquerDesigne(a.client, id)).toEqual(refus(MESSAGES_AVIS.recapIncomplet));
    expect((await avisEnBase(id))?.statut).toBe("a_valider");
  });

  it("refusée tant que la fiche entreprise est incomplète", async () => {
    await vehicule(b, "DS-202-BB");
    const lea = await conducteur(b, fiche("Léa", "Martin", "290169201087"));
    const id = await avisAValider(b, "6200000001", "DS-202-BB", lea);
    expect(await marquerDesigne(b.client, id)).toEqual(refus(MESSAGES_AVIS.recapIncomplet));

    const completee = await enregistrerFiche(b.client, FICHE);
    expect(completee.ok).toBe(true);
    expect((await marquerDesigne(b.client, id)).ok).toBe(true);
  });

  it("isolation (RLS) : l'avis d'une autre entreprise est introuvable", async () => {
    const id = await avisAValider(a, "6100000005", "DS-101-AA", karim);
    expect(await marquerDesigne(b.client, id)).toEqual(refus(MESSAGES_AVIS.avisIntrouvable));
    expect((await avisEnBase(id))?.statut).toBe("a_valider");
  });

  it("en base : un avis désigné est toujours daté, et jamais sans conducteur", async () => {
    const sansConducteur = await avisAValider(a, "6100000006", "DS-101-AA");
    const direct = (champs: Record<string, unknown>) => a.client.from("avis").update(champs).eq("id", sansConducteur);

    expect((await direct({ statut: "designe" })).error?.code).toBe("23514");
    expect((await direct({ statut: "designe", designe_le: new Date().toISOString() })).error?.code).toBe("23514");
    // Et une date de désignation sans le statut.
    expect((await direct({ designe_le: new Date().toISOString() })).error?.code).toBe("23514");
    expect(await avisEnBase(sansConducteur)).toMatchObject({ statut: "a_valider", designe_le: null });
  });
});

describe("completerConducteur", () => {
  it("complète les champs saisis, sans effacer les autres", async () => {
    const id = await conducteur(a, { prenom: "Inès", nom: "Partielle", permis_numero: "390169201087", email: "ines@exemple.fr" });
    const resultat = await completerConducteur(a.client, id, { date_naissance: "12/03/1985", ville: "Montreuil" });
    expect(resultat).toMatchObject({
      ok: true,
      conducteur: {
        prenom: "Inès",
        nom: "Partielle",
        permis_numero: "390169201087",
        email: "ines@exemple.fr",
        date_naissance: "1985-03-12",
        ville: "Montreuil",
      },
    });
  });

  it("une erreur porte sur le champ saisi, et rien n'est écrit", async () => {
    const id = await conducteur(a, { prenom: "Omar", nom: "Fautif" });
    expect(await completerConducteur(a.client, id, { code_postal: "75", ville: "Paris" })).toEqual({
      ok: false,
      erreurs: { code_postal: MESSAGES.codePostalMalForme },
    });
    const { data } = await admin.from("conducteur").select("code_postal, ville").eq("id", id).single();
    expect(data).toEqual({ code_postal: null, ville: null });
  });

  it("les règles croisées s'appliquent avec les champs déjà enregistrés", async () => {
    const id = await conducteur(a, { prenom: "Yanis", nom: "Croise", permis_delivre_le: "01/06/2004" });
    // Né en 1995, il aurait eu son permis à 9 ans : la délivrance, non saisie ici, est refusée.
    expect(await completerConducteur(a.client, id, { date_naissance: "12/03/1995" })).toEqual({
      ok: false,
      erreurs: { permis_delivre_le: MESSAGES.delivranceTropTot },
    });
  });

  it("le conducteur d'une autre entreprise est introuvable (RLS)", async () => {
    const id = await conducteur(a, { prenom: "Rose", nom: "Isolée" });
    expect(await completerConducteur(b.client, id, { ville: "Lyon" })).toEqual({
      ok: false,
      erreurs: { general: MESSAGES.conducteurIntrouvable },
    });
  });
});

describe("completerFiche", () => {
  let c: Gestionnaire;

  beforeAll(async () => {
    c = await premiereConnexion(`designation-c-${suffixe}@exemple.fr`);
    const enregistree = await enregistrerFiche(c.client, { raison_sociale: "Chauffage Durand", siren: "404833048" });
    if (!enregistree.ok) throw new Error(`fiche : ${JSON.stringify(enregistree.erreurs)}`);
  });

  afterAll(async () => {
    if (c) await supprimerGestionnaire(c);
  });

  it("complète les champs saisis, sans effacer les autres", async () => {
    const resultat = await completerFiche(c.client, { tva: "FR83404833048", siege_ville: "Lyon" });
    expect(resultat).toMatchObject({
      ok: true,
      fiche: { raison_sociale: "Chauffage Durand", siren: "404833048", tva: "FR83404833048", siege_ville: "Lyon" },
    });
  });

  it("une erreur porte sur le champ saisi", async () => {
    expect(await completerFiche(c.client, { siege_code_postal: "69" })).toEqual({
      ok: false,
      erreurs: { siege_code_postal: MESSAGES_ENTREPRISE.codePostalMalForme },
    });
  });

  it("la TVA enregistrée doit porter le SIREN saisi", async () => {
    expect(await completerFiche(c.client, { siren: "552032534" })).toEqual({
      ok: false,
      erreurs: { tva: MESSAGES_ENTREPRISE.tvaIncoherente("FR27552032534") },
    });
    const { data } = await admin.from("entreprise").select("siren").eq("id", c.entrepriseId).single();
    expect(data?.siren).toBe("404833048");
  });
});
