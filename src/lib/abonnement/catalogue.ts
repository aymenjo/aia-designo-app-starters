// Le catalogue Stripe de Désigno, sans import : l'application et `npm run stripe:config` (scripts/stripe-config.mts,
// lancé par Node seul) le partagent. Le script crée ces objets ; l'application les retrouve par ces identifiants.

/**
 * La version d'API de Stripe : celle du SDK (`stripe@23`), et celle de l'endpoint du webhook à régler dans le Dashboard
 * (docs/DEPLOIEMENT.md). Une autre version change la forme des objets reçus : la fin de période, par exemple.
 */
export const VERSION_API_STRIPE = "2026-09-30.endive";

/** L'id fixe du produit « Désigno Pro » : le script le crée sous cet id, en test comme en live. */
export const PRODUIT_PRO = "designo_pro";

/** La lookup_key du prix mensuel : 49 € HT, hors taxe (la TVA s'ajoute). Un nouveau prix la reprend au précédent. */
export const CLE_PRIX_PRO = "designo_pro_mensuel";

/** La métadonnée qui repère le taux « TVA FR 20 % » : un taux de TVA n'a pas d'id choisi ni de lookup_key. */
export const METADONNEE_TVA = { cle: "designo", valeur: "tva_fr_20" } as const;
