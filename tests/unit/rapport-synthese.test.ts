import { describe, expect, it } from "vitest";
import type { StatutAvis } from "@/lib/avis/regles";
import type { FicheEntreprise } from "@/lib/entreprise/fiche";
import type { Conducteur } from "@/lib/flotte/conducteurs";
import {
  bornesMois,
  libelleMois,
  moisDuRapport,
  syntheseRapport,
  type AvisRapport,
  type VehiculeRapport,
} from "@/lib/rapport/synthese";

// Les chiffres du rapport mensuel (phase 25) : chaque chiffre compte dans le mois de son événement, à l'heure de Paris.

const MOIS = "2026-10-01";

const ENTREPRISE: FicheEntreprise = {
  raison_sociale: "Plomberie Martin SARL",
  siren: "404833048",
  tva: "FR83404833048",
  representant_prenom: "Paul",
  representant_nom: "Martin",
  representant_fonction: "Gérant",
  siege_adresse: "12 rue des Lilas",
  siege_complement: null,
  siege_code_postal: "75011",
  siege_ville: "Paris",
};

let compteur = 0;
/** Un avis déposé le 15/10 à midi, à traiter, sauf ce que `champs` précise. */
function avis(champs: Partial<AvisRapport> = {}): AvisRapport {
  compteur += 1;
  return {
    id: `avis-${compteur}`,
    numero: String(1_000_000_000 + compteur),
    plaque: "AB-123-CD",
    vehicule_id: "v1",
    conducteur_id: null,
    montant_centimes: 13_500,
    statut: "a_traiter" as StatutAvis,
    echeance: null,
    depose_le: "2026-10-15T10:00:00Z",
    designe_le: null,
    classe_le: null,
    ...champs,
  };
}

/** Un conducteur actif à la fiche complète, sauf ce que `champs` précise. */
function conducteur(id: string, prenom: string, nom: string, champs: Partial<Conducteur> = {}): Conducteur {
  return {
    id,
    civilite: "m",
    prenom,
    nom,
    date_naissance: "1985-03-12",
    lieu_naissance: null,
    adresse: "1 rue du Port",
    adresse_complement: null,
    code_postal: "75011",
    ville: "Paris",
    permis_numero: `P${id}`,
    permis_delivre_le: "2005-06-01",
    permis_categories: null,
    email: null,
    archive_le: null,
    ...champs,
  };
}

const VEHICULES: VehiculeRapport[] = [
  { id: "v1", plaque: "AB-123-CD", modele: "Renault Master" },
  { id: "v2", plaque: "EF-456-GH", modele: null },
  { id: "v3", plaque: "IJ-789-KL", modele: "Peugeot Partner" },
  { id: "v4", plaque: "MN-012-OP", modele: null },
];

const synthese = (
  lesAvis: AvisRapport[],
  conducteurs: Conducteur[] = [],
  entreprise: FicheEntreprise = ENTREPRISE,
) => syntheseRapport({ mois: MOIS, avis: lesAvis, vehicules: VEHICULES, conducteurs, entreprise });

describe("le mois du rapport", () => {
  it("est le mois écoulé, quel que soit le jour où la tâche passe", () => {
    expect(moisDuRapport("2026-11-01")).toBe("2026-10-01");
    expect(moisDuRapport("2026-11-17")).toBe("2026-10-01");
    expect(moisDuRapport("2027-01-01")).toBe("2026-12-01");
  });

  it("commence et finit à minuit, heure de Paris, l'heure d'été comprise", () => {
    expect(bornesMois("2026-10-01")).toEqual({ debut: "2026-09-30T22:00:00.000Z", fin: "2026-10-31T23:00:00.000Z" });
  });

  it("se lit en toutes lettres", () => {
    expect(libelleMois("2026-10-01")).toBe("octobre 2026");
  });
});

describe("syntheseRapport", () => {
  it("compte chaque avis dans le mois de son événement, à l'heure de Paris", () => {
    const s = synthese([
      // Le 31/10 à 23:30 à Paris (22:30 UTC) : octobre. Le 31/10 à 23:30 UTC : déjà novembre à Paris.
      avis({ depose_le: "2026-10-31T22:30:00Z" }),
      avis({ depose_le: "2026-10-31T23:30:00Z" }),
      // Le 30/09 à 22:30 UTC : déjà le 01/10 à Paris.
      avis({ depose_le: "2026-09-30T22:30:00Z" }),
      // Déposé en septembre, désigné en octobre : il compte parmi les désignés d'octobre, pas parmi les reçus.
      avis({
        depose_le: "2026-09-10T08:00:00Z",
        statut: "designe",
        echeance: "2026-10-20",
        designe_le: "2026-10-05T09:00:00Z",
      }),
      avis({ statut: "classe", classe_le: "2026-10-31T22:59:00Z" }),
      avis({ statut: "classe", classe_le: "2026-10-31T23:00:00Z" }),
    ]);
    expect(s).toMatchObject({ recus: 4, designes: 1, classes: 1, aucunAvis: false });
  });

  it("dit « aucun avis » quand rien n'a été déposé dans le mois", () => {
    const s = synthese([avis({ depose_le: "2026-09-10T08:00:00Z" })]);
    expect(s.recus).toBe(0);
    expect(s.aucunAvis).toBe(true);
  });

  it("chiffre les amendes évitées du mois, et le cumul arrêté à la fin du mois", () => {
    const s = synthese([
      // Désigné à temps en octobre : compte dans le mois et le cumul.
      avis({ statut: "designe", echeance: "2026-10-20", designe_le: "2026-10-20T21:00:00Z" }),
      // Désigné à temps en septembre : cumul seulement.
      avis({ statut: "designe", echeance: "2026-09-20", designe_le: "2026-09-10T08:00:00Z" }),
      // Désigné en retard en octobre : rien.
      avis({ statut: "designe", echeance: "2026-10-02", designe_le: "2026-10-03T08:00:00Z" }),
      // Désigné à temps en novembre : après la fin du mois, rien.
      avis({ statut: "designe", echeance: "2026-11-20", designe_le: "2026-11-01T08:00:00Z" }),
    ]);
    expect(s.designes).toBe(2);
    expect(s.eurosEvites).toEqual({ mois: 67_500, cumul: 135_000 });
  });

  it("liste une fois chaque échéance du mois manquée, de la plus ancienne à la plus récente", () => {
    const manquee = avis({ statut: "a_valider", echeance: "2026-10-12", numero: "1111111111" });
    const enRetard = avis({
      statut: "designe",
      echeance: "2026-10-01",
      designe_le: "2026-10-02T08:00:00Z",
      numero: "2222222222",
    });
    const s = synthese([
      manquee,
      enRetard,
      // Désigné à temps, classé, ou échéance hors du mois : pas manquée.
      avis({ statut: "designe", echeance: "2026-10-15", designe_le: "2026-10-14T08:00:00Z" }),
      avis({ statut: "classe", echeance: "2026-10-15", classe_le: "2026-10-20T08:00:00Z" }),
      avis({ statut: "a_valider", echeance: "2026-11-01" }),
      avis({ statut: "a_valider", echeance: "2026-09-30" }),
    ]);
    expect(s.echeancesManquees).toEqual([
      { id: enRetard.id, numero: "2222222222", plaque: "AB-123-CD", statut: "designe", echeance: "2026-10-01" },
      { id: manquee.id, numero: "1111111111", plaque: "AB-123-CD", statut: "a_valider", echeance: "2026-10-12" },
    ]);
  });

  it("classe les 3 véhicules les plus verbalisés sur 12 mois, départagés par le mois puis le montant", () => {
    const s = synthese([
      // v1 : 2 avis sur 12 mois, aucun en octobre.
      avis({ vehicule_id: "v1", depose_le: "2025-11-01T08:00:00Z" }),
      avis({ vehicule_id: "v1", depose_le: "2026-03-01T08:00:00Z" }),
      // v2 : 2 avis, dont 1 en octobre.
      avis({ vehicule_id: "v2", depose_le: "2026-03-01T08:00:00Z" }),
      avis({ vehicule_id: "v2" }),
      // v3 : 2 avis, dont 1 en octobre, plus chers que ceux de v2.
      avis({ vehicule_id: "v3", depose_le: "2026-03-01T08:00:00Z", montant_centimes: 45_000 }),
      avis({ vehicule_id: "v3", montant_centimes: 45_000 }),
      // v4 : 1 avis, mais 3 autres hors de la base (classé, avant les 12 mois, après le mois).
      avis({ vehicule_id: "v4" }),
      avis({ vehicule_id: "v4", statut: "classe", classe_le: "2026-10-16T08:00:00Z" }),
      avis({ vehicule_id: "v4", depose_le: "2025-10-31T22:30:00Z" }),
      avis({ vehicule_id: "v4", depose_le: "2026-10-31T23:30:00Z" }),
      // Une plaque inconnue ne compte pour aucun véhicule.
      avis({ vehicule_id: null, plaque: "ZZ-999-ZZ" }),
    ]);
    expect(s.plusVerbalises.vehicules).toEqual([
      { plaque: "IJ-789-KL", modele: "Peugeot Partner", douzeMois: 2, mois: 1, montantCentimes: 90_000 },
      { plaque: "EF-456-GH", modele: null, douzeMois: 2, mois: 1, montantCentimes: 27_000 },
      { plaque: "AB-123-CD", modele: "Renault Master", douzeMois: 2, mois: 0, montantCentimes: 27_000 },
    ]);
  });

  it("départage à égalité par la plaque, et garde un véhicule archivé", () => {
    const s = synthese([avis({ vehicule_id: "v2" }), avis({ vehicule_id: "v1" })]);
    expect(s.plusVerbalises.vehicules.map(({ plaque }) => plaque)).toEqual(["AB-123-CD", "EF-456-GH"]);
  });

  it("classe les conducteurs par le conducteur validé, archivés compris", () => {
    const conducteurs = [
      conducteur("c1", "Karim", "Benali"),
      conducteur("c2", "Léa", "Durand", { archive_le: "2026-10-20T08:00:00Z" }),
    ];
    const s = synthese(
      [
        avis({ conducteur_id: "c2" }),
        avis({ conducteur_id: "c2", depose_le: "2026-05-01T08:00:00Z" }),
        avis({ conducteur_id: "c1" }),
        // Sans conducteur validé : il ne compte pour personne.
        avis({ conducteur_id: null }),
      ],
      conducteurs,
    );
    expect(s.plusVerbalises.conducteurs).toEqual([
      { nom: "Léa Durand", douzeMois: 2, mois: 1, montantCentimes: 27_000 },
      { nom: "Karim Benali", douzeMois: 1, mois: 1, montantCentimes: 13_500 },
    ]);
  });

  it("liste les fiches incomplètes des conducteurs actifs, et celle de l'entreprise", () => {
    const s = synthese(
      [],
      [
        conducteur("c1", "Karim", "Benali", { permis_numero: null, date_naissance: null }),
        conducteur("c2", "Léa", "Durand"),
        conducteur("c3", "Marc", "Archive", { adresse: null, archive_le: "2026-01-01T08:00:00Z" }),
        conducteur("c4", "Anne", "Albert", { civilite: null }),
      ],
      { ...ENTREPRISE, siren: null, tva: null },
    );
    expect(s.fichesIncompletes).toEqual({
      entreprise: ["SIREN", "N° de TVA"],
      conducteurs: [
        { nom: "Anne A.", manquants: ["Civilité"] },
        { nom: "Karim B.", manquants: ["Date de naissance", "N° de permis"] },
      ],
    });
  });

  it("ne liste rien quand toutes les fiches sont complètes", () => {
    expect(synthese([], [conducteur("c1", "Karim", "Benali")]).fichesIncompletes).toEqual({
      entreprise: [],
      conducteurs: [],
    });
  });
});
