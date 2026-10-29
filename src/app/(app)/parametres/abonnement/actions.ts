"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { EtatAction } from "@/components/Confirmation";
import { preparerPaiement, preparerPortail, type ResultatRedirection } from "@/lib/abonnement/paiement";
import { MESSAGES_ABONNEMENT } from "@/lib/abonnement/regles";
import { clientStripeConfigure } from "@/lib/abonnement/stripe";
import { urlSiteDepuisEntetes } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Ouvre une page sécurisée de Stripe, ou renvoie le refus à afficher. Une panne de Stripe se lit dans les logs ; le
 * gestionnaire voit seulement que le paiement est indisponible. `redirect` est hors du `try` : il lève une exception
 * que Next intercepte pour rediriger.
 */
async function versStripe(preparer: () => Promise<ResultatRedirection>): Promise<EtatAction> {
  let resultat: ResultatRedirection;
  try {
    resultat = await preparer();
  } catch (erreur) {
    console.error("stripe", erreur instanceof Error ? erreur.message : erreur);
    return { erreur: MESSAGES_ABONNEMENT.indisponible };
  }
  if (!resultat.ok) return { erreur: resultat.erreur };
  redirect(resultat.url);
}

/** « Passer en Pro » : la page de paiement de Stripe. Le webhook passera le compte en Pro. */
export async function ouvrirPaiement(): Promise<EtatAction> {
  const urlSite = urlSiteDepuisEntetes(await headers());
  return versStripe(async () =>
    preparerPaiement({
      supabase: await createClient(),
      admin: createAdminClient(),
      stripe: clientStripeConfigure(),
      urlSite,
    }),
  );
}

/** « Gérer mon abonnement » : le portail client de Stripe (carte, factures, annulation). */
export async function ouvrirPortail(): Promise<EtatAction> {
  const urlSite = urlSiteDepuisEntetes(await headers());
  return versStripe(async () =>
    preparerPortail({ supabase: await createClient(), stripe: clientStripeConfigure(), urlSite }),
  );
}
