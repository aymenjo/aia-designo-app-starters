import { describe, expect, it } from "vitest";
import {
  chevauche,
  messageConflit,
  premierConflit,
  refusAffectationModifiable,
  refusArchivage,
  refusCloture,
  refusConducteurAffectation,
  refusDejaArchivee,
  refusFicheArchivee,
  refusModificationVehicule,
  refusPassagePool,
  refusPlaque,
  refusUnicite,
  refusVehiculeAffectation,
} from "@/lib/flotte/controles";
import { MESSAGES } from "@/lib/flotte/regles";

// Les contrôles d'écriture de la flotte (phase 29) : purs, partagés par les écrans et le récapitulatif de l'agent. Chacun
// renvoie le message exact des écrans.

const ARCHIVE = "2026-10-01T08:00:00Z";
const actif = { plaque: "AB-123-CD", archive_le: null, lecture_seule_le: null };
const karim = { prenom: "Karim", nom: "Benali", archive_le: null };

describe("les véhicules et conducteurs d'une affectation", () => {
  it("refusent un véhicule introuvable, archivé ou en lecture seule", () => {
    expect(refusVehiculeAffectation(actif)).toBeNull();
    expect(refusVehiculeAffectation(null)).toBe(MESSAGES.vehiculeIntrouvable);
    expect(refusVehiculeAffectation({ ...actif, archive_le: ARCHIVE })).toBe(MESSAGES.vehiculeArchiveAffectation("AB-123-CD"));
    expect(refusVehiculeAffectation({ ...actif, lecture_seule_le: ARCHIVE })).toBe(MESSAGES.affectationLectureSeule("AB-123-CD"));
  });

  it("refusent un conducteur introuvable ou archivé, nommé en entier", () => {
    expect(refusConducteurAffectation(karim)).toBeNull();
    expect(refusConducteurAffectation(null)).toBe(MESSAGES.conducteurIntrouvable);
    expect(refusConducteurAffectation({ ...karim, archive_le: ARCHIVE })).toBe(MESSAGES.conducteurArchiveAffectation("Karim Benali"));
  });
});

describe("l'affectation à modifier ou à clôturer", () => {
  const affectation = { vehicule: actif, conducteur: { archive_le: null } };

  it("reste en lecture seule tant que son véhicule ou son conducteur est archivé", () => {
    expect(refusAffectationModifiable(affectation)).toBeNull();
    expect(refusAffectationModifiable(null)).toBe(MESSAGES.affectationIntrouvable);
    expect(refusAffectationModifiable({ ...affectation, conducteur: { archive_le: ARCHIVE } })).toBe(MESSAGES.affectationArchivee);
    expect(refusAffectationModifiable({ ...affectation, vehicule: { ...actif, archive_le: ARCHIVE } })).toBe(
      MESSAGES.affectationArchivee,
    );
  });

  it("se clôture encore sur un véhicule en lecture seule, mais ne s'y modifie plus", () => {
    const lectureSeule = { ...affectation, vehicule: { ...actif, lecture_seule_le: ARCHIVE } };
    expect(refusAffectationModifiable(lectureSeule)).toBe(MESSAGES.affectationLectureSeule("AB-123-CD"));
    expect(refusAffectationModifiable(lectureSeule, { cloture: true })).toBeNull();
  });

  it("ne se reclôture pas", () => {
    expect(refusCloture({ fin: null })).toBeNull();
    expect(refusCloture({ fin: "2026-11-06T23:00:00Z" })).toBe(MESSAGES.affectationDejaCloturee);
  });
});

describe("l'archivage, le passage en pool et la lecture seule", () => {
  const ouverte = { conducteur: karim, vehicule: { plaque: "AB-123-CD" } };

  it("nomment l'affectation ouverte à clôturer d'abord", () => {
    expect(refusArchivage(null)).toBeNull();
    expect(refusArchivage(ouverte)).toBe(MESSAGES.affectationEnCours("Karim B.", "AB-123-CD"));
    expect(refusPassagePool("pool", ouverte)).toBe(MESSAGES.poolAvecAffectationOuverte("Karim B."));
    expect(refusPassagePool("attitre", ouverte)).toBeNull();
    expect(refusPassagePool("pool", null)).toBeNull();
  });

  it("refusent de modifier un véhicule en lecture seule, ou une fiche archivée, et d'archiver deux fois", () => {
    expect(refusModificationVehicule({ lecture_seule_le: ARCHIVE })).toBe(MESSAGES.vehiculeLectureSeule);
    expect(refusModificationVehicule({ lecture_seule_le: null })).toBeNull();
    expect(refusFicheArchivee({ ...actif, archive_le: ARCHIVE })).toBe(MESSAGES.vehiculeArchiveModification("AB-123-CD"));
    expect(refusFicheArchivee({ ...karim, archive_le: ARCHIVE })).toBe(MESSAGES.conducteurArchiveModification("Karim Benali"));
    expect(refusFicheArchivee(karim)).toBeNull();
    expect(refusDejaArchivee({ ...actif, archive_le: ARCHIVE })).toBe(MESSAGES.vehiculeDejaArchive("AB-123-CD"));
    expect(refusDejaArchivee({ ...karim, archive_le: ARCHIVE })).toBe(MESSAGES.conducteurDejaArchive("Karim Benali"));
  });
});

describe("les unicités", () => {
  it("distinguent une plaque présente d'une plaque archivée", () => {
    expect(refusPlaque("AB-123-CD", null)).toBeNull();
    expect(refusPlaque("AB-123-CD", { archive_le: null })).toBe(MESSAGES.plaqueDejaPresente("AB-123-CD"));
    expect(refusPlaque("AB-123-CD", { archive_le: ARCHIVE })).toBe(MESSAGES.plaqueArchivee("AB-123-CD"));
  });

  it("nomment le conducteur qui porte déjà le permis ou l'email", () => {
    expect(refusUnicite("permis_numero", null)).toBeNull();
    expect(refusUnicite("permis_numero", karim)).toBe(MESSAGES.permisDejaPresent("Karim Benali"));
    expect(refusUnicite("email", karim)).toBe(MESSAGES.emailDejaPresent("Karim Benali"));
    expect(refusUnicite("permis_numero", { ...karim, archive_le: ARCHIVE })).toBe(MESSAGES.permisArchive("Karim Benali"));
    expect(refusUnicite("email", { ...karim, archive_le: ARCHIVE })).toBe(MESSAGES.emailArchive("Karim Benali"));
  });
});

describe("le chevauchement", () => {
  const matin = { debut: "2026-03-03T07:00:00Z", fin: "2026-03-03T11:00:00Z" };

  it("suit la contrainte d'exclusion, sur [debut, fin) : bout à bout passe, une fin vide vaut l'infini", () => {
    expect(chevauche(matin, { debut: "2026-03-03T11:00:00Z", fin: null })).toBe(false);
    expect(chevauche(matin, { debut: "2026-03-03T10:59:00Z", fin: "2026-03-03T12:00:00Z" })).toBe(true);
    expect(chevauche({ debut: "2026-01-01T00:00:00Z", fin: null }, { debut: "2030-01-01T00:00:00Z", fin: null })).toBe(true);
    // « Z » et « +00:00 » : le même instant.
    expect(chevauche(matin, { debut: "2026-03-03T11:00:00+00:00", fin: null })).toBe(false);
  });

  it("nomme la première affectation en conflit, comme les écrans", () => {
    const autres = [
      { debut: "2026-03-03T10:00:00Z", fin: null, conducteur: { prenom: "Léa", nom: "Moreau" } },
      { debut: "2026-03-03T06:00:00Z", fin: "2026-03-03T08:00:00Z", conducteur: karim },
    ];
    const conflit = premierConflit(matin, autres)!;
    expect(conflit.conducteur).toBe(karim);
    expect(messageConflit(conflit, "AB-123-CD")).toBe(
      MESSAGES.conflitAffectation("Karim B.", "AB-123-CD", "2026-03-03T06:00:00Z", "2026-03-03T08:00:00Z"),
    );
    expect(premierConflit({ debut: "2026-03-04T00:00:00Z", fin: "2026-03-04T01:00:00Z" }, autres.slice(1))).toBeNull();
  });
});
