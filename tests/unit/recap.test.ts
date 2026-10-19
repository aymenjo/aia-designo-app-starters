import { describe, expect, it } from "vitest";
import { contenuRecap, manquantsRecap, refusDesignation, refusRecap, URL_ANTAI } from "@/lib/avis/recap";
import { MESSAGES_AVIS, type StatutAvis } from "@/lib/avis/regles";
import type { FicheEntreprise } from "@/lib/entreprise/fiche";
import { tvaDepuisSiren } from "@/lib/entreprise/regles";
import type { Conducteur } from "@/lib/flotte/conducteurs";
import { CHAMPS_REQUIS_CONDUCTEUR } from "@/lib/flotte/regles";

const ENTREPRISE: FicheEntreprise = {
  raison_sociale: "Martin Plomberie SARL",
  siren: "404833048",
  tva: tvaDepuisSiren("404833048"),
  representant_prenom: "Sophie",
  representant_nom: "Martin",
  representant_fonction: "Gérante",
  siege_adresse: "12 rue des Lilas",
  siege_complement: null,
  siege_code_postal: "75011",
  siege_ville: "Paris",
};

const KARIM: Conducteur = {
  id: "7c1d2f0e-3b4a-4c5d-8e9f-0a1b2c3d4e5f",
  civilite: "m",
  prenom: "Karim",
  nom: "Benali",
  date_naissance: "1985-03-12",
  lieu_naissance: "Lyon",
  adresse: "3 allée des Peupliers",
  adresse_complement: null,
  code_postal: "93100",
  ville: "Montreuil",
  permis_numero: "090169201087",
  permis_delivre_le: "2004-06-01",
  permis_categories: ["B", "C1"],
  email: "karim@exemple.fr",
  archive_le: null,
};

// Le 15/01/2026 à 08:30, heure de Paris (heure d'hiver, UTC+1).
const AVIS = { numero: "8803412576", plaque: "AB-123-CD", infraction_le: "2026-01-15T07:30:00.000Z" };

const contenu = (champs: Partial<Conducteur> = {}, avis: Partial<typeof AVIS> = {}) =>
  contenuRecap({ avis: { ...AVIS, ...avis }, entreprise: ENTREPRISE, conducteur: { ...KARIM, ...champs } });

/** Les champs d'un bloc, en « libellé : valeur ». */
const lignes = (blocs: ReturnType<typeof contenuRecap>, titre: string) =>
  blocs.find((bloc) => bloc.titre === titre)!.champs.map(({ libelle, valeur }) => `${libelle} : ${valeur}`);

describe("contenuRecap", () => {
  it("3 blocs dans l'ordre : Avis, Entreprise, Conducteur", () => {
    expect(contenu().map((bloc) => bloc.titre)).toEqual(["Avis", "Entreprise", "Conducteur"]);
  });

  it("Avis : n°, date et heure de l'infraction à part, à l'heure de Paris, puis la plaque", () => {
    expect(lignes(contenu(), "Avis")).toEqual([
      "N° d'avis : 8803412576",
      "Date de l'infraction : 15/01/2026",
      "Heure de l'infraction : 08:30",
      "Plaque : AB-123-CD",
    ]);
  });

  it("l'heure d'été (UTC+2), et un jour qui change à Paris", () => {
    expect(lignes(contenu({}, { infraction_le: "2026-07-15T06:30:00.000Z" }), "Avis").slice(1, 3)).toEqual([
      "Date de l'infraction : 15/07/2026",
      "Heure de l'infraction : 08:30",
    ]);
    expect(lignes(contenu({}, { infraction_le: "2026-07-14T22:30:00.000Z" }), "Avis").slice(1, 3)).toEqual([
      "Date de l'infraction : 15/07/2026",
      "Heure de l'infraction : 00:30",
    ]);
  });

  it("Entreprise : raison sociale, SIREN, puis le représentant légal", () => {
    expect(lignes(contenu(), "Entreprise")).toEqual([
      "Raison sociale : Martin Plomberie SARL",
      "SIREN : 404833048",
      "Nom du représentant légal : Martin",
      "Prénom du représentant légal : Sophie",
      "Fonction du représentant légal : Gérante",
    ]);
  });

  it("Conducteur : les champs requis dans l'ordre de la fiche, civilité en toutes lettres, dates JJ/MM/AAAA", () => {
    expect(lignes(contenu(), "Conducteur")).toEqual([
      "Civilité : M.",
      "Prénom : Karim",
      "Nom : Benali",
      "Date de naissance : 12/03/1985",
      "Adresse : 3 allée des Peupliers",
      "Code postal : 93100",
      "Ville : Montreuil",
      "N° de permis : 090169201087",
      "Date de délivrance du permis : 01/06/2004",
    ]);
    expect(lignes(contenu({ civilite: "mme" }), "Conducteur")[0]).toBe("Civilité : Mme");
  });

  it("le complément d'adresse, seulement s'il est rempli, après l'adresse", () => {
    const avecComplement = lignes(contenu({ adresse_complement: "Bât. B" }), "Conducteur");
    expect(avecComplement.slice(4, 6)).toEqual(["Adresse : 3 allée des Peupliers", "Complément d'adresse : Bât. B"]);
    expect(lignes(contenu(), "Conducteur").some((ligne) => ligne.startsWith("Complément"))).toBe(false);
  });

  it("ni l'email, ni les champs facultatifs : un champ ajouté aux champs requis apparaît, à sa place", () => {
    expect(lignes(contenu(), "Conducteur").some((ligne) => /Email|Lieu|Catégories/.test(ligne))).toBe(false);

    const requis = [...CHAMPS_REQUIS_CONDUCTEUR, "lieu_naissance", "permis_categories"] as const;
    const conducteur = contenuRecap({ avis: AVIS, entreprise: ENTREPRISE, conducteur: KARIM }, requis);
    const champs = lignes(conducteur, "Conducteur");
    expect(champs[4]).toBe("Lieu de naissance : Lyon");
    expect(champs.at(-1)).toBe("Catégories de permis : B, C1");
  });

  it("une clé par champ, unique sur tout le récap : un seul champ copié à la fois", () => {
    const cles = contenu({ adresse_complement: "Bât. B" }).flatMap((bloc) => bloc.champs.map((champ) => champ.cle));
    expect(new Set(cles).size).toBe(cles.length);
  });
});

const ACTIF = { prenom: "Karim", nom: "Benali", archive_le: null };
const VEHICULE = "1f2e3d4c-5b6a-4978-8695-a4b3c2d1e0f9";

const avis = (
  statut: StatutAvis,
  champs: { vehicule_id?: string | null; conducteur_id?: string | null; verrouille?: boolean } = {},
) => ({
  statut,
  vehicule_id: VEHICULE,
  conducteur_id: KARIM.id,
  verrouille: false,
  ...champs,
});

describe("refusRecap", () => {
  it("s'ouvre sur un avis « À valider » rattaché à un véhicule, avec un conducteur actif validé", () => {
    expect(refusRecap(avis("a_valider"), ACTIF)).toBeNull();
  });

  it("un avis classé n'a rien à désigner", () => {
    expect(refusRecap(avis("classe"), ACTIF)).toBe(MESSAGES_AVIS.recapClasse);
  });

  it("un avis « À traiter » se vérifie d'abord", () => {
    expect(refusRecap(avis("a_traiter"), ACTIF)).toBe(MESSAGES_AVIS.validationAvantVerification);
  });

  it("sans véhicule de la flotte, pas de conducteur à désigner", () => {
    expect(refusRecap(avis("a_valider", { vehicule_id: null }), ACTIF)).toBe(MESSAGES_AVIS.validationSansVehicule);
  });

  it("sans conducteur validé", () => {
    expect(refusRecap(avis("a_valider", { conducteur_id: null }), null)).toBe(MESSAGES_AVIS.recapSansConducteur);
  });

  it("un conducteur validé puis archivé est nommé", () => {
    const archive = { ...ACTIF, archive_le: "2026-10-01T08:00:00Z" };
    expect(refusRecap(avis("a_valider"), archive)).toBe(MESSAGES_AVIS.recapConducteurArchive("Karim Benali"));
    expect(MESSAGES_AVIS.recapConducteurArchive("Karim Benali")).toBe(
      "Karim Benali est archivé : réactivez sa fiche pour ouvrir le récap ANTAI.",
    );
  });

  it("un avis verrouillé (plan Free) attend son déverrouillage", () => {
    expect(refusRecap(avis("a_valider", { verrouille: true }), ACTIF)).toBe(MESSAGES_AVIS.verrouille);
    expect(refusDesignation({ avis: avis("a_valider", { verrouille: true }), conducteur: KARIM, entreprise: ENTREPRISE })).toBe(
      MESSAGES_AVIS.verrouille,
    );
  });

  it("un avis désigné garde son récap, pour mémoire, même si son conducteur est archivé depuis", () => {
    expect(refusRecap(avis("designe"), ACTIF)).toBeNull();
    expect(refusRecap(avis("designe"), { ...ACTIF, archive_le: "2026-10-20T08:00:00Z" })).toBeNull();
  });
});

describe("manquantsRecap", () => {
  it("les champs requis vides des deux fiches, dans leur ordre", () => {
    const fiche = { ...ENTREPRISE, siren: null, representant_fonction: " " };
    expect(manquantsRecap({ conducteur: { ...KARIM, adresse: null, permis_numero: "" }, entreprise: fiche })).toEqual({
      conducteur: ["adresse", "permis_numero"],
      entreprise: ["siren", "representant_fonction"],
    });
    expect(manquantsRecap({ conducteur: KARIM, entreprise: ENTREPRISE })).toEqual({ conducteur: [], entreprise: [] });
  });
});

describe("refusDesignation", () => {
  const designation = (statut: StatutAvis, conducteur: Partial<Conducteur> = {}, entreprise = ENTREPRISE) =>
    refusDesignation({ avis: avis(statut), conducteur: { ...KARIM, ...conducteur }, entreprise });

  it("depuis un récap ouvert, fiches complètes", () => {
    expect(designation("a_valider")).toBeNull();
  });

  it("un avis déjà désigné ne l'est pas deux fois", () => {
    expect(designation("designe")).toBe(MESSAGES_AVIS.dejaDesigne);
  });

  it("les refus du récap s'appliquent", () => {
    expect(designation("a_traiter")).toBe(MESSAGES_AVIS.validationAvantVerification);
    expect(designation("classe")).toBe(MESSAGES_AVIS.recapClasse);
    expect(refusDesignation({ avis: avis("a_valider", { conducteur_id: null }), conducteur: null, entreprise: ENTREPRISE })).toBe(
      MESSAGES_AVIS.recapSansConducteur,
    );
  });

  it("une fiche conducteur ou entreprise incomplète", () => {
    expect(designation("a_valider", { date_naissance: null })).toBe(MESSAGES_AVIS.recapIncomplet);
    expect(designation("a_valider", {}, { ...ENTREPRISE, representant_nom: null })).toBe(MESSAGES_AVIS.recapIncomplet);
  });
});

it("le lien ANTAI mène à la saisie du n° d'avis, en HTTPS", () => {
  expect(new URL(URL_ANTAI)).toMatchObject({ protocol: "https:", hostname: "www.usagers.antai.gouv.fr" });
});
