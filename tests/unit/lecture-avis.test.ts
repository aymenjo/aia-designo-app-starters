import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nettoyerLecture, schemaLecture, type Lecture } from "@/lib/avis/lecture";
import {
  CHAMPS_AVIS,
  CHAMPS_REQUIS_AVIS,
  LONGUEUR_MAX_TEXTE_AVIS,
  MESSAGES_AVIS,
  type ChampAvis,
  type ChampRequisAvis,
  type Confiance,
} from "@/lib/avis/regles";
import { MESSAGES } from "@/lib/flotte/regles";

// Aujourd'hui : le 14/10/2026 à midi, heure de Paris.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-14T10:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

const LUES: Record<ChampAvis, string> = {
  numero: "1234567890",
  plaque: "AB-123-CD",
  infraction_date: "03/10/2026",
  infraction_heure: "08:30",
  lieu: "A6, Auxerre",
  infraction: "Excès de vitesse inférieur à 20 km/h",
  montant: "135,00",
  date_envoi: "06/10/2026",
};

/** Une lecture où tout est lu et sûr, sauf les champs donnés : [valeur, niveau]. */
function lecture(autres: Partial<Record<ChampAvis, [string | null, Confiance?]>> = {}): Lecture {
  return Object.fromEntries(
    CHAMPS_AVIS.map((champ) => {
      const [valeur, confiance = "sur"] = autres[champ] ?? [LUES[champ]];
      return [champ, { valeur, confiance }];
    }),
  ) as Lecture;
}

const TOUT_SUR = Object.fromEntries(CHAMPS_REQUIS_AVIS.map((champ) => [champ, "sur"]));

describe("nettoyerLecture", () => {
  it("garde une lecture valide, avec ses niveaux", () => {
    expect(nettoyerLecture(lecture())).toEqual({ saisie: LUES, confiances: TOUT_SUR, refusees: {} });
    expect(nettoyerLecture(lecture({ lieu: ["A6", "a_verifier"] })).confiances).toMatchObject({ lieu: "a_verifier" });
  });

  it("un champ vide ou blanc est rouge, même déclaré sûr", () => {
    const { saisie, confiances, refusees } = nettoyerLecture(lecture({ lieu: ["  ", "sur"], montant: [null, "sur"] }));
    expect(saisie).toMatchObject({ lieu: null, montant: null });
    expect(confiances).toMatchObject({ lieu: "non_lu", montant_centimes: "non_lu" });
    // Rien n'a été lu : il n'y a rien à montrer.
    expect(refusees).toEqual({});
  });

  const DATE_ET_HEURE: ChampAvis[] = ["infraction_date", "infraction_heure"];
  const TROP_LONG = "x".repeat(LONGUEUR_MAX_TEXTE_AVIS + 1);

  type Refus = {
    cas: string;
    lue: Partial<Record<ChampAvis, [string | null]>>;
    /** Les champs vidés. */
    vides: ChampAvis[];
    requis: ChampRequisAvis;
    /** Ce qui a été lu, gardé avec le motif du refus. */
    valeur: string;
    motif: string;
  };

  it.each<Refus>([
    {
      cas: "un n° à 9 chiffres",
      lue: { numero: ["123456789"] },
      vides: ["numero"],
      requis: "numero",
      valeur: "123456789",
      motif: MESSAGES_AVIS.numeroMalForme,
    },
    {
      cas: "une plaque mal formée",
      lue: { plaque: ["ABC-12"] },
      vides: ["plaque"],
      requis: "plaque",
      valeur: "ABC-12",
      motif: MESSAGES_AVIS.plaqueMalFormee,
    },
    {
      cas: "un montant nul",
      lue: { montant: ["0,00"] },
      vides: ["montant"],
      requis: "montant_centimes",
      valeur: "0,00",
      motif: MESSAGES_AVIS.montantMalForme,
    },
    {
      cas: "un lieu trop long",
      lue: { lieu: [TROP_LONG] },
      vides: ["lieu"],
      requis: "lieu",
      valeur: TROP_LONG,
      motif: MESSAGES_AVIS.tropLong(LONGUEUR_MAX_TEXTE_AVIS),
    },
    {
      cas: "une date impossible",
      lue: { infraction_date: ["31/02/2026"] },
      vides: DATE_ET_HEURE,
      requis: "infraction_le",
      valeur: "31/02/2026 08:30",
      motif: MESSAGES.dateInexistante("31/02/2026"),
    },
    {
      cas: "une heure seule",
      lue: { infraction_date: [null] },
      vides: DATE_ET_HEURE,
      requis: "infraction_le",
      valeur: "08:30",
      motif: MESSAGES_AVIS.infractionSansDate,
    },
    {
      cas: "une date seule",
      lue: { infraction_heure: [null] },
      vides: DATE_ET_HEURE,
      requis: "infraction_le",
      valeur: "03/10/2026",
      motif: MESSAGES_AVIS.infractionSansHeure,
    },
    {
      cas: "une date d'envoi dans le futur",
      lue: { date_envoi: ["20/10/2026"] },
      vides: ["date_envoi"],
      requis: "date_envoi",
      valeur: "20/10/2026",
      motif: MESSAGES_AVIS.envoiFutur,
    },
    {
      cas: "une date d'envoi avant l'infraction",
      lue: { date_envoi: ["02/10/2026"] },
      vides: ["date_envoi"],
      requis: "date_envoi",
      valeur: "02/10/2026",
      motif: MESSAGES_AVIS.infractionApresEnvoi,
    },
  ])("vide $cas, qui devient rouge et se garde avec son motif ; le reste est gardé", (refus) => {
    const { saisie, confiances, refusees } = nettoyerLecture(lecture(refus.lue));
    for (const champ of CHAMPS_AVIS) expect(saisie[champ]).toBe(refus.vides.includes(champ) ? null : LUES[champ]);
    expect(confiances).toEqual({ ...TOUT_SUR, [refus.requis]: "non_lu" });
    expect(refusees).toEqual({ [refus.requis]: { valeur: refus.valeur, motif: refus.motif } });
  });

  it("la date et l'heure prennent le moins sûr de leurs deux niveaux", () => {
    const orange = lecture({ infraction_date: [LUES.infraction_date, "sur"], infraction_heure: ["08:30", "a_verifier"] });
    expect(nettoyerLecture(orange).confiances.infraction_le).toBe("a_verifier");

    const rouge = lecture({ infraction_date: [LUES.infraction_date, "a_verifier"], infraction_heure: ["08:30", "non_lu"] });
    const { saisie, confiances } = nettoyerLecture(rouge);
    expect(confiances.infraction_le).toBe("non_lu");
    // Lisible mais rouge : la valeur est gardée, et le gestionnaire la confirme.
    expect(saisie.infraction_heure).toBe("08:30");
  });

  it("un avis illisible donne une saisie vide, tout en rouge", () => {
    const vide = lecture(Object.fromEntries(CHAMPS_AVIS.map((champ) => [champ, [null, "non_lu"]])));
    const { saisie, confiances } = nettoyerLecture(vide);
    expect(Object.values(saisie).every((valeur) => valeur === null)).toBe(true);
    expect(Object.values(confiances)).toEqual(Array(CHAMPS_REQUIS_AVIS.length).fill("non_lu"));
  });
});

describe("schemaLecture", () => {
  it("accepte chaque champ lu ou non lu, et refuse un niveau inconnu", () => {
    expect(schemaLecture.safeParse(lecture({ numero: [null, "non_lu"] })).success).toBe(true);
    const inconnu = { ...lecture(), plaque: { valeur: "AB-123-CD", confiance: "certain" } };
    expect(schemaLecture.safeParse(inconnu).success).toBe(false);
  });
});
