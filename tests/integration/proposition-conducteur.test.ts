import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  LECTURES,
  classerAvis,
  creerVehiculeDepuisAvis,
  enregistrerAffectationManquante,
  modifierAvis,
  rouvrirAvis,
  validerConducteur,
} from "@/lib/avis/avis";
import { MESSAGES_AVIS, type SaisieAvis } from "@/lib/avis/regles";
import { instantParis } from "@/lib/dates";
import { affectationCouvrante, affectationsVoisines, creerAffectation } from "@/lib/flotte/affectations";
import { archiverConducteur, creerConducteur, supprimerConducteur } from "@/lib/flotte/conducteurs";
import { MESSAGES, type SaisieAffectation } from "@/lib/flotte/regles";
import { archiverVehicule, creerVehicule, modifierVehicule } from "@/lib/flotte/vehicules";
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

const suffixe = suffixeUnique();
let a: Gestionnaire;
let b: Gestionnaire;

beforeAll(async () => {
  a = await premiereConnexion(`proposition-a-${suffixe}@exemple.fr`);
  b = await premiereConnexion(`proposition-b-${suffixe}@exemple.fr`);
  // Plus de 3 véhicules actifs ou de 5 avis par mois : le plan Free a ses propres tests (plan-free.test.ts).
  await Promise.all([passerEnPro(a.entrepriseId), passerEnPro(b.entrepriseId)]);
});

afterAll(async () => {
  for (const g of [a, b]) if (g) await supprimerGestionnaire(g);
});

async function vehicule(g: Gestionnaire, plaque: string) {
  const cree = await creerVehicule(g.client, { plaque, type: "attitre" });
  if (!cree.ok) throw new Error(`véhicule ${plaque} : ${JSON.stringify(cree.erreurs)}`);
  return cree.vehicule.id;
}

async function conducteur(g: Gestionnaire, prenom: string, nom: string) {
  const cree = await creerConducteur(g.client, { prenom, nom });
  if (!cree.ok) throw new Error(`conducteur ${prenom} : ${JSON.stringify(cree.erreurs)}`);
  return cree.conducteur.id;
}

/** Début et fin en « JJ/MM/AAAA HH:MM », à l'heure de Paris. */
function saisie(vehicule_id: string, conducteur_id: string, debut: string, fin?: string): SaisieAffectation {
  const [debut_date, debut_heure] = debut.split(" ");
  const [fin_date, fin_heure] = fin?.split(" ") ?? [];
  return { vehicule_id, conducteur_id, debut_date, debut_heure, fin_date, fin_heure };
}

async function affecter(g: Gestionnaire, ...args: Parameters<typeof saisie>) {
  const creee = await creerAffectation(g.client, saisie(...args));
  if (!creee.ok) throw new Error(`affectation : ${JSON.stringify(creee.erreurs)}`);
  return creee.affectation;
}

/** « 02/03/2026 08:00 » à Paris → l'instant ISO. */
function instant(jourHeure: string) {
  const [jour, heure] = jourHeure.split(" ");
  const [jj, mm, aaaa] = jour.split("/");
  return instantParis(`${aaaa}-${mm}-${jj}`, heure)!;
}

/** Un avis complet : il passe « À valider », rattaché au véhicule qui porte sa plaque. */
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

async function avisAValider(g: Gestionnaire, numero: string, plaque: string) {
  const { id } = await deposerAvis(g);
  const modifie = await modifierAvis(g.client, id, complet(numero, plaque));
  if (!modifie.ok) throw new Error(`avis : ${JSON.stringify(modifie.erreurs)}`);
  return id;
}

describe("affectationCouvrante : bornes [début, fin)", () => {
  let v1: string;
  let v2: string;
  let karim: string;
  let lea: string;

  beforeAll(async () => {
    v1 = await vehicule(a, "BR-101-AA");
    v2 = await vehicule(a, "BR-202-BB");
    karim = await conducteur(a, "Karim", "Benali");
    lea = await conducteur(a, "Léa", "Martin");
    // Bout à bout : Karim jusqu'à 18:00, Léa à partir de 18:00.
    await affecter(a, v1, karim, "02/03/2026 08:00", "02/03/2026 18:00");
    await affecter(a, v1, lea, "02/03/2026 18:00", "03/03/2026 08:00");
  });

  async function couvrante(vehiculeId: string, jourHeure: string) {
    const { data, error } = await affectationCouvrante(a.client, vehiculeId, instant(jourHeure));
    if (error) throw error;
    return data;
  }

  it("le début est couvert, la minute d'avant ne l'est pas", async () => {
    expect((await couvrante(v1, "02/03/2026 08:00"))?.conducteur_id).toBe(karim);
    expect(await couvrante(v1, "02/03/2026 07:59")).toBeNull();
  });

  it("la minute d'avant la fin est couverte ; la fin revient à l'affectation suivante, ou à aucune", async () => {
    expect((await couvrante(v1, "02/03/2026 17:59"))?.conducteur_id).toBe(karim);
    expect((await couvrante(v1, "02/03/2026 18:00"))?.conducteur_id).toBe(lea);
    expect(await couvrante(v1, "03/03/2026 08:00")).toBeNull();
  });

  it("une affectation ouverte couvre des mois plus tard ; celle d'un autre véhicule est ignorée", async () => {
    expect(await couvrante(v2, "02/03/2026 12:00")).toBeNull();
    await affecter(a, v2, karim, "01/04/2026 08:00");
    expect(await couvrante(v2, "02/03/2026 12:00")).toBeNull();
    expect(await couvrante(v2, "15/09/2026 10:00")).toMatchObject({
      conducteur_id: karim,
      fin: null,
      vehicule: { plaque: "BR-202-BB" },
      conducteur: { prenom: "Karim", nom: "Benali", archive_le: null },
    });
  });

  it("le conducteur archivé est renvoyé, avec sa date d'archivage", async () => {
    const v3 = await vehicule(a, "BR-303-CC");
    const paul = await conducteur(a, "Paul", "Durand");
    await affecter(a, v3, paul, "01/02/2026 08:00", "28/02/2026 18:00");
    expect((await archiverConducteur(a.client, paul)).ok).toBe(true);

    const trouvee = await couvrante(v3, "10/02/2026 12:00");
    expect(trouvee?.conducteur.id).toBe(paul);
    expect(trouvee?.conducteur.archive_le).not.toBeNull();
  });

  it("un gestionnaire ne voit pas l'affectation d'une autre entreprise", async () => {
    const { data } = await affectationCouvrante(b.client, v1, instant("02/03/2026 12:00"));
    expect(data).toBeNull();
  });
});

describe("validerConducteur", () => {
  let vehiculeA: string;
  let karim: string;
  let lea: string;
  let avisA: string;

  beforeAll(async () => {
    vehiculeA = await vehicule(a, "VC-101-AA");
    karim = await conducteur(a, "Karim", "Bensaïd");
    lea = await conducteur(a, "Léa", "Moreau");
    await affecter(a, vehiculeA, karim, "01/10/2026 08:00");
    avisA = await avisAValider(a, "5100000001", "VC-101-AA");
  });

  it("rien n'est validé d'office, même quand une affectation couvre l'infraction", async () => {
    expect(await avisEnBase(avisA)).toMatchObject({ statut: "a_valider", vehicule_id: vehiculeA, conducteur_id: null });
    const { data } = await affectationCouvrante(a.client, vehiculeA, (await avisEnBase(avisA))!.infraction_le);
    expect(data?.conducteur_id).toBe(karim);
  });

  it("le conducteur proposé se valide, puis se change pour un autre conducteur actif", async () => {
    const valide = await validerConducteur(a.client, avisA, karim);
    expect(valide).toMatchObject({ ok: true, avis: { conducteur_id: karim, conducteur: { prenom: "Karim" } } });

    const change = await validerConducteur(a.client, avisA, lea);
    expect(change).toMatchObject({ ok: true, avis: { conducteur_id: lea, conducteur: { prenom: "Léa" } } });
    expect((await avisEnBase(avisA))?.conducteur_id).toBe(lea);
  });

  it("un conducteur non choisi, inconnu ou archivé est refusé", async () => {
    expect(await validerConducteur(a.client, avisA, "")).toEqual({
      ok: false,
      erreurs: { conducteur_id: MESSAGES_AVIS.conducteurVide },
    });
    expect(await validerConducteur(a.client, avisA, "pas-un-id")).toEqual({
      ok: false,
      erreurs: { conducteur_id: MESSAGES_AVIS.conducteurIntrouvable },
    });

    const archive = await conducteur(a, "Paul", "Archivé");
    expect((await archiverConducteur(a.client, archive)).ok).toBe(true);
    expect(await validerConducteur(a.client, avisA, archive)).toEqual({
      ok: false,
      erreurs: { conducteur_id: MESSAGES_AVIS.conducteurArchiveValidation("Paul Archivé") },
    });
    expect((await avisEnBase(avisA))?.conducteur_id).toBe(lea);
  });

  it("un avis « À traiter » ou sans véhicule est refusé", async () => {
    const { id: aTraiter } = await deposerAvis(a);
    expect(await validerConducteur(a.client, aTraiter, karim)).toEqual({
      ok: false,
      erreurs: { general: MESSAGES_AVIS.validationAvantVerification },
    });

    const sansVehicule = await avisAValider(a, "5100000002", "ZZ-999-ZZ");
    expect(await avisEnBase(sansVehicule)).toMatchObject({ statut: "a_valider", vehicule_id: null });
    expect(await validerConducteur(a.client, sansVehicule, karim)).toEqual({
      ok: false,
      erreurs: { general: MESSAGES_AVIS.validationSansVehicule },
    });
    expect((await avisEnBase(sansVehicule))?.conducteur_id).toBeNull();
  });

  it("un avis désigné ou classé garde son conducteur", async () => {
    for (const statut of ["designe", "classe"] as const) {
      const id = await avisAValider(a, statut === "designe" ? "5100000003" : "5100000004", "VC-101-AA");
      expect((await validerConducteur(a.client, id, karim)).ok).toBe(true);
      // Un avis désigné porte la date du clic, un avis classé la sienne et son motif (voir les migrations).
      const maintenant = new Date().toISOString();
      const { error } = await admin
        .from("avis")
        .update(
          statut === "designe"
            ? { statut, designe_le: maintenant }
            : { statut, classe_le: maintenant, motif_classement: "conteste" },
        )
        .eq("id", id);
      expect(error).toBeNull();

      expect(await validerConducteur(a.client, id, lea)).toEqual({
        ok: false,
        erreurs: { general: MESSAGES_AVIS.conducteurFige(statut) },
      });
      expect((await avisEnBase(id))?.conducteur_id).toBe(karim);
    }
  });

  it("isolation (RLS) : ni le conducteur, ni l'avis d'une autre entreprise, même en direct", async () => {
    const conducteurB = await conducteur(b, "Léa", "Autre");
    expect(await validerConducteur(a.client, avisA, conducteurB)).toEqual({
      ok: false,
      erreurs: { conducteur_id: MESSAGES_AVIS.conducteurIntrouvable },
    });
    // La clé étrangère composite refuse, alors que sa vérification ignore la RLS.
    const { error } = await a.client.from("avis").update({ conducteur_id: conducteurB }).eq("id", avisA);
    expect(error?.code).toBe("23503");

    expect(await validerConducteur(b.client, avisA, conducteurB)).toEqual({
      ok: false,
      erreurs: { general: MESSAGES_AVIS.avisIntrouvable },
    });
    expect((await avisEnBase(avisA))?.conducteur_id).toBe(lea);
  });
});

describe("validation effacée quand le rapprochement change", () => {
  let karim: string;
  let avisA: string;

  beforeAll(async () => {
    const v1 = await vehicule(a, "EF-101-AA");
    const v2 = await vehicule(a, "EF-202-BB");
    karim = await conducteur(a, "Karim", "Effacé");
    await affecter(a, v1, karim, "01/10/2026 08:00");
    await affecter(a, v2, karim, "01/09/2026 08:00", "01/10/2026 08:00");
    avisA = await avisAValider(a, "5200000001", "EF-101-AA");
  });

  async function valider() {
    expect((await validerConducteur(a.client, avisA, karim)).ok).toBe(true);
  }

  it("corriger le lieu, ou réécrire le même instant, garde la validation", async () => {
    await valider();
    const modifie = await modifierAvis(a.client, avisA, { ...complet("5200000001", "ef 101 aa"), lieu: "A7, Valence" });
    expect(modifie).toMatchObject({ ok: true, avis: { lieu: "A7, Valence", conducteur_id: karim } });
  });

  it("corriger l'heure de l'infraction efface la validation", async () => {
    await valider();
    const modifie = await modifierAvis(a.client, avisA, { ...complet("5200000001", "EF-101-AA"), infraction_heure: "09:30" });
    expect(modifie).toMatchObject({ ok: true, avis: { statut: "a_valider", conducteur_id: null, conducteur: null } });
  });

  it("corriger la plaque, donc le véhicule, efface la validation", async () => {
    await valider();
    const modifie = await modifierAvis(a.client, avisA, complet("5200000001", "EF-202-BB"));
    expect(modifie).toMatchObject({ ok: true, avis: { conducteur_id: null } });
  });

  it("un avis désigné n'est jamais touché", async () => {
    await modifierAvis(a.client, avisA, complet("5200000001", "EF-101-AA"));
    await valider();
    const { error } = await admin
      .from("avis")
      .update({ statut: "designe", designe_le: new Date().toISOString() })
      .eq("id", avisA);
    expect(error).toBeNull();
    const modifie = await modifierAvis(a.client, avisA, complet("5200000001", "EF-202-BB"));
    expect(modifie).toMatchObject({ ok: true, avis: { statut: "designe", conducteur_id: karim } });
  });
});

describe("un conducteur validé sur un avis a un historique", () => {
  it("il ne se supprime pas : il s'archive", async () => {
    await vehicule(a, "SV-101-AA");
    const sansAffectation = await conducteur(a, "Nora", "Valide");
    const id = await avisAValider(a, "5300000001", "SV-101-AA");
    expect((await validerConducteur(a.client, id, sansAffectation)).ok).toBe(true);

    expect(await supprimerConducteur(a.client, sansAffectation)).toEqual({
      ok: false,
      erreurs: { general: MESSAGES.conducteurAvecHistorique },
    });
    expect((await archiverConducteur(a.client, sansAffectation)).ok).toBe(true);
  });
});

// Phase 13 : les cas dégradés de la proposition.

/** Les instants se comparent à la milliseconde : Supabase les renvoie en « +00:00 ». */
const iso = (instant: string | null | undefined) => (instant ? new Date(instant).toISOString() : instant);

describe("affectationsVoisines", () => {
  let v: string;
  let karim: string;
  let paul: string;

  beforeAll(async () => {
    v = await vehicule(a, "VS-101-AA");
    karim = await conducteur(a, "Karim", "Voisin");
    paul = await conducteur(a, "Paul", "Voisin");
    const lea = await conducteur(a, "Léa", "Voisine");
    await affecter(a, v, karim, "01/03/2026 08:00", "02/03/2026 18:00");
    await affecter(a, v, karim, "20/02/2026 08:00", "21/02/2026 18:00");
    // Paul, archivé, puis Léa, bout à bout.
    await affecter(a, v, paul, "05/03/2026 08:00", "06/03/2026 18:00");
    await affecter(a, v, lea, "06/03/2026 18:00", "07/03/2026 08:00");
    expect((await archiverConducteur(a.client, paul)).ok).toBe(true);
  });

  async function voisines(g: Gestionnaire, jourHeure: string) {
    const { data, error } = await affectationsVoisines(g.client, v, instant(jourHeure));
    if (error) throw error;
    return data;
  }

  it("la dernière qui finit avant, la première qui commence après, conducteur archivé compris", async () => {
    const { avant, apres } = await voisines(a, "03/03/2026 12:00");
    expect(avant).toMatchObject({ conducteur_id: karim, vehicule: { plaque: "VS-101-AA" } });
    expect(iso(avant?.fin)).toBe(instant("02/03/2026 18:00"));
    expect(apres).toMatchObject({ conducteur_id: paul, conducteur: { prenom: "Paul" } });
    expect(apres?.conducteur.archive_le).not.toBeNull();
  });

  it("bout à bout : celle qui finit à l'instant est d'avant ; celle qui commence à l'instant le couvre, et n'est pas d'après", async () => {
    const { avant, apres } = await voisines(a, "06/03/2026 18:00");
    expect(avant?.conducteur_id).toBe(paul);
    expect(apres).toBeNull();
  });

  it("un gestionnaire ne voit pas les affectations d'une autre entreprise", async () => {
    expect(await voisines(b, "03/03/2026 12:00")).toEqual({ avant: null, apres: null });
  });
});

describe("enregistrerAffectationManquante", () => {
  let v: string;
  let karim: string;
  let lea: string;
  let avisA: string;

  beforeAll(async () => {
    v = await vehicule(a, "AM-101-AA");
    karim = await conducteur(a, "Karim", "Manquant");
    lea = await conducteur(a, "Léa", "Manquante");
    // L'infraction est le 03/10/2026 à 08:30 : Karim a le véhicule jusqu'à 07:00, puis à partir de 18:00.
    await affecter(a, v, karim, "01/10/2026 08:00", "03/10/2026 07:00");
    await affecter(a, v, karim, "03/10/2026 18:00", "05/10/2026 08:00");
    avisA = await avisAValider(a, "5400000001", "AM-101-AA");
  });

  it("refusée sans conducteur validé, sur un avis « À traiter », sans véhicule, ou introuvable", async () => {
    expect(await enregistrerAffectationManquante(a.client, avisA)).toEqual({
      ok: false,
      erreurs: { general: MESSAGES_AVIS.affectationSansConducteur },
    });
    const { id: aTraiter } = await deposerAvis(a);
    expect(await enregistrerAffectationManquante(a.client, aTraiter)).toEqual({
      ok: false,
      erreurs: { general: MESSAGES_AVIS.validationAvantVerification },
    });
    const sansVehicule = await avisAValider(a, "5400000002", "ZZ-998-ZZ");
    expect(await enregistrerAffectationManquante(a.client, sansVehicule)).toEqual({
      ok: false,
      erreurs: { general: MESSAGES_AVIS.validationSansVehicule },
    });
    expect(await enregistrerAffectationManquante(a.client, "pas-un-id")).toEqual({
      ok: false,
      erreurs: { general: MESSAGES_AVIS.avisIntrouvable },
    });
  });

  it("enregistre le jour de l'infraction rogné par ses voisines ; l'infraction est alors couverte", async () => {
    expect((await validerConducteur(a.client, avisA, lea)).ok).toBe(true);
    expect(await enregistrerAffectationManquante(a.client, avisA)).toEqual({ ok: true });

    const { data } = await affectationCouvrante(a.client, v, instant("03/10/2026 08:30"));
    expect(data?.conducteur_id).toBe(lea);
    expect(iso(data?.debut)).toBe(instant("03/10/2026 07:00"));
    expect(iso(data?.fin)).toBe(instant("03/10/2026 18:00"));

    // Rien de plus : une affectation couvre déjà l'infraction.
    expect(await enregistrerAffectationManquante(a.client, avisA)).toEqual({
      ok: false,
      erreurs: { general: MESSAGES_AVIS.affectationDejaCouverte },
    });
  });

  it("une affectation écrite entre la lecture et l'écriture est nommée par le conflit", async () => {
    const v2 = await vehicule(a, "AM-202-BB");
    const id = await avisAValider(a, "5400000003", "AM-202-BB");
    expect((await validerConducteur(a.client, id, lea)).ok).toBe(true);
    // Écrite « entre-temps » : la lecture injectée ne la voit pas.
    await affecter(a, v2, karim, "03/10/2026 08:00", "03/10/2026 09:00");
    const avantEcriture = { ...LECTURES, affectationCouvrante: async () => ({ data: null, error: null }) };

    expect(await enregistrerAffectationManquante(a.client, id, avantEcriture)).toEqual({
      ok: false,
      erreurs: {
        general: MESSAGES.conflitAffectation("Karim M.", "AM-202-BB", instant("03/10/2026 08:00"), instant("03/10/2026 09:00")),
      },
    });
  });

  it("un conducteur validé archivé depuis, ou un véhicule archivé, est refusé comme dans le planning", async () => {
    await vehicule(a, "AM-303-CC");
    const paul = await conducteur(a, "Paul", "Manquant");
    const avecPaul = await avisAValider(a, "5400000004", "AM-303-CC");
    expect((await validerConducteur(a.client, avecPaul, paul)).ok).toBe(true);
    expect((await archiverConducteur(a.client, paul)).ok).toBe(true);
    expect(await enregistrerAffectationManquante(a.client, avecPaul)).toEqual({
      ok: false,
      erreurs: { general: MESSAGES.conducteurArchiveAffectation("Paul Manquant") },
    });

    const v4 = await vehicule(a, "AM-404-DD");
    const surArchive = await avisAValider(a, "5400000005", "AM-404-DD");
    expect((await validerConducteur(a.client, surArchive, lea)).ok).toBe(true);
    expect((await archiverVehicule(a.client, v4)).ok).toBe(true);
    expect(await enregistrerAffectationManquante(a.client, surArchive)).toEqual({
      ok: false,
      erreurs: { general: MESSAGES.vehiculeArchiveAffectation("AM-404-DD") },
    });
  });

  it("isolation (RLS) : l'avis d'une autre entreprise est introuvable", async () => {
    expect(await enregistrerAffectationManquante(b.client, avisA)).toEqual({
      ok: false,
      erreurs: { general: MESSAGES_AVIS.avisIntrouvable },
    });
  });
});

describe("rattachement des avis à un véhicule créé", () => {
  it("les avis qui portent sa plaque le rejoignent, ouverts ou classés, mais pas ceux d'une autre entreprise", async () => {
    const ouvert = await avisAValider(a, "5500000001", "RA-101-AA");
    const classe = await avisAValider(a, "5500000002", "RA-101-AA");
    expect((await classerAvis(a.client, classe, { motif: "conteste" })).ok).toBe(true);
    const autre = await avisAValider(b, "5500000003", "RA-101-AA");

    const v = await vehicule(a, "RA-101-AA");
    expect(await avisEnBase(ouvert)).toMatchObject({ vehicule_id: v, statut: "a_valider" });
    expect(await avisEnBase(classe)).toMatchObject({ vehicule_id: v, statut: "classe" });
    expect((await avisEnBase(autre))?.vehicule_id).toBeNull();
  });

  it("un avis rouvert perd son conducteur validé, à valider de nouveau ; un avis désigné garde le sien", async () => {
    const v = await vehicule(a, "RA-202-BB");
    const karim = await conducteur(a, "Karim", "Rattaché");
    await affecter(a, v, karim, "01/10/2026 08:00");
    const [rouvert, designe] = [
      await avisAValider(a, "5500000004", "RA-202-BB"),
      await avisAValider(a, "5500000005", "RA-202-BB"),
    ];
    for (const id of [rouvert, designe]) {
      expect((await validerConducteur(a.client, id, karim)).ok).toBe(true);
      const { error } = await admin
        .from("avis")
        .update({ statut: "designe", designe_le: new Date().toISOString() })
        .eq("id", id);
      expect(error).toBeNull();
      // Une plaque corrigée après la désignation : l'avis n'a plus de véhicule, mais garde son conducteur.
      const corrige = await modifierAvis(a.client, id, complet(id === rouvert ? "5500000004" : "5500000005", "RA-303-CC"));
      expect(corrige).toMatchObject({ ok: true, avis: { vehicule_id: null, conducteur_id: karim } });
    }
    expect((await rouvrirAvis(a.client, rouvert)).ok).toBe(true);

    const v2 = await vehicule(a, "RA-303-CC");
    expect(await avisEnBase(rouvert)).toMatchObject({ statut: "a_valider", vehicule_id: v2, conducteur_id: null });
    expect(await avisEnBase(designe)).toMatchObject({ statut: "designe", vehicule_id: v2, conducteur_id: karim });
  });

  it("corriger la plaque d'un véhicule lui rattache les avis qui portent la nouvelle", async () => {
    const id = await avisAValider(a, "5500000006", "RA-404-DD");
    const v = await vehicule(a, "RA-505-EE");
    expect((await avisEnBase(id))?.vehicule_id).toBeNull();

    expect((await modifierVehicule(a.client, v, { plaque: "ra 404 dd", type: "attitre" })).ok).toBe(true);
    expect((await avisEnBase(id))?.vehicule_id).toBe(v);
  });
});

describe("creerVehiculeDepuisAvis", () => {
  let avisA: string;

  beforeAll(async () => {
    avisA = await avisAValider(a, "5600000001", "CV-101-AA");
  });

  it("crée le véhicule avec la plaque de l'avis, quelle que soit celle du formulaire, et lui rattache l'avis", async () => {
    const cree = await creerVehiculeDepuisAvis(a.client, avisA, { plaque: "XX-999-XX", modele: "Renault Master", type: "pool" });
    expect(cree).toMatchObject({ ok: true, vehicule: { plaque: "CV-101-AA", modele: "Renault Master", type: "pool" } });
    if (!cree.ok) return;
    expect((await avisEnBase(avisA))?.vehicule_id).toBe(cree.vehicule.id);
    expect((await a.client.from("vehicule").select("id").eq("plaque", "XX-999-XX")).data).toEqual([]);
  });

  it("les règles des écrans s'appliquent au type", async () => {
    const id = await avisAValider(a, "5600000002", "CV-202-BB");
    expect(await creerVehiculeDepuisAvis(a.client, id, { modele: "", type: "" })).toEqual({
      ok: false,
      erreurs: { type: MESSAGES.typeVide },
    });
    expect((await avisEnBase(id))?.vehicule_id).toBeNull();
  });

  it("refusé sur un avis « À traiter », déjà rattaché, classé, ou d'une autre entreprise", async () => {
    const saisie = { type: "attitre" };
    const { id: aTraiter } = await deposerAvis(a);
    expect(await creerVehiculeDepuisAvis(a.client, aTraiter, saisie)).toEqual({
      ok: false,
      erreurs: { general: MESSAGES_AVIS.vehiculeAvantVerification },
    });
    expect(await creerVehiculeDepuisAvis(a.client, avisA, saisie)).toEqual({
      ok: false,
      erreurs: { general: MESSAGES_AVIS.vehiculeDejaRattache },
    });
    const classe = await avisAValider(a, "5600000003", "CV-303-CC");
    expect((await classerAvis(a.client, classe, { motif: "vol_usurpation" })).ok).toBe(true);
    expect(await creerVehiculeDepuisAvis(a.client, classe, saisie)).toEqual({
      ok: false,
      erreurs: { general: MESSAGES_AVIS.vehiculeAvisFerme("classe") },
    });
    const autre = await avisAValider(a, "5600000004", "CV-404-DD");
    expect(await creerVehiculeDepuisAvis(b.client, autre, saisie)).toEqual({
      ok: false,
      erreurs: { general: MESSAGES_AVIS.avisIntrouvable },
    });
    expect((await b.client.from("vehicule").select("id").eq("plaque", "CV-404-DD")).data).toEqual([]);
  });

  it("un véhicule qui porte déjà la plaque, archivé compris, reçoit l'avis sans rien créer", async () => {
    const id = await avisAValider(a, "5600000005", "CV-505-EE");
    // Écrit hors des écritures de la flotte : rien ne l'a rattaché.
    const { data: existant, error } = await admin
      .from("vehicule")
      .insert({ entreprise_id: a.entrepriseId, plaque: "CV-505-EE", type: "attitre", archive_le: new Date().toISOString() })
      .select("id")
      .single();
    if (error) throw error;
    expect((await avisEnBase(id))?.vehicule_id).toBeNull();

    expect(await creerVehiculeDepuisAvis(a.client, id, { type: "pool" })).toMatchObject({
      ok: true,
      vehicule: { id: existant.id, type: "attitre" },
    });
    expect((await avisEnBase(id))?.vehicule_id).toBe(existant.id);
    expect((await a.client.from("vehicule").select("id").eq("plaque", "CV-505-EE")).data).toHaveLength(1);
  });
});
