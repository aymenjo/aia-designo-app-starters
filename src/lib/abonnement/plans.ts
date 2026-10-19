// Les chiffres de l'offre, définis une seule fois : la landing, les quotas Free (phase 17),
// le passage en Pro (phase 18) et la limite de l'agent (phase 27) les reprennent.

/** `entreprise.plan` : la source de vérité, écrite par les webhooks Stripe (phase 18). */
export type Plan = "free" | "pro";

/**
 * Free : 3 véhicules actifs, 5 avis par mois calendaire (comptés au dépôt), historique visible sur 3 mois.
 * Les triggers de la base reprennent 3 et 5 (migration du plan Free) : les tests d'intégration les vérifient d'ici.
 */
export const LIMITES_FREE = { vehicules: 3, avisParMois: 5, historiqueMois: 3 } as const;

export const PRIX_PRO_HT_CENTIMES = 4_900;
export const TAUX_TVA = 0.2;
/** 58,80 € TTC. */
export const PRIX_PRO_TTC_CENTIMES = Math.round(PRIX_PRO_HT_CENTIMES * (1 + TAUX_TVA));

/** Demande à Désigno : demandes par mois calendaire, en Pro. */
export const DEMANDES_AGENT_PAR_MOIS = 100;

/** Les fonctions Pro, chacune avec sa phrase d'explication : les cadenas de l'écran Abonnement les reprennent. */
export const FONCTIONS_PRO: readonly { nom: string; explication: string }[] = [
  {
    nom: "Véhicules et avis illimités",
    explication: `Plus de limite de ${LIMITES_FREE.vehicules} véhicules actifs ni de ${LIMITES_FREE.avisParMois} avis par mois : aucun avis n'est verrouillé.`,
  },
  {
    nom: "Historique complet",
    explication: `Les avis désignés ou classés depuis plus de ${LIMITES_FREE.historiqueMois} mois restent consultables.`,
  },
  {
    nom: "Relève Gmail",
    explication: "Les avis rangés dans un libellé de votre boîte Gmail sont relevés automatiquement.",
  },
  {
    nom: "Email au conducteur",
    explication: "Le conducteur désigné est prévenu par email, après un aperçu, avec les faits de l'avis.",
  },
  {
    nom: "Rappels Google Calendar",
    explication: "Chaque échéance a son rappel à J-2 dans un agenda « Désigno ».",
  },
  {
    nom: "Demande à Désigno",
    explication: `Posez une question sur votre flotte, ou décrivez un changement en une phrase : ${DEMANDES_AGENT_PAR_MOIS} demandes par mois.`,
  },
  {
    nom: "Export CSV",
    explication: "L'historique de vos avis, prêt à transmettre à la comptabilité.",
  },
  {
    nom: "Rapport mensuel",
    explication: "Le 1er du mois, la direction reçoit le bilan de la flotte en PDF.",
  },
];
