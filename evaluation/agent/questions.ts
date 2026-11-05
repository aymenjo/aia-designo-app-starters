import { PHRASE_HORS_SUJET } from "../../src/lib/agent/definition.ts";
import type { Operation } from "../../src/lib/flotte/regles-recapitulatif.ts";
import { numeroAvis, reservataire } from "./flotte-demo.ts";

// Les 30 questions de l'évaluation de Demande à Désigno (phase 26), posées sur le compte de démonstration
// (flotte-demo.ts), « aujourd'hui » étant le 31/10/2026 à 10:00. Chaque attendu se vérifie sans juge : des textes que la
// réponse doit contenir, des éléments qu'elle doit citer par un lien, et ceux qu'elle ne doit pas citer.
//
// À relire avant la première mesure : une question ambiguë, ou un attendu trop strict, fausse le taux.

/** Un élément de la démo : un véhicule par sa plaque, un conducteur par son nom, un avis par son rang. */
export type RefElement = { vehicule: string } | { conducteur: string } | { avis: number };

/** Ce qu'une réponse cite : un élément de la démo, ou un écran par son chemin (« /rapports », phase 31). */
export type Ref = RefElement | { ecran: string };

export type Question = {
  id: string;
  question: string;
  /** L'écran ouvert à l'envoi (phase 28) : la fiche d'un avis, d'un véhicule ou d'un conducteur. Sans écran : aucun. */
  ecran?: RefElement;
  /** Les éléments que la réponse cite par un lien, tous. */
  doitCiter?: Ref[];
  /** Les éléments qu'elle ne cite pas. */
  neDoitPasCiter?: Ref[];
  /** Les textes qu'elle contient, sans tenir compte de la casse, des accents ni des espaces. */
  contient?: (string | RegExp)[];
  neContientPas?: (string | RegExp)[];
  /** Sans donnée pour répondre : la réponse le dit (« Aucun… », « Aucune… »). */
  aucuneDonnee?: boolean;
  /**
   * Un changement décrit (phase 29) : l'agent propose un récapitulatif, avec ces opérations dans cet ordre, et ses lignes
   * contiennent ces textes. Sans cette clé, aucun récapitulatif ne doit être proposé.
   */
  recapitulatif?: { operations: Operation[]; contient?: string[] };
};

const avis = (...rangs: number[]): Ref[] => rangs.map((rang) => ({ avis: rang }));
const n = (rang: number) => numeroAvis(rang);

export const QUESTIONS: Question[] = [
  // Les 3 exemples du panneau
  {
    id: "exemple-planning",
    question: "Qui avait AB-123-CD le 12/03 à 8 h ?",
    contient: ["Karim Benali"],
    doitCiter: [{ conducteur: "Karim Benali" }],
  },
  {
    id: "exemple-bloques",
    question: "Quels avis sont bloqués, et pourquoi ?",
    contient: ["Sarah Lefèvre", "Manon Rousseau", "Inès Garnier", "Julien Morel", "ZZ-999-ZZ"],
    doitCiter: avis(26, 27, 28, 29, 30, 31, 33, 40),
    neDoitPasCiter: avis(24, 32, 34, 35, 36),
  },
  {
    id: "exemple-modification",
    question: "Karim part vendredi, passe son camion à Léa",
    // Vendredi est le 06/11/2026 : la fin de l'affectation de Karim, et le début de celle de Léa, tombent le samedi à 00:00.
    recapitulatif: {
      operations: ["cloturer_affectation", "creer_affectation", "archiver_conducteur"],
      contient: ["Karim B. sur AB-123-CD", "Léa M. sur AB-123-CD", "07/11/2026 00:00"],
    },
  },
  // Le planning
  {
    id: "pool-couvert",
    question: "Qui conduisait MN-345-PQ le 14/10 à 9 h 30 ?",
    contient: [reservataire("MN-345-PQ", "2026-10-14")!],
    doitCiter: [{ conducteur: reservataire("MN-345-PQ", "2026-10-14")! }],
  },
  {
    id: "pool-libre",
    question: "Qui avait le Volkswagen Crafter le 14/10 à 9 h 30 ?",
    contient: ["NP-456-QR"],
    aucuneDonnee: true,
  },
  {
    id: "trou-planning",
    question: "Qui avait KL-123-MN le 20/08 à 9 h 15 ?",
    contient: ["KL-123-MN"],
    aucuneDonnee: true,
  },
  {
    id: "pool-juillet",
    question: "Qui conduisait LM-234-NP le 07/07 à 10 h ?",
    contient: [reservataire("LM-234-NP", "2026-07-07")!],
  },
  {
    id: "changement-attitre",
    question: "Qui conduisait le Fiat Ducato en juillet ?",
    contient: ["Camille Fournier", "FG-678-HJ"],
    neContientPas: [/Hugo Blanc conduisait/i],
  },
  {
    id: "vehicule-actuel",
    question: "Quel véhicule conduit Hugo Blanc en ce moment ?",
    contient: ["FG-678-HJ"],
    doitCiter: [{ vehicule: "FG-678-HJ" }],
  },
  {
    id: "conducteur-actuel",
    question: "Qui conduit le Toyota Proace en ce moment ?",
    contient: ["Chloé Bonnet", "KL-123-MN"],
  },
  // La flotte
  {
    id: "pool",
    question: "Quels véhicules sont de pool ?",
    contient: ["LM-234-NP", "MN-345-PQ", "NP-456-QR", "123-ABC-69"],
    doitCiter: [{ vehicule: "LM-234-NP" }, { vehicule: "MN-345-PQ" }, { vehicule: "NP-456-QR" }, { vehicule: "123-ABC-69" }],
  },
  {
    id: "archives",
    question: "Quels véhicules sont archivés ?",
    contient: ["PQ-567-RS"],
    doitCiter: [{ vehicule: "PQ-567-RS" }],
  },
  {
    id: "fiches-incompletes",
    question: "Quelles fiches de conducteurs sont incomplètes, et que leur manque-t-il ?",
    contient: ["Sarah Lefèvre", "Inès Garnier", "Manon Rousseau", "permis", "adresse", "naissance"],
    doitCiter: [{ conducteur: "Sarah Lefèvre" }, { conducteur: "Inès Garnier" }, { conducteur: "Manon Rousseau" }],
    neDoitPasCiter: [{ conducteur: "Karim Benali" }],
  },
  {
    id: "permis",
    question: "Quel est le n° de permis de Karim Benali ?",
    contient: ["120375201001"],
    doitCiter: [{ conducteur: "Karim Benali" }],
  },
  {
    id: "adresse",
    question: "Quelle est l'adresse de Sarah Lefèvre ?",
    contient: ["6 rue Paul Bert"],
    doitCiter: [{ conducteur: "Sarah Lefèvre" }],
  },
  {
    id: "sans-email",
    question: "Quels conducteurs n'ont pas d'email ?",
    contient: ["Chloé Bonnet"],
    doitCiter: [{ conducteur: "Chloé Bonnet" }],
  },
  // Les avis
  {
    id: "a-traiter",
    question: "Quels avis sont à traiter, et que faut-il vérifier ?",
    doitCiter: avis(20, 21, 22, 23),
    contient: ["montant", "lieu"],
  },
  {
    id: "a-valider",
    question: "Combien d'avis sont encore à valider ?",
    contient: [/\b17\b/],
    neContientPas: [/tous les avis sont d[ée]sign[ée]s/i],
  },
  {
    id: "depassees",
    question: "Quels avis ouverts ont dépassé leur échéance ?",
    doitCiter: avis(28, 38),
  },
  {
    id: "sept-jours",
    question: "Quels avis ouverts ont une échéance d'ici au 07/11 ?",
    doitCiter: avis(25, 26, 29),
  },
  {
    id: "avis-par-numero",
    question: `Que sait-on de l'avis n° ${n(30)} ?`,
    contient: ["ZZ-999-ZZ", "inconnu"],
    doitCiter: avis(30),
  },
  {
    id: "designe-pour",
    question: `Qui a été désigné pour l'avis n° ${n(13)} ?`,
    contient: ["Hugo Blanc"],
    doitCiter: avis(13),
  },
  {
    id: "designes-karim",
    question: "Combien d'avis ont été désignés au nom de Karim Benali cette année ?",
    contient: [/\b(3|trois)\b/],
    doitCiter: avis(1, 4, 12),
  },
  {
    id: "avis-lea",
    question: "Quels sont les avis de Léa Moreau ?",
    doitCiter: avis(2, 25),
  },
  {
    id: "avis-julien",
    question: "Y a-t-il des avis au nom de Julien Morel ?",
    doitCiter: avis(10),
    contient: ["archiv"],
  },
  {
    id: "classes",
    question: "Quels avis ont été classés, et pour quel motif ?",
    doitCiter: avis(16, 17, 18, 19),
    contient: ["contesté", "usurpée", "non soumis", "loueur"],
  },
  {
    id: "montant-classes",
    question: "Quel est le montant total des avis classés ?",
    contient: ["373,00"],
  },
  {
    id: "avis-vehicule",
    question: "Combien d'avis a reçus le Ford Transit depuis mai ?",
    contient: [/\b(3|trois)\b/],
    doitCiter: avis(3, 14, 35),
  },
  // Hors rôle
  {
    id: "designer",
    question: `Désigne Karim Benali pour l'avis n° ${n(24)}.`,
    doitCiter: avis(24),
  },
  {
    id: "hors-sujet",
    question: "Quelle est la réglementation sur les excès de vitesse en France ?",
    contient: [PHRASE_HORS_SUJET],
  },
];
