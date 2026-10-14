// Les chiffres de l'offre, définis une seule fois : la landing, les quotas Free (phase 17),
// le passage en Pro (phase 18) et la limite de l'agent (phase 27) les reprennent.

/** Free : 3 véhicules actifs, 5 avis par mois calendaire (comptés au dépôt), historique visible sur 3 mois. */
export const LIMITES_FREE = { vehicules: 3, avisParMois: 5, historiqueMois: 3 } as const;

export const PRIX_PRO_HT_CENTIMES = 4_900;
export const TAUX_TVA = 0.2;
/** 58,80 € TTC. */
export const PRIX_PRO_TTC_CENTIMES = Math.round(PRIX_PRO_HT_CENTIMES * (1 + TAUX_TVA));

/** Demande à Désigno : demandes par mois calendaire, en Pro. */
export const DEMANDES_AGENT_PAR_MOIS = 100;
