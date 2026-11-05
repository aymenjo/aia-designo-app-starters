import { describe, expect, it } from "vitest";
import type { EvenementSession } from "@/lib/agent/client";
import { reponseDuTour } from "@/lib/agent/demande";
import {
  CIVILITES_AGENT,
  CONSIGNES,
  ENTREES_OUTILS,
  MAX_MODIFICATIONS,
  PHRASE_HORS_SUJET,
  TYPES_VEHICULE_AGENT,
  definitionAgent,
} from "@/lib/agent/definition";
import {
  EXEMPLES,
  LONGUEUR_MAX_DEMANDE,
  LONGUEUR_MAX_ETAPE,
  MESSAGES_AGENT,
  NOTE_ARRET,
  contexteDate,
  debutConservation,
  elementDeLEcran,
  libelleContexte,
  libelleEtape,
  moisDemandes,
  noteContexte,
  noteCorrection,
  remiseAZeroDemandes,
  verifierDemande,
  verrouMortAvant,
  type Nommer,
} from "@/lib/agent/regles";
import { CIVILITES, TYPES_VEHICULE } from "@/lib/flotte/regles";
import { MAX_LIGNES_RECAPITULATIF, type LigneRecapitulatif } from "@/lib/flotte/regles-recapitulatif";

// Les règles de Demande à Désigno (phase 26) : la demande, la conservation, la définition de l'agent et ses outils. Le
// contexte de l'écran, les étapes et « Arrêter » (phase 28) sont en fin de fichier.

const UUID = "6a7b8c9d-0e1f-4a2b-9c3d-4e5f6a7b8c9d";

describe("la demande", () => {
  it("refuse une demande vide ou trop longue, et retire les espaces autour", () => {
    expect(verifierDemande("  Qui avait AB-123-CD ?\n")).toEqual({ ok: true, texte: "Qui avait AB-123-CD ?" });
    expect(verifierDemande("   ")).toEqual({ ok: false, erreur: MESSAGES_AGENT.vide });
    expect(verifierDemande(42)).toEqual({ ok: false, erreur: MESSAGES_AGENT.vide });
    expect(verifierDemande("a".repeat(LONGUEUR_MAX_DEMANDE + 1))).toEqual({ ok: false, erreur: MESSAGES_AGENT.tropLong });
  });

  it("donne les 3 exemples du PRD", () => {
    expect(EXEMPLES).toEqual([
      "Qui avait AB-123-CD le 12/03 à 8 h ?",
      "Quels avis sont bloqués, et pourquoi ?",
      "Karim part vendredi, passe son camion à Léa",
    ]);
  });

  it("joint la date et l'heure de Paris, l'hiver comme l'été", () => {
    expect(contexteDate(new Date("2026-10-31T09:00:00Z"))).toBe(
      "Nous sommes le samedi 31/10/2026, il est 10:00 (heure de Paris).",
    );
    expect(contexteDate(new Date("2026-07-14T06:30:00Z"))).toBe(
      "Nous sommes le mardi 14/07/2026, il est 08:30 (heure de Paris).",
    );
  });
});

describe("la conservation et le verrou", () => {
  it("efface les conversations commencées il y a plus de 30 jours", () => {
    expect(debutConservation(new Date("2026-11-01T02:00:00Z")).toISOString()).toBe("2026-10-02T02:00:00.000Z");
  });

  it("tient pour mort un verrou plus vieux que la durée maximale de la route", () => {
    expect(verrouMortAvant(new Date("2026-11-01T10:00:00Z")).toISOString()).toBe("2026-11-01T09:55:00.000Z");
  });
});

describe("l'historique (phase 32)", () => {
  it("compte les récapitulatifs appliqués d'une conversation, au singulier comme au pluriel", () => {
    expect(MESSAGES_AGENT.appliques(1)).toBe("1 récapitulatif appliqué");
    expect(MESSAGES_AGENT.appliques(2)).toBe("2 récapitulatifs appliqués");
  });

  it("dit la fenêtre de 30 jours dans l'icône et dans la liste vide", () => {
    expect(MESSAGES_AGENT.historique).toBe("Conversations des 30 derniers jours");
    expect(MESSAGES_AGENT.historiqueVide).toBe("Aucune conversation ces 30 derniers jours.");
  });
});

describe("la limite de 100 demandes par mois (phase 27)", () => {
  it("compte une demande dans le mois de Paris, et remet le compteur à zéro le 1er du mois suivant", () => {
    // Le 30/11 à 23:30 à Paris : encore novembre.
    const finNovembre = new Date("2026-11-30T22:30:00Z");
    expect(moisDemandes(finNovembre)).toBe("2026-11-01");
    expect(remiseAZeroDemandes(finNovembre)).toBe("2026-12-01");
    expect(MESSAGES_AGENT.limite(remiseAZeroDemandes(finNovembre))).toBe("Limite atteinte, retour le 01/12.");

    // Le 01/12 à 00:30 à Paris, quand il n'est que 23:30 le 30/11 en UTC : déjà décembre.
    const debutDecembre = new Date("2026-11-30T23:30:00Z");
    expect(moisDemandes(debutDecembre)).toBe("2026-12-01");
    expect(MESSAGES_AGENT.limite(remiseAZeroDemandes(debutDecembre))).toBe("Limite atteinte, retour le 01/01.");
  });

  it("passe d'une année à l'autre, et suit l'heure d'été", () => {
    expect(remiseAZeroDemandes(new Date("2026-12-31T22:59:00Z"))).toBe("2027-01-01");
    expect(remiseAZeroDemandes(new Date("2026-12-31T23:00:00Z"))).toBe("2027-02-01");
    // L'été, Paris est à UTC+2 : le 31/07 à 22:30 UTC est déjà le 01/08.
    expect(moisDemandes(new Date("2026-07-31T21:30:00Z"))).toBe("2026-07-01");
    expect(moisDemandes(new Date("2026-07-31T22:30:00Z"))).toBe("2026-08-01");
  });

  it("dit que les écrans restent accessibles", () => {
    expect(MESSAGES_AGENT.limiteEcrans).toBe(
      "En attendant, vos véhicules, conducteurs, planning et avis restent accessibles par les écrans.",
    );
  });
});

describe("la définition de l'agent", () => {
  it("n'a que des outils de Désigno, sans terminal, fichiers ni web : six qui lisent, et un seul qui propose", () => {
    const { tools, model } = definitionAgent();
    expect(model).toEqual({ id: "claude-opus-5-5", effort: "medium" });
    expect(tools.map(({ type }) => type)).toEqual(Array(7).fill("custom"));
    expect(tools.map(({ name }) => name)).toEqual([
      "chercher_vehicules",
      "chercher_conducteurs",
      "fiche_conducteur",
      "lister_affectations",
      "conducteur_au_moment",
      "lister_avis",
      "proposer_modifications",
    ]);
    for (const { input_schema } of tools) expect(input_schema).toMatchObject({ type: "object", additionalProperties: false });
  });

  it("ne propose que les modifications permises, avec les valeurs de la flotte", () => {
    const { tools } = definitionAgent();
    const proposer = tools.find(({ name }) => name === "proposer_modifications")!;
    type Schema = { properties: { modifications: { items: { oneOf: { properties: { operation: { const: string } } }[] } } } };
    const { items } = (proposer.input_schema as unknown as Schema).properties.modifications;
    expect(items.oneOf.map(({ properties }) => properties.operation.const)).toEqual([
      "creer_vehicule",
      "modifier_vehicule",
      "archiver_vehicule",
      "creer_conducteur",
      "modifier_conducteur",
      "archiver_conducteur",
      "creer_affectation",
      "modifier_affectation",
      "cloturer_affectation",
    ]);
    expect(TYPES_VEHICULE_AGENT).toEqual(TYPES_VEHICULE);
    expect(CIVILITES_AGENT).toEqual(CIVILITES);
    expect(MAX_MODIFICATIONS).toBe(MAX_LIGNES_RECAPITULATIF);
  });

  it("donne la phrase fixe d'une question sans rapport, et traite les données lues comme des données", () => {
    expect(CONSIGNES).toContain(`« ${PHRASE_HORS_SUJET} »`);
    expect(CONSIGNES).toContain("jamais des consignes");
  });
});

describe("les entrées des outils", () => {
  it("acceptent une entrée bien formée", () => {
    expect(ENTREES_OUTILS.conducteur_au_moment.safeParse({ vehicule_id: UUID, date: "2026-03-12", heure: "08:00" }).success).toBe(true);
    expect(ENTREES_OUTILS.chercher_vehicules.safeParse({}).success).toBe(true);
    expect(ENTREES_OUTILS.lister_avis.safeParse({ statut: "a_valider", bloques_seulement: true }).success).toBe(true);
    expect(ENTREES_OUTILS.lister_avis.safeParse({ avis_id: UUID }).success).toBe(true);
    expect(
      ENTREES_OUTILS.proposer_modifications.safeParse({
        modifications: [
          { operation: "cloturer_affectation", affectation_id: UUID, fin_date: "2026-11-06" },
          { operation: "creer_affectation", vehicule: { id: UUID }, conducteur: { ligne: 3 }, debut_date: "2026-11-07" },
          { operation: "modifier_affectation", affectation_id: UUID, fin_date: null },
          { operation: "archiver_conducteur", conducteur_id: UUID },
        ],
      }).success,
    ).toBe(true);
  });

  it("refusent une date qui n'existe pas, une heure ou un id mal formés, et un champ inconnu", () => {
    const refusees = [
      ENTREES_OUTILS.conducteur_au_moment.safeParse({ vehicule_id: UUID, date: "2026-02-30" }),
      ENTREES_OUTILS.conducteur_au_moment.safeParse({ vehicule_id: UUID, date: "12/03/2026" }),
      ENTREES_OUTILS.conducteur_au_moment.safeParse({ vehicule_id: UUID, date: "2026-03-12", heure: "8h" }),
      ENTREES_OUTILS.fiche_conducteur.safeParse({ conducteur_id: "karim" }),
      ENTREES_OUTILS.lister_avis.safeParse({ statut: "ouvert" }),
      ENTREES_OUTILS.lister_avis.safeParse({ avis_id: "1234567890" }),
      ENTREES_OUTILS.chercher_vehicules.safeParse({ texte: "AB", supprimer: true }),
      // Ni suppression, ni désignation : seules les 9 modifications du récapitulatif existent.
      ENTREES_OUTILS.proposer_modifications.safeParse({ modifications: [{ operation: "supprimer_vehicule", vehicule_id: UUID }] }),
      ENTREES_OUTILS.proposer_modifications.safeParse({ modifications: [{ operation: "designer_avis", avis_id: UUID }] }),
      ENTREES_OUTILS.proposer_modifications.safeParse({ modifications: [] }),
      ENTREES_OUTILS.proposer_modifications.safeParse({
        modifications: [{ operation: "creer_affectation", vehicule: { ligne: 0 }, conducteur: { id: UUID }, debut_date: "2026-11-07" }],
      }),
    ];
    for (const refus of refusees) expect(refus.success).toBe(false);
  });
});

describe("la réponse d'un tour", () => {
  const message = (id: string, texte: string): EvenementSession => ({ type: "message", id, texte, le: "2026-10-31T09:00:00Z" });

  it("garde le texte écrit après le dernier appel d'outil, et l'id du dernier message", () => {
    expect(
      reponseDuTour([
        { type: "demande", id: "sevt_1" },
        message("sevt_2", "Je regarde le planning."),
        { type: "outil", id: "sevt_3", nom: "lister_affectations", entree: {} },
        message("sevt_4", "Karim Benali conduisait."),
        message("sevt_5", "Son affectation court toujours."),
        { type: "fin" },
      ]),
    ).toEqual({ texte: "Karim Benali conduisait.\n\nSon affectation court toujours.", evenementId: "sevt_5", le: "2026-10-31T09:00:00Z" });
  });

  it("reprend tout le texte si l'agent n'a rien écrit après son dernier outil, et rien sans texte", () => {
    expect(
      reponseDuTour([message("sevt_1", "Aucun avis."), { type: "outil", id: "sevt_2", nom: "lister_avis", entree: {} }]),
    ).toMatchObject({ texte: "Aucun avis.", evenementId: "sevt_1" });
    expect(reponseDuTour([{ type: "fin" }, message("sevt_1", "  ")])).toBeNull();
  });
});

describe("l'élément de l'écran (phase 28)", () => {
  const AUTRE = "0f1e2d3c-4b5a-4968-8776-655443322110";

  it("reconnaît la fiche d'un avis, son récap, la fiche d'un véhicule ou d'un conducteur", () => {
    expect(elementDeLEcran(`/avis/${UUID}`)).toEqual({ type: "avis", id: UUID });
    expect(elementDeLEcran(`/avis/${UUID}/recap`)).toEqual({ type: "avis", id: UUID });
    expect(elementDeLEcran(`/flotte/vehicules/${UUID}`)).toEqual({ type: "vehicule", id: UUID });
    expect(elementDeLEcran(`/flotte/conducteurs/${AUTRE}/`)).toEqual({ type: "conducteur", id: AUTRE });
    expect(elementDeLEcran(`/avis/${UUID.toUpperCase()}`)).toEqual({ type: "avis", id: UUID });
  });

  it("ne donne rien sur les listes, le planning, le dépôt ou un id mal formé", () => {
    for (const chemin of [
      "/avis",
      "/avis/nouveau",
      "/avis/emails-non-exploitables",
      "/flotte/vehicules",
      "/flotte/planning",
      `/flotte/vehicules/${UUID}/recap`,
      `/avis/${UUID}/autre`,
      "/avis/1234",
      "/tableau-de-bord",
    ]) {
      expect(elementDeLEcran(chemin), chemin).toBeNull();
    }
  });

  it("nomme l'élément derrière « Sur : »", () => {
    const avis = { type: "avis" as const, numero: null, plaque: null, infraction_le: null, depose_le: "2026-11-03T09:00:00Z" };
    expect(libelleContexte({ ...avis, numero: "1234567890" })).toBe("avis n° 1234567890");
    expect(libelleContexte({ ...avis, plaque: "AB-123-CD", infraction_le: "2026-03-12T07:00:00Z" })).toBe(
      "avis sans n° · AB-123-CD du 12/03/2026",
    );
    // Sans n°, il faut la plaque et la date de l'infraction ; sinon, la date du dépôt, à Paris.
    expect(libelleContexte({ ...avis, plaque: "AB-123-CD" })).toBe("avis déposé le 03/11/2026");
    expect(libelleContexte({ ...avis, depose_le: "2026-11-02T23:30:00Z" })).toBe("avis déposé le 03/11/2026");
    expect(libelleContexte({ type: "vehicule", plaque: "AB-123-CD" })).toBe("AB-123-CD");
    expect(libelleContexte({ type: "conducteur", prenom: "Karim", nom: "Benali" })).toBe("Karim Benali");
  });
});

describe("la note sur l'écran ouvert (phase 28)", () => {
  const VEHICULE = "11111111-2222-4333-8444-555555555555";
  const CONDUCTEUR = "66666666-7777-4888-8999-aaaaaaaaaaaa";

  it("donne l'avis, son véhicule et son conducteur, avec leur id et leur lien", () => {
    expect(
      noteContexte(
        { type: "avis", id: UUID, libelle: "avis n° 1234567890" },
        {
          vehicule: { id: VEHICULE, libelle: "AB-123-CD" },
          conducteur: { id: CONDUCTEUR, libelle: "Karim Benali", role: "son conducteur validé" },
        },
      ),
    ).toBe(
      `Écran ouvert : avis n° 1234567890 (avis_id : ${UUID}, lien : /avis/${UUID}). « Cet avis » le désigne. ` +
        `« Ce véhicule » désigne AB-123-CD (vehicule_id : ${VEHICULE}, lien : /flotte/vehicules/${VEHICULE}). ` +
        `« Ce conducteur » désigne Karim Benali (conducteur_id : ${CONDUCTEUR}, lien : /flotte/conducteurs/${CONDUCTEUR}), son conducteur validé.`,
    );
  });

  it("dit ce qui ne désigne rien sur l'écran : l'agent demande lequel", () => {
    expect(noteContexte({ type: "vehicule", id: VEHICULE, libelle: "AB-123-CD" })).toBe(
      `Écran ouvert : le véhicule AB-123-CD (vehicule_id : ${VEHICULE}, lien : /flotte/vehicules/${VEHICULE}). ` +
        "« Ce véhicule » le désigne. « Cet avis » et « ce conducteur » ne désignent rien sur cet écran : demande lequel.",
    );
    expect(
      noteContexte(
        { type: "vehicule", id: VEHICULE, libelle: "AB-123-CD" },
        { conducteur: { id: CONDUCTEUR, libelle: "Karim Benali", role: "qui conduit ce véhicule en ce moment" } },
      ),
    ).toContain("qui conduit ce véhicule en ce moment. « Cet avis » ne désigne rien sur cet écran : demande lequel.");
    expect(noteContexte({ type: "conducteur", id: CONDUCTEUR, libelle: "Karim Benali" })).toContain(
      "la fiche du conducteur Karim Benali",
    );
  });

  it("est jointe même sans élément, pour que le contexte d'une demande précédente ne serve pas", () => {
    expect(noteContexte(null)).toBe(
      "Écran ouvert : aucun avis, véhicule ni conducteur. « Cet avis », « ce véhicule » et « ce conducteur » ne désignent rien sur cet écran : demande lequel.",
    );
  });

  it("dit à l'agent de ne pas reprendre une réponse arrêtée", () => {
    expect(NOTE_ARRET).toBe(
      "Le gestionnaire a arrêté ta réponse à sa demande précédente : ne la reprends pas, sauf s'il te le demande.",
    );
    expect(MESSAGES_AGENT.arretee).toBe("Demande arrêtée.");
  });
});

describe("l'étape en cours (phase 28)", () => {
  const VEHICULE = "11111111-2222-4333-8444-555555555555";
  const CONDUCTEUR = "66666666-7777-4888-8999-aaaaaaaaaaaa";
  const noms: Record<string, string> = {
    [`vehicule:${VEHICULE}`]: "AB-123-CD",
    [`conducteur:${CONDUCTEUR}`]: "Karim Benali",
    [`avis:${UUID}`]: "1234567890",
  };
  const nommer: Nommer = async (type, id) => noms[`${type}:${id}`] ?? null;
  const inconnu: Nommer = () => null;

  it("nomme l'élément visé par chaque outil", async () => {
    const cas: [string, object, string][] = [
      ["chercher_vehicules", { texte: " AB-123 " }, "Je cherche AB-123 dans les véhicules…"],
      ["chercher_vehicules", {}, "Je consulte les véhicules…"],
      ["chercher_conducteurs", { texte: "Karim" }, "Je cherche Karim dans les conducteurs…"],
      ["chercher_conducteurs", { texte: "  " }, "Je consulte les conducteurs…"],
      ["fiche_conducteur", { conducteur_id: CONDUCTEUR }, "J'ouvre la fiche de Karim Benali…"],
      ["lister_affectations", { vehicule_id: VEHICULE, conducteur_id: CONDUCTEUR }, "Je consulte le planning de AB-123-CD…"],
      ["lister_affectations", { conducteur_id: CONDUCTEUR }, "Je consulte le planning de Karim Benali…"],
      ["lister_affectations", {}, "Je consulte le planning…"],
      [
        "conducteur_au_moment",
        { vehicule_id: VEHICULE, date: "2026-03-12", heure: "08:00" },
        "Je cherche qui conduisait AB-123-CD le 12/03/2026 à 08:00…",
      ],
      ["conducteur_au_moment", { vehicule_id: VEHICULE, date: "2026-03-12" }, "Je cherche qui conduisait AB-123-CD le 12/03/2026…"],
      ["lister_avis", { numero: "1234567890" }, "Je consulte l'avis n° 1234567890…"],
      ["lister_avis", { avis_id: UUID }, "Je consulte l'avis n° 1234567890…"],
      ["lister_avis", { vehicule_id: VEHICULE }, "Je consulte les avis de AB-123-CD…"],
      ["lister_avis", { conducteur_id: CONDUCTEUR, bloques_seulement: true }, "Je consulte les avis de Karim Benali…"],
      ["lister_avis", { bloques_seulement: true }, "Je cherche les avis bloqués…"],
      ["lister_avis", {}, "Je consulte les avis…"],
      ["proposer_modifications", {}, "Je prépare le récapitulatif…"],
      ["outil_inconnu", {}, "Je consulte votre flotte…"],
    ];
    for (const [nom, entree, attendu] of cas) expect(await libelleEtape(nom, entree, nommer), nom).toBe(attendu);
  });

  it("donne la phrase sans nom pour un élément inconnu", async () => {
    expect(await libelleEtape("fiche_conducteur", { conducteur_id: CONDUCTEUR }, inconnu)).toBe("J'ouvre la fiche du conducteur…");
    expect(await libelleEtape("lister_affectations", { vehicule_id: VEHICULE }, inconnu)).toBe("Je consulte le planning…");
    expect(await libelleEtape("conducteur_au_moment", { vehicule_id: VEHICULE, date: "2026-03-12" }, inconnu)).toBe(
      "Je cherche qui conduisait le 12/03/2026…",
    );
    expect(await libelleEtape("lister_avis", { avis_id: UUID }, inconnu)).toBe("Je consulte l'avis…");
    expect(await libelleEtape("lister_avis", { vehicule_id: VEHICULE }, inconnu)).toBe("Je consulte les avis…");
  });

  it("tient dans la colonne de l'étape, même avec le plus long des noms", async () => {
    const long = `${"A".repeat(80)} ${"B".repeat(80)}`;
    expect((await libelleEtape("fiche_conducteur", { conducteur_id: CONDUCTEUR }, () => long)).length).toBeLessThanOrEqual(
      LONGUEUR_MAX_ETAPE,
    );
    expect((await libelleEtape("chercher_vehicules", { texte: "x".repeat(80) }, inconnu)).length).toBeLessThanOrEqual(
      LONGUEUR_MAX_ETAPE,
    );
  });
});

describe("les consignes de l'écran ouvert (phase 28)", () => {
  it("disent que seule la dernière note compte, et ce que désignent les mots de l'écran", () => {
    expect(CONSIGNES).toContain("# L'écran ouvert");
    expect(CONSIGNES).toContain("Seule la note de la dernière demande compte");
    expect(CONSIGNES).toContain("demande lequel");
  });
});

describe("« Modifier » et les questions avant de proposer (phase 30)", () => {
  const camion = { ref: { id: UUID }, plaque: "AB-123-CD", type: "attitre" as const };
  const lignes: LigneRecapitulatif[] = [
    {
      operation: "cloturer_affectation",
      cible: UUID,
      avant: { fin: null },
      apres: { fin: "2026-11-06T23:00:00.000Z" },
      affichage: { vehicule: camion, conducteur: { ref: { id: UUID }, nom: "Karim B." } },
    },
    {
      operation: "creer_vehicule",
      affichage: { vehicule: { ref: { ligne: 2 }, plaque: "AB-123-CD", type: "attitre" } },
      refus: "La plaque AB-123-CD est déjà dans votre flotte.",
    },
  ];

  it("joint à la demande les lignes du récapitulatif corrigé, motifs compris, et la consigne de le refaire", () => {
    expect(noteCorrection(lignes).split("\n")).toEqual([
      "Le gestionnaire a cliqué « Modifier » : sa demande corrige le récapitulatif que tu as proposé, qui ne s'appliquera plus. Ses lignes :",
      "1. Clôturer l'affectation de Karim B. sur AB-123-CD · Fin : sans fin → 07/11/2026 00:00",
      "2. Ajouter le véhicule AB-123-CD · Impossible : La plaque AB-123-CD est déjà dans votre flotte.",
      "Refais tout le récapitulatif avec proposer_modifications, en tenant compte de la correction, ou pose une question s'il manque une information.",
    ]);
    expect(MESSAGES_AGENT.corrige).toBe("Corrige le récapitulatif");
  });

  it("font poser une question quand la demande est ambiguë ou incomplète, jamais pour l'heure", () => {
    expect(CONSIGNES).toContain("Pose une question courte au lieu d'appeler proposer_modifications");
    expect(CONSIGNES).toContain("deux conducteurs prénommés Karim");
    expect(CONSIGNES).toContain("il manque la date du changement");
    expect(CONSIGNES).toContain("le type, attitré ou pool, d'un nouveau véhicule");
    expect(CONSIGNES).toContain("la fin d'une affectation sur un véhicule de pool");
    expect(CONSIGNES).toContain("« Karim part, Léa reprend » : demande lequel");
    expect(CONSIGNES).toContain("Ne demande jamais l'heure");
  });

  it("disent quoi faire d'une ligne rouge, d'une proposition mal formée et d'une correction", () => {
    expect(CONSIGNES).toContain("« Confirmer », « Modifier » et « Annuler »");
    expect(CONSIGNES).toContain("s'affiche en rouge");
    expect(CONSIGNES).toContain("Ne renonce pas à proposer parce que tu prévois qu'une règle des écrans refusera une ligne");
    expect(CONSIGNES).toContain("Si le motif vient de ton propre calcul");
    expect(CONSIGNES).toContain("Si l'outil refuse ta proposition sans rien enregistrer");
    expect(CONSIGNES).toContain("Quand le gestionnaire clique « Modifier »");
  });
});

describe("aucun outil hors rôle (phase 31)", () => {
  const proposer = (modification: Record<string, unknown>) =>
    ENTREES_OUTILS.proposer_modifications.safeParse({ modifications: [modification] }).success;

  it("ne propose ni suppression, ni désignation, ni classement, ni réouverture, ni email", () => {
    for (const operation of [
      "supprimer_vehicule",
      "supprimer_conducteur",
      "classer_avis",
      "designer_avis",
      "rouvrir_avis",
      "envoyer_email",
    ]) {
      expect(proposer({ operation, vehicule_id: UUID, conducteur_id: UUID, avis_id: UUID }), operation).toBe(false);
    }
  });

  it("n'archive qu'en archivant : un champ de plus est refusé", () => {
    expect(proposer({ operation: "archiver_vehicule", vehicule_id: UUID })).toBe(true);
    expect(proposer({ operation: "archiver_vehicule", vehicule_id: UUID, statut: "supprime" })).toBe(false);
    expect(proposer({ operation: "archiver_vehicule", vehicule_id: UUID, archive_le: null })).toBe(false);
  });

  it("font refuser en une phrase, avec le lien de l'avis, de la fiche ou de l'écran où agir", () => {
    expect(CONSIGNES).toContain("Refuse en une phrase qui commence par « Je ne peux pas »");
    expect(CONSIGNES).toContain("dis que tu peux seulement archiver, et renvoie vers sa fiche");
    expect(CONSIGNES).toContain("[Abonnement](/parametres/abonnement)");
    expect(CONSIGNES).toContain(
      "prépare la part permise avec proposer_modifications, et refuse le reste dans la même réponse",
    );
    expect(CONSIGNES).toContain(`réponds exactement « ${PHRASE_HORS_SUJET} », sans rien d'autre`);
  });
});
