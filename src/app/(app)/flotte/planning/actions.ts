"use server";

import { refresh } from "next/cache";
import * as flotte from "@/lib/flotte/affectations";
import { CHAMPS_AFFECTATION, type ChampAffectation, type ErreursAffectation } from "@/lib/flotte/regles";
import { createClient } from "@/lib/supabase/server";

/** Valeurs du formulaire, renvoyées pour le regarnir après l'envoi : dates JJ/MM/AAAA, heures HH:MM. */
export type ValeursAffectation = Record<ChampAffectation, string>;

export type EtatAffectation = { ok?: boolean; valeurs?: ValeursAffectation; erreurs?: ErreursAffectation };

export type ValeursCloture = Pick<ValeursAffectation, "fin_date" | "fin_heure">;
export type EtatCloture = { ok?: boolean; valeurs?: ValeursCloture; erreurs?: ErreursAffectation };

function lire<Champ extends string>(formData: FormData, champs: readonly Champ[]) {
  const valeurs = {} as Record<Champ, string>;
  for (const champ of champs) {
    const valeur = formData.get(champ);
    valeurs[champ] = typeof valeur === "string" ? valeur : "";
  }
  return valeurs;
}

function versEtat<Valeurs>(resultat: flotte.ResultatAffectation, saisie: Valeurs) {
  if (!resultat.ok) return { valeurs: saisie, erreurs: resultat.erreurs };
  refresh();
  return { ok: true, valeurs: saisie };
}

export async function ajouterAffectation(_etat: EtatAffectation, formData: FormData): Promise<EtatAffectation> {
  const saisie = lire(formData, CHAMPS_AFFECTATION);
  return versEtat(await flotte.creerAffectation(await createClient(), saisie), saisie);
}

export async function modifierAffectation(
  id: string,
  _etat: EtatAffectation,
  formData: FormData,
): Promise<EtatAffectation> {
  const saisie = lire(formData, CHAMPS_AFFECTATION);
  return versEtat(await flotte.modifierAffectation(await createClient(), id, saisie), saisie);
}

export async function cloturerAffectation(id: string, _etat: EtatCloture, formData: FormData): Promise<EtatCloture> {
  const saisie = lire(formData, ["fin_date", "fin_heure"] as const);
  return versEtat(await flotte.cloturerAffectation(await createClient(), id, saisie), saisie);
}
