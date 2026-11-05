import { describe, expect, it } from "vitest";
import {
  MESSAGES_AGENDA,
  SCOPES_AGENDA,
  descriptionEvenement,
  estCleMessageAgenda,
  idEvenement,
  jourRappel,
  planifierSynchro,
  titreEvenement,
  type EvenementPose,
  type EvenementVoulu,
} from "@/lib/agenda/regles";

// Les règles des rappels Google Calendar (phase 22) : le jour et le contenu de l'événement, son id, et le plan de la
// synchronisation, qui ne garde que les écarts entre les avis ouverts et les événements posés.

describe("jourRappel", () => {
  it("tombe à J-2 de l'échéance, à travers les fins de mois et d'année", () => {
    expect(jourRappel("2026-11-18")).toBe("2026-11-16");
    expect(jourRappel("2026-12-01")).toBe("2026-11-29");
    expect(jourRappel("2027-01-01")).toBe("2026-12-30");
    expect(jourRappel("2028-03-01")).toBe("2028-02-28");
  });

  it("reste à J-2 même si ce jour est passé : la règle ne dépend pas d'aujourd'hui", () => {
    expect(jourRappel("2020-01-10")).toBe("2020-01-08");
  });
});

describe("titreEvenement et descriptionEvenement", () => {
  it("nomme la plaque et l'échéance au format JJ/MM", () => {
    expect(titreEvenement({ plaque: "AB-123-CD", numero: "1234567890", echeance: "2026-11-18" })).toBe(
      "Désigner – AB-123-CD – avant le 18/11",
    );
  });

  it("prend le n° d'avis sans plaque, puis « avis sans plaque » sans l'un ni l'autre", () => {
    expect(titreEvenement({ plaque: null, numero: "1234567890", echeance: "2026-11-18" })).toBe(
      "Désigner – avis n° 1234567890 – avant le 18/11",
    );
    expect(titreEvenement({ plaque: null, numero: null, echeance: "2026-01-05" })).toBe(
      "Désigner – avis sans plaque – avant le 05/01",
    );
  });

  it("donne la date complète puis le lien vers l'avis, sans rien sur le conducteur", () => {
    const description = descriptionEvenement({ echeance: "2026-11-18", lien: "https://designo.test/avis/abc" });
    expect(description).toBe("À désigner sur l'ANTAI avant le 18/11/2026.\n\nhttps://designo.test/avis/abc");
  });
});

describe("idEvenement", () => {
  it("tire de l'uuid de l'avis un id accepté par Google : base32hex, de 5 à 1024 caractères", () => {
    const id = idEvenement("3F2504E0-4F89-11D3-9A0C-0305E82C3301");
    expect(id).toBe("3f2504e04f8911d39a0c0305e82c3301");
    expect(id).toMatch(/^[0-9a-v]{5,1024}$/);
  });

  it("donne toujours le même id pour un même avis, et des ids distincts pour deux avis", () => {
    const avis = crypto.randomUUID();
    expect(idEvenement(avis)).toBe(idEvenement(avis));
    expect(idEvenement(avis)).not.toBe(idEvenement(crypto.randomUUID()));
  });
});

describe("planifierSynchro", () => {
  const AGENDA = "designo@group.calendar.google.com";
  const voulu = (avisId: string, jour = "2026-11-16", titre = `Désigner – ${avisId} – avant le 18/11`): EvenementVoulu => ({
    avisId,
    jour,
    titre,
    description: `lien ${avisId}`,
  });
  const pose = (v: EvenementVoulu, agenda_id = AGENDA): EvenementPose => ({
    agenda_id,
    avis_id: v.avisId,
    jour: v.jour,
    titre: v.titre,
  });
  const planifier = (voulus: EvenementVoulu[], poses: EvenementPose[], plan: "free" | "pro" = "pro") =>
    planifierSynchro({ voulus, poses, agendaId: AGENDA, plan });

  it("crée l'événement d'un avis ouvert qui n'en a pas", () => {
    const a = voulu("a");
    expect(planifier([a], [])).toEqual({ aPoser: [a], aRetirer: [], aOublier: [] });
  });

  it("laisse intact un événement juste : aucun appel à Google", () => {
    const a = voulu("a");
    expect(planifier([a], [pose(a)])).toEqual({ aPoser: [], aRetirer: [], aOublier: [] });
  });

  it("déplace un événement dont l'échéance a changé, et renomme celui dont le titre a changé", () => {
    const deplace = voulu("a", "2026-11-20");
    const renomme = voulu("b", "2026-11-16", "Désigner – AB-123-CD – avant le 18/11");
    const poses = [pose(voulu("a")), pose(voulu("b", "2026-11-16", "Désigner – avis sans plaque – avant le 18/11"))];
    expect(planifier([deplace, renomme], poses)).toEqual({ aPoser: [deplace, renomme], aRetirer: [], aOublier: [] });
  });

  it("retire l'événement d'un avis désigné, classé ou disparu : il n'est plus voulu", () => {
    const a = voulu("a");
    expect(planifier([], [pose(a), pose(voulu("b"))])).toEqual({ aPoser: [], aRetirer: ["a", "b"], aOublier: [] });
  });

  it("en Free, ne crée ni ne déplace rien, mais retire ce qui est devenu faux", () => {
    const juste = voulu("juste");
    const nouveau = voulu("nouveau");
    const deplace = voulu("deplace", "2026-11-20");
    const poses = [pose(juste), pose(voulu("deplace")), pose(voulu("clos"))];
    expect(planifier([juste, nouveau, deplace], poses, "free")).toEqual({
      aPoser: [],
      aRetirer: ["deplace", "clos"],
      aOublier: [],
    });
  });

  it("oublie, sans appeler Google, les lignes d'un ancien agenda, et repose leurs avis dans l'actuel", () => {
    const a = voulu("a");
    const ancienne = pose(a, "ancien@group.calendar.google.com");
    expect(planifier([a], [ancienne])).toEqual({ aPoser: [a], aRetirer: [], aOublier: [ancienne] });
  });
});

describe("scopes et messages", () => {
  it("ne demande à Google que les agendas créés par Désigno et l'adresse du compte", () => {
    expect(SCOPES_AGENDA).toEqual([
      "https://www.googleapis.com/auth/calendar.app.created",
      "https://www.googleapis.com/auth/userinfo.email",
    ]);
  });

  it("reconnaît une clé de message, et seulement elle", () => {
    expect(estCleMessageAgenda("connexionRefusee")).toBe(true);
    expect(estCleMessageAgenda("toString")).toBe(false);
    expect(estCleMessageAgenda(undefined)).toBe(false);
    for (const message of Object.values(MESSAGES_AGENDA)) expect(message).not.toMatch(/ :/);
  });
});
