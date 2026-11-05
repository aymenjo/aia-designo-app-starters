"use server";

import { refresh } from "next/cache";
import { RedirectType, redirect } from "next/navigation";
import type { EtatAction } from "@/components/Confirmation";
import * as flotte from "@/lib/flotte/conducteurs";
import { CHAMPS_CONDUCTEUR, type ChampConducteur, type ErreursConducteur } from "@/lib/flotte/regles";
import { createClient } from "@/lib/supabase/server";

export type EtatConducteur = {
  ok?: boolean;
  /** Valeurs du formulaire, renvoyées pour le regarnir après l'envoi. */
  valeurs?: flotte.ValeursConducteur;
  erreurs?: ErreursConducteur;
  /** Le permis ou l'email saisi est celui d'un conducteur archivé : lien vers sa fiche. */
  conducteurArchiveId?: string;
};

/** Les champs listés seulement : un formulaire partiel ne doit rien effacer de ce qu'il n'affiche pas. */
function lireSaisie(
  formData: FormData,
  champs: readonly ChampConducteur[] = CHAMPS_CONDUCTEUR,
): flotte.ValeursConducteur {
  const valeurs = {} as flotte.ValeursConducteur;
  // Les champs liés à l'action viennent du navigateur : seuls ceux de la fiche sont lus.
  for (const champ of CHAMPS_CONDUCTEUR.filter((connu) => champs.includes(connu))) {
    const valeur = formData.get(champ);
    valeurs[champ] = typeof valeur === "string" ? valeur : "";
  }
  return valeurs;
}

function refus(
  resultat: Extract<flotte.ResultatConducteur, { ok: false }>,
  saisie: flotte.ValeursConducteur,
): EtatConducteur {
  return { valeurs: saisie, erreurs: resultat.erreurs, conducteurArchiveId: resultat.conducteurArchiveId };
}

/** Ajout en trois champs, puis direction la fiche pour la compléter. */
export async function ajouterConducteur(_etat: EtatConducteur, formData: FormData): Promise<EtatConducteur> {
  const saisie = lireSaisie(formData);
  const resultat = await flotte.creerConducteur(await createClient(), saisie);
  if (!resultat.ok) return refus(resultat, saisie);
  redirect(`/flotte/conducteurs/${resultat.conducteur.id}`);
}

export async function modifierConducteur(
  id: string,
  _etat: EtatConducteur,
  formData: FormData,
): Promise<EtatConducteur> {
  const saisie = lireSaisie(formData);
  const resultat = await flotte.modifierConducteur(await createClient(), id, saisie);
  if (!resultat.ok) return refus(resultat, saisie);
  refresh();
  return { ok: true, valeurs: flotte.versValeurs(resultat.conducteur) };
}

/** Le récap ANTAI complète les champs manquants sur place : les autres champs de la fiche restent tels quels. */
export async function completerConducteur(
  id: string,
  champs: readonly ChampConducteur[],
  _etat: EtatConducteur,
  formData: FormData,
): Promise<EtatConducteur> {
  const saisie = lireSaisie(formData, champs);
  const resultat = await flotte.completerConducteur(await createClient(), id, saisie);
  if (!resultat.ok) return refus(resultat, saisie);
  refresh();
  return { ok: true, valeurs: flotte.versValeurs(resultat.conducteur) };
}

export async function archiverConducteur(id: string): Promise<EtatAction> {
  const resultat = await flotte.archiverConducteur(await createClient(), id);
  if (!resultat.ok) return { erreur: resultat.erreurs.general };
  refresh();
  return {};
}

export async function reactiverConducteur(id: string): Promise<EtatAction> {
  const resultat = await flotte.reactiverConducteur(await createClient(), id);
  if (!resultat.ok) return { erreur: resultat.erreurs.general };
  refresh();
  return {};
}

/** Seulement sans historique. Avec `replace`, Précédent ne ramène pas sur une fiche disparue. */
export async function supprimerConducteur(id: string): Promise<EtatAction> {
  const resultat = await flotte.supprimerConducteur(await createClient(), id);
  if (!resultat.ok) return { erreur: resultat.erreurs.general };
  redirect("/flotte/conducteurs", RedirectType.replace);
}
