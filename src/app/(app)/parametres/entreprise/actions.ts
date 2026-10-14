"use server";

import { refresh } from "next/cache";
import { enregistrerFiche, versValeurs, type ValeursEntreprise } from "@/lib/entreprise/fiche";
import { CHAMPS_ENTREPRISE, type ErreursEntreprise } from "@/lib/entreprise/regles";
import { createClient } from "@/lib/supabase/server";

export type EtatEntreprise = { ok?: boolean; valeurs?: ValeursEntreprise; erreurs?: ErreursEntreprise };

function lireSaisie(formData: FormData): ValeursEntreprise {
  const valeurs = {} as ValeursEntreprise;
  for (const champ of CHAMPS_ENTREPRISE) {
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
