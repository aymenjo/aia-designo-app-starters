import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { classerAvis, marquerDesigne, modifierAvis, rouvrirAvis, validerConducteur } from "@/lib/avis/avis";
import { MESSAGES_AVIS, type SaisieAvis } from "@/lib/avis/regles";
import { enregistrerFiche } from "@/lib/entreprise/fiche";
import { creerConducteur } from "@/lib/flotte/conducteurs";
import { creerVehicule } from "@/lib/flotte/vehicules";
import {
  avisEnBase,
  deposerAvis,
  passerEnPro,
  premiereConnexion,
  suffixeUnique,
  supprimerGestionnaire,
  type Gestionnaire,
} from "./outils";

// Classer et rouvrir un avis (phase 12), sous la session du gestionnaire.

const suffixe = suffixeUnique();
let a: Gestionnaire;
let b: Gestionnaire;
let karim: string;

beforeAll(async () => {
  a = await premiereConnexion(`classement-a-${suffixe}@exemple.fr`);
  b = await premiereConnexion(`classement-b-${suffixe}@exemple.fr`);
  // Plus de 3 véhicules actifs ou de 5 avis par mois : le plan Free a ses propres tests (plan-free.test.ts).
  await Promise.all([passerEnPro(a.entrepriseId), passerEnPro(b.entrepriseId)]);
  // Les deux fiches complètes : un avis de A peut être désigné.
  const fiche = await enregistrerFiche(a.client, {
    raison_sociale: "Plomberie Martin SARL",
    siren: "404833048",
    tva: "FR83404833048",
    representant_prenom: "Claire",
    representant_nom: "Martin",
    representant_fonction: "Gérante",
    siege_adresse: "12 rue des Lilas",
    siege_code_postal: "69003",
    siege_ville: "Lyon",
  });
  if (!fiche.ok) throw new Error(`fiche : ${JSON.stringify(fiche.erreurs)}`);
  const vehicule = await creerVehicule(a.client, { plaque: "CL-101-AA", type: "attitre" });
  if (!vehicule.ok) throw new Error(`véhicule : ${JSON.stringify(vehicule.erreurs)}`);
  const conducteur = await creerConducteur(a.client, {
    civilite: "m",
    prenom: "Karim",
    nom: "Benali",
    date_naissance: "12/03/1985",
    adresse: "3 allée des Peupliers",
    code_postal: "93100",
    ville: "Montreuil",
    permis_numero: "090169201087",
    permis_delivre_le: "01/06/2004",
  });
  if (!conducteur.ok) throw new Error(`conducteur : ${JSON.stringify(conducteur.erreurs)}`);
  karim = conducteur.conducteur.id;
});

afterAll(async () => {
  for (const g of [a, b]) if (g) await supprimerGestionnaire(g);
});

const complet = (numero: string): SaisieAvis => ({
  numero,
  plaque: "CL-101-AA",
  infraction_date: "03/10/2026",
  infraction_heure: "08:30",
  lieu: "A6, Auxerre",
  infraction: "Excès de vitesse inférieur à 20 km/h",
  montant: "135",
  date_envoi: "06/10/2026",
});

/** Un avis « À valider » de A, avec Karim validé ; désigné si demandé. */
async function avisDeA(numero: string, { designe = false } = {}) {
  const { id } = await deposerAvis(a);
  const modifie = await modifierAvis(a.client, id, complet(numero));
  if (!modifie.ok) throw new Error(`avis : ${JSON.stringify(modifie.erreurs)}`);
  const valide = await validerConducteur(a.client, id, karim);
  if (!valide.ok) throw new Error(`validation : ${JSON.stringify(valide.erreurs)}`);
  if (designe) {
    const designation = await marquerDesigne(a.client, id);
    if (!designation.ok) throw new Error(`désignation : ${JSON.stringify(designation.erreurs)}`);
  }
  return id;
}

const refus = (general: string) => ({ ok: false, erreurs: { general } });

/** Le clic a eu lieu à l'instant. */
function dateDuClic(instant: string | null | undefined) {
  expect(Math.abs(Date.parse(instant ?? "") - Date.now())).toBeLessThan(5_000);
}

describe("classerAvis", () => {
  it("classe un avis « À traiter », avec son motif et la date du clic", async () => {
    const { id } = await deposerAvis(a);
    const resultat = await classerAvis(a.client, id, { motif: "conteste" });

    expect(resultat).toMatchObject({ ok: true, avis: { id, statut: "classe", motif_classement: "conteste" } });
    const enBase = await avisEnBase(id);
    expect(enBase).toMatchObject({ statut: "classe", motif_classement: "conteste", motif_libre: null, designe_le: null });
    dateDuClic(enBase?.classe_le);
  });

  it("classe un avis « À valider », et garde son conducteur validé", async () => {
    const id = await avisDeA("7100000001");
    expect((await classerAvis(a.client, id, { motif: "vol_usurpation" })).ok).toBe(true);
    expect(await avisEnBase(id)).toMatchObject({ statut: "classe", motif_classement: "vol_usurpation", conducteur_id: karim });
  });

  it("classe un avis désigné : sa date de désignation est effacée, son conducteur gardé", async () => {
    const id = await avisDeA("7100000002", { designe: true });
    expect((await classerAvis(a.client, id, { motif: "non_soumis" })).ok).toBe(true);
    expect(await avisEnBase(id)).toMatchObject({ statut: "classe", designe_le: null, conducteur_id: karim });
  });

  it("« Autre » garde le motif en toutes lettres", async () => {
    const { id } = await deposerAvis(a);
    expect((await classerAvis(a.client, id, { motif: "autre", motif_libre: "  Déposé deux fois " })).ok).toBe(true);
    expect(await avisEnBase(id)).toMatchObject({ motif_classement: "autre", motif_libre: "Déposé deux fois" });
  });

  it("refusé sans motif, ou pour « Autre » sans texte : rien n'est écrit", async () => {
    const { id } = await deposerAvis(a);
    expect(await classerAvis(a.client, id, {})).toEqual({ ok: false, erreurs: { motif: MESSAGES_AVIS.motifVide } });
    expect(await classerAvis(a.client, id, { motif: "autre", motif_libre: " " })).toEqual({
      ok: false,
      erreurs: { motif_libre: MESSAGES_AVIS.motifLibreVide },
    });
    expect(await avisEnBase(id)).toMatchObject({ statut: "a_traiter", motif_classement: null, classe_le: null });
  });

  it("un avis déjà classé garde son premier classement", async () => {
    const { id } = await deposerAvis(a);
    expect((await classerAvis(a.client, id, { motif: "conteste" })).ok).toBe(true);
    const premier = await avisEnBase(id);

    expect(await classerAvis(a.client, id, { motif: "non_soumis" })).toEqual(refus(MESSAGES_AVIS.dejaClasse));
    expect(await avisEnBase(id)).toMatchObject({ motif_classement: "conteste", classe_le: premier?.classe_le });
  });
});

describe("rouvrirAvis", () => {
  it("un avis désigné repasse « À valider » : la date est effacée, le conducteur gardé, et il se désigne à nouveau", async () => {
    const id = await avisDeA("7200000001", { designe: true });
    const resultat = await rouvrirAvis(a.client, id);

    expect(resultat).toMatchObject({ ok: true, avis: { id, statut: "a_valider", designe_le: null, conducteur_id: karim } });
    expect(await avisEnBase(id)).toMatchObject({ statut: "a_valider", designe_le: null, conducteur_id: karim });
    // Le conducteur validé redevient modifiable, et le récap rouvre.
    expect((await validerConducteur(a.client, id, karim)).ok).toBe(true);
    expect((await marquerDesigne(a.client, id)).ok).toBe(true);
  });

  it("un avis classé complet repasse « À valider », sans son classement", async () => {
    const id = await avisDeA("7200000002");
    expect((await classerAvis(a.client, id, { motif: "autre", motif_libre: "Erreur de saisie" })).ok).toBe(true);

    expect((await rouvrirAvis(a.client, id)).ok).toBe(true);
    expect(await avisEnBase(id)).toMatchObject({
      statut: "a_valider",
      classe_le: null,
      motif_classement: null,
      motif_libre: null,
      conducteur_id: karim,
    });
  });

  it("un avis classé auquel il manque des champs repasse « À traiter »", async () => {
    const { id } = await deposerAvis(a);
    expect((await classerAvis(a.client, id, { motif: "conteste" })).ok).toBe(true);
    expect(await rouvrirAvis(a.client, id)).toMatchObject({ ok: true, avis: { statut: "a_traiter", classe_le: null } });
  });

  it("refusé sur un avis ouvert", async () => {
    const { id } = await deposerAvis(a);
    expect(await rouvrirAvis(a.client, id)).toEqual(refus(MESSAGES_AVIS.dejaOuvert));
    expect((await avisEnBase(id))?.statut).toBe("a_traiter");
  });
});

describe("classement en base", () => {
  it("un avis classé est toujours daté et motivé, et le texte libre n'accompagne que « Autre »", async () => {
    const { id } = await deposerAvis(a);
    const direct = (champs: Record<string, unknown>) => a.client.from("avis").update(champs).eq("id", id);
    const maintenant = new Date().toISOString();

    for (const champs of [
      { statut: "classe" },
      { statut: "classe", classe_le: maintenant },
      { statut: "classe", motif_classement: "conteste" },
      { motif_classement: "conteste" },
      { classe_le: maintenant },
      { statut: "classe", classe_le: maintenant, motif_classement: "autre" },
      { statut: "classe", classe_le: maintenant, motif_classement: "autre", motif_libre: "  " },
      { statut: "classe", classe_le: maintenant, motif_classement: "conteste", motif_libre: "Texte" },
      { statut: "classe", classe_le: maintenant, motif_classement: "autre", motif_libre: "a".repeat(201) },
    ]) {
      expect((await direct(champs)).error?.code, JSON.stringify(champs)).toBe("23514");
    }
    expect(await avisEnBase(id)).toMatchObject({ statut: "a_traiter", classe_le: null, motif_classement: null });
  });
});

describe("isolation (RLS)", () => {
  it("l'avis d'une autre entreprise ne se classe ni ne se rouvre", async () => {
    const ouvert = await avisDeA("7300000001");
    expect(await classerAvis(b.client, ouvert, { motif: "conteste" })).toEqual(refus(MESSAGES_AVIS.avisIntrouvable));
    expect((await avisEnBase(ouvert))?.statut).toBe("a_valider");

    const designe = await avisDeA("7300000002", { designe: true });
    expect(await rouvrirAvis(b.client, designe)).toEqual(refus(MESSAGES_AVIS.avisIntrouvable));
    expect((await avisEnBase(designe))?.statut).toBe("designe");
  });
});
