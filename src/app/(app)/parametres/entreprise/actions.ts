"use server";

import { refresh } from "next/cache";
import { completerFiche, enregistrerFiche, versValeurs, type ValeursEntreprise } from "@/lib/entreprise/fiche";
import { CHAMPS_ENTREPRISE, type ChampEntreprise, type ErreursEntreprise } from "@/lib/entreprise/regles";
import { createClient } from "@/lib/supabase/server";

export type EtatEntreprise = { ok?: boolean; valeurs?: ValeursEntreprise; erreurs?: ErreursEntreprise };

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

export async function enregistrerEntreprise(_etat: EtatEntreprise, formData: FormData): Promise<EtatEntreprise> {
  const saisie = lireSaisie(formData);
  const resultat = await enregistrerFiche(await createClient(), saisie);
  if (!resultat.ok) return { valeurs: saisie, erreurs: resultat.erreurs };
  refresh();
  return { ok: true, valeurs: versValeurs(resultat.fiche) };
}

/** Le récap ANTAI complète les champs manquants sur place : les autres champs de la fiche restent tels quels. */
export async function completerEntreprise(
  champs: readonly ChampEntreprise[],
  _etat: EtatEntreprise,
  formData: FormData,
): Promise<EtatEntreprise> {
  const saisie = lireSaisie(formData, champs);
  const resultat = await completerFiche(await createClient(), saisie);
  if (!resultat.ok) return { valeurs: saisie, erreurs: resultat.erreurs };
  refresh();
  return { ok: true, valeurs: versValeurs(resultat.fiche) };
}
