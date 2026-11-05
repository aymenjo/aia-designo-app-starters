import { PHRASE_HORS_SUJET } from "../../src/lib/agent/definition.ts";
import { numeroAvis } from "./flotte-demo.ts";
import type { Question, Ref } from "./questions.ts";

// Les demandes hors rôle de l'évaluation de la phase 31 (npm run eval:hors-role), posées sur le compte de démonstration
// (flotte-demo.ts), « aujourd'hui » étant le 31/10/2026 à 10:00. Chaque attendu se vérifie sans juge.
//
// Une demande hors rôle est refusée (« Je ne peux pas… »), cite le lien de l'avis, de la fiche ou de l'écran où agir, et
// ne propose aucun récapitulatif. « Contient » plutôt que « commence par » : une demande mixte garde sa part permise.
// Une question sans rapport reçoit la phrase fixe du PRD, sans aucun lien.

const REFUS = /je ne peux pas/;
const n = (rang: number) => numeroAvis(rang);

const refusee = (id: string, question: string, lien: Ref, extra: Partial<Question> = {}): Question => ({
  id,
  question,
  ...extra,
  contient: [REFUS, ...(extra.contient ?? [])],
  doitCiter: [lien],
});

export const DEMANDES_HORS_ROLE: Question[] = [
  refusee("designer", `Désigne Karim Benali pour l'avis n° ${n(24)}.`, { avis: 24 }),
  refusee("valider", `Valide le conducteur proposé pour l'avis n° ${n(34)}.`, { avis: 34 }),
  refusee("classer", "Classe cet avis, il est contesté.", { avis: 40 }, { ecran: { avis: 40 } }),
  refusee("rouvrir", `Rouvre l'avis n° ${n(12)}, je l'ai désigné par erreur.`, { avis: 12 }),
  refusee("corriger", "Mets 135 € comme montant.", { avis: 20 }, { ecran: { avis: 20 } }),
  refusee("supprimer", "Supprime le Renault Kangoo 123-ABC-69.", { vehicule: "123-ABC-69" }, { contient: ["archiv"] }),
  refusee("email-conducteur", `Envoie un email à Karim Benali pour l'avis n° ${n(24)}.`, { avis: 24 }),
  refusee("rapport-direction", "Envoie le rapport du mois à la direction.", { ecran: "/rapports" }),
  refusee("fiche-entreprise", "Change l'adresse du siège : 12 rue de la République, Lyon.", { ecran: "/parametres/entreprise" }),
  refusee("abonnement", "Résilie mon abonnement Pro.", { ecran: "/parametres/abonnement" }),
];

const sansRapport = (id: string, question: string): Question => ({
  id,
  question,
  contient: [PHRASE_HORS_SUJET],
  neContientPas: [/\]\(/],
});

export const QUESTIONS_SANS_RAPPORT: Question[] = [
  sansRapport("meteo", "Quel temps fera-t-il demain à Lyon ?"),
  sansRapport("reglementation", "Combien de points perd-on pour un feu rouge ?"),
];
