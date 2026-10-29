"use server";

import { refresh } from "next/cache";
import { RedirectType, redirect } from "next/navigation";
import type { EtatAction } from "@/components/Confirmation";
import type { ErreursVehicule } from "@/lib/flotte/regles";
import * as flotte from "@/lib/flotte/vehicules";
import { createClient } from "@/lib/supabase/server";

/** Valeurs du formulaire, renvoyées pour le regarnir après l'envoi. */
export type ValeursVehicule = { plaque: string; modele: string; type: string };

export type EtatVehicule = {
  ok?: boolean;
  valeurs?: ValeursVehicule;
  erreurs?: ErreursVehicule;
  /** La plaque saisie est celle d'un véhicule archivé : lien vers sa fiche. */
  vehiculeArchiveId?: string;
  /** La limite Free est atteinte : le refus invite à passer en Pro. */
  invitationPro?: true;
};

function lireSaisie(formData: FormData): ValeursVehicule {
  const texte = (nom: string) => {
    const valeur = formData.get(nom);
    return typeof valeur === "string" ? valeur : "";
  };
  return { plaque: texte("plaque"), modele: texte("modele"), type: texte("type") };
}

function versEtat(resultat: flotte.ResultatVehicule, saisie: ValeursVehicule): EtatVehicule {
  if (!resultat.ok) {
    const { erreurs, vehiculeArchiveId, invitationPro } = resultat;
    return { valeurs: saisie, erreurs, vehiculeArchiveId, invitationPro };
  }
  refresh();
  const { plaque, modele, type } = resultat.vehicule;
  return { ok: true, valeurs: { plaque, modele: modele ?? "", type } };
}

export async function ajouterVehicule(_etat: EtatVehicule, formData: FormData): Promise<EtatVehicule> {
  const saisie = lireSaisie(formData);
  return versEtat(await flotte.creerVehicule(await createClient(), saisie), saisie);
}

export async function modifierVehicule(id: string, _etat: EtatVehicule, formData: FormData): Promise<EtatVehicule> {
  const saisie = lireSaisie(formData);
  return versEtat(await flotte.modifierVehicule(await createClient(), id, saisie), saisie);
}

export async function archiverVehicule(id: string): Promise<EtatAction> {
  const resultat = await flotte.archiverVehicule(await createClient(), id);
  if (!resultat.ok) return { erreur: resultat.erreurs.general };
  refresh();
  return {};
}

export async function reactiverVehicule(id: string): Promise<EtatAction> {
  const resultat = await flotte.reactiverVehicule(await createClient(), id);
  if (!resultat.ok) return { erreur: resultat.erreurs.general, invitationPro: resultat.invitationPro };
  refresh();
  return {};
}

/** « Rendre actif » un véhicule en lecture seule (retour en Free), dans la limite Free : ses avis bloqués se débloquent. */
export async function rendreActif(id: string): Promise<EtatAction> {
  const resultat = await flotte.rendreActifs(await createClient(), [id]);
  if (!resultat.ok) return { erreur: resultat.erreur, invitationPro: resultat.invitationPro };
  refresh();
  return {};
}

/**
 * Seulement sans historique. Avec `replace`, Précédent ne ramène pas sur une fiche disparue. Le compteur d'usage de la
 * barre haute suit : la redirection seule ne re-rend pas le layout.
 */
export async function supprimerVehicule(id: string): Promise<EtatAction> {
  const resultat = await flotte.supprimerVehicule(await createClient(), id);
  if (!resultat.ok) return { erreur: resultat.erreurs.general };
  refresh();
  redirect("/flotte/vehicules", RedirectType.replace);
}
