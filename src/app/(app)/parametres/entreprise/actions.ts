"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { refresh } from "next/cache";
import { after } from "next/server";
import { synchroniserApresFiche } from "@/lib/abonnement/paiement";
import type { Plan } from "@/lib/abonnement/plans";
import { clientStripeConfigure } from "@/lib/abonnement/stripe";
import {
  completerFiche,
  enregistrerFiche,
  versValeurs,
  versValeursDirection,
  type FicheEntreprise,
  type ValeursDirection,
  type ValeursEntreprise,
} from "@/lib/entreprise/fiche";
import {
  CHAMPS_DIRECTION,
  CHAMPS_ENTREPRISE,
  ficheComplete,
  type ChampEntreprise,
  type ErreursEntreprise,
} from "@/lib/entreprise/regles";
import { createClient } from "@/lib/supabase/server";

export type EtatEntreprise = {
  ok?: boolean;
  valeurs?: ValeursEntreprise;
  /** Les adresses « direction » (phase 25), sur l'écran de la fiche seulement, en Pro. */
  direction?: ValeursDirection;
  erreurs?: ErreursEntreprise;
};

/** Les champs listés seulement : un formulaire partiel ne doit rien effacer de ce qu'il n'affiche pas. */
function lireSaisie(formData: FormData, champs: readonly ChampEntreprise[] = CHAMPS_ENTREPRISE): ValeursEntreprise {
  const valeurs = {} as ValeursEntreprise;
  // Les champs liés à l'action viennent du navigateur : seuls ceux de la fiche sont lus.
  for (const champ of CHAMPS_ENTREPRISE.filter((connu) => champs.includes(connu))) {
    const valeur = formData.get(champ);
    valeurs[champ] = typeof valeur === "string" ? valeur : "";
  }
  return valeurs;
}

function lireDirection(formData: FormData): ValeursDirection {
  return Object.fromEntries(
    CHAMPS_DIRECTION.map((champ) => {
      const valeur = formData.get(champ);
      return [champ, typeof valeur === "string" ? valeur : ""];
    }),
  ) as ValeursDirection;
}

/**
 * Le client Stripe, s'il existe déjà (passage en Pro), reprend la fiche enregistrée : les factures suivantes portent la
 * nouvelle raison sociale. Après la réponse, pour ne pas faire attendre l'écran ; un échec se lit dans les logs, et le
 * prochain paiement, ou le prochain enregistrement, rattrape.
 */
async function synchroniserStripe(supabase: SupabaseClient, fiche: FicheEntreprise) {
  const stripe = clientStripeConfigure();
  if (!stripe || !ficheComplete(fiche)) return;
  const [{ data: entreprise }, { data: session }] = await Promise.all([
    supabase.from("entreprise").select("id, stripe_client_id").single<{ id: string; stripe_client_id: string | null }>(),
    supabase.auth.getClaims(),
  ]);
  const email = session?.claims.email;
  if (!entreprise?.stripe_client_id || typeof email !== "string") return;
  const { id: entrepriseId, stripe_client_id: clientId } = entreprise;
  after(() =>
    synchroniserApresFiche({ stripe, clientId, entrepriseId, email, fiche }).catch((erreur: unknown) =>
      console.error("stripe", "client", clientId, erreur instanceof Error ? erreur.message : erreur),
    ),
  );
}

/**
 * L'écran de la fiche. Les adresses « direction » sont une fonction Pro : le plan est relu à l'enregistrement, et en
 * Free, celles déjà saisies restent telles quelles, comme le reste des données au retour en Free.
 */
export async function enregistrerEntreprise(_etat: EtatEntreprise, formData: FormData): Promise<EtatEntreprise> {
  const saisie = lireSaisie(formData);
  const supabase = await createClient();
  const entreprise = await supabase.from("entreprise").select("plan").single<{ plan: Plan }>();
  if (entreprise.error) throw entreprise.error;
  const direction = entreprise.data.plan === "pro" ? lireDirection(formData) : undefined;
  const resultat = await enregistrerFiche(
    supabase,
    saisie,
    direction && CHAMPS_DIRECTION.map((champ) => direction[champ]),
  );
  if (!resultat.ok) return { valeurs: saisie, direction, erreurs: resultat.erreurs };
  await synchroniserStripe(supabase, resultat.fiche);
  refresh();
  return {
    ok: true,
    valeurs: versValeurs(resultat.fiche),
    direction: versValeursDirection(resultat.fiche.emails_direction),
  };
}

/**
 * Le récap ANTAI et l'écran Abonnement complètent les champs manquants sur place : les autres champs de la fiche restent
 * tels quels.
 */
export async function completerEntreprise(
  champs: readonly ChampEntreprise[],
  _etat: EtatEntreprise,
  formData: FormData,
): Promise<EtatEntreprise> {
  const saisie = lireSaisie(formData, champs);
  const supabase = await createClient();
  const resultat = await completerFiche(supabase, saisie);
  if (!resultat.ok) return { valeurs: saisie, erreurs: resultat.erreurs };
  await synchroniserStripe(supabase, resultat.fiche);
  refresh();
  return { ok: true, valeurs: versValeurs(resultat.fiche) };
}
