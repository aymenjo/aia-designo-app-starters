import { describe, expect, it } from "vitest";
import { BLOCAGES, blocagesAvis, type ConducteurBlocages } from "@/lib/agent/blocages";
import { MESSAGES_AVIS } from "@/lib/avis/regles";
import type { FicheEntreprise } from "@/lib/entreprise/fiche";
import { tvaDepuisSiren } from "@/lib/entreprise/regles";

// Les avis bloqués (phase 26) : un avis ouvert qu'on ne peut pas mener au récap ANTAI sans régler autre chose.

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

const KARIM: ConducteurBlocages = {
  civilite: "m",
  prenom: "Karim",
  nom: "Benali",
  date_naissance: "1985-03-12",
  adresse: "3 allée des Peupliers",
  code_postal: "93100",
  ville: "Montreuil",
  permis_numero: "090169201087",
  permis_delivre_le: "2004-06-01",
  archive_le: null,
};

type AvisTest = Parameters<typeof blocagesAvis>[0]["avis"];

/** Un avis « À valider », complet, sur un véhicule de la flotte, sans conducteur validé. */
const AVIS: AvisTest = {
  statut: "a_valider",
  numero: "8803412001",
  plaque: "AB-123-CD",
  vehicule_id: "6a7b8c9d-0e1f-4a2b-9c3d-4e5f6a7b8c9d",
  infraction_le: "2026-03-12T07:00:00Z",
  lieu: "Avenue Berthelot, Lyon 7e",
  infraction: "Excès de vitesse",
  montant_centimes: 13500,
  date_envoi: "2026-03-18",
  conducteur_id: null,
  verrouille: false,
  vehicule_lecture_seule: false,
  confiances: {},
};

const blocages = (
  avis: Partial<AvisTest>,
  {
    valide = null,
    propose = KARIM,
    entreprise = ENTREPRISE,
  }: { valide?: ConducteurBlocages | null; propose?: ConducteurBlocages | null; entreprise?: FicheEntreprise } = {},
) =>
  blocagesAvis({ avis: { ...AVIS, ...avis }, conducteurValide: valide, conducteurPropose: propose, entreprise });

describe("blocagesAvis", () => {
  it("ne bloque pas un avis qui n'attend que la validation du conducteur, ou la désignation", () => {
    expect(blocages({})).toEqual([]);
    expect(blocages({ conducteur_id: "c" }, { valide: KARIM, propose: null })).toEqual([]);
  });

  it("ne bloque jamais un avis désigné ou classé", () => {
    expect(blocages({ statut: "designe", conducteur_id: "c" }, { valide: { ...KARIM, archive_le: "2026-01-01" } })).toEqual([]);
    expect(blocages({ statut: "classe", vehicule_id: null })).toEqual([]);
  });

  it("donne les champs à vérifier d'un avis « À traiter » : vides, ou lus en rouge", () => {
    expect(blocages({ statut: "a_traiter", montant_centimes: null, date_envoi: null, confiances: { plaque: "non_lu" } })).toEqual([
      BLOCAGES.champsAVerifier(["montant_centimes", "date_envoi", "plaque"]),
    ]);
    expect(BLOCAGES.champsAVerifier(["montant_centimes", "plaque"]).motif).toBe("Champs à vérifier : Montant, Plaque.");
  });

  it("signale un véhicule inconnu", () => {
    expect(blocages({ vehicule_id: null, plaque: "ZZ-999-ZZ" }, { propose: null })).toEqual([
      BLOCAGES.vehiculeInconnu("ZZ-999-ZZ"),
    ]);
    expect(blocages({ statut: "a_traiter", lieu: null, vehicule_id: null, plaque: "ZZ-999-ZZ" })).toEqual([
      BLOCAGES.champsAVerifier(["lieu"]),
      BLOCAGES.vehiculeInconnu("ZZ-999-ZZ"),
    ]);
  });

  it("signale l'absence d'affectation au moment de l'infraction", () => {
    expect(blocages({}, { propose: null })).toEqual([BLOCAGES.aucuneAffectation]);
    expect(BLOCAGES.aucuneAffectation.motif).toContain(MESSAGES_AVIS.aucuneAffectation);
  });

  it("signale un conducteur archivé, proposé ou validé", () => {
    const archive = { ...KARIM, archive_le: "2026-08-15T07:00:00Z" };
    expect(blocages({}, { propose: archive })).toEqual([BLOCAGES.conducteurArchive("Karim Benali", "AB-123-CD")]);
    expect(blocages({ conducteur_id: "c" }, { valide: archive })).toEqual([
      BLOCAGES.conducteurArchive("Karim Benali", "AB-123-CD"),
    ]);
  });

  it("signale la fiche incomplète du conducteur qui sera désigné", () => {
    const incomplet = { ...KARIM, permis_numero: null, permis_delivre_le: null };
    expect(blocages({}, { propose: incomplet })).toEqual([
      BLOCAGES.ficheConducteur("Karim Benali", ["permis_numero", "permis_delivre_le"]),
    ]);
    // Le conducteur validé fait foi, même si l'affectation en propose un autre.
    expect(blocages({ conducteur_id: "c" }, { valide: incomplet, propose: KARIM })).toHaveLength(1);
  });

  it("signale la fiche entreprise incomplète", () => {
    const entreprise = { ...ENTREPRISE, siren: null };
    expect(blocages({}, { entreprise })).toEqual([BLOCAGES.ficheEntreprise(["siren"])]);
    expect(blocages({}, { entreprise, propose: null })).toEqual([
      BLOCAGES.aucuneAffectation,
      BLOCAGES.ficheEntreprise(["siren"]),
    ]);
  });

  it("signale un avis verrouillé, ou bloqué par son véhicule en lecture seule", () => {
    expect(blocages({ verrouille: true, statut: "a_traiter", lieu: null })).toEqual([BLOCAGES.verrouille]);
    expect(blocages({ vehicule_lecture_seule: true })).toEqual([BLOCAGES.vehiculeLectureSeule]);
  });
});
