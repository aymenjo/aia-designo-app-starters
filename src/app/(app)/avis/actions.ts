"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import type { EtatAction } from "@/components/Confirmation";
import * as avis from "@/lib/avis/avis";
import { lireEtRemplirAvis } from "@/lib/avis/lecture";
import { lecteurConfigure } from "@/lib/avis/lecteur-claude";
import {
  CHAMPS_AVIS,
  CHAMPS_REQUIS_AVIS,
  type ChampClassement,
  type ChampRequisAvis,
  type ErreursAvis,
  type ErreursClassement,
} from "@/lib/avis/regles";
import { createClient } from "@/lib/supabase/server";
import type { EtatVehicule } from "../flotte/vehicules/actions";

/**
 * Le fichier est déjà dans le bucket : le navigateur l'y a envoyé (une server action est limitée à 1 Mo). Le compteur
 * d'usage de la barre haute suit : un layout ne se re-rend pas à la navigation.
 */
export async function deposerAvis(chemin: string, nom: string): Promise<avis.ResultatDepot> {
  const resultat = await avis.creerAvis(await createClient(), { chemin, nom });
  if (resultat.ok) refresh();
  return resultat;
}

export type LectureDepot =
  | { ok: true; lue: boolean }
  /** Le n° lu est celui d'un avis existant : le dépôt est abandonné, et l'écran de dépôt mène à l'existant. */
  | { ok: false; existant: { id: string; numero: string } };

/**
 * Juste après le dépôt, ou à l'ouverture d'un avis déverrouillé (plan Free), l'IA lit l'avis et pré-remplit ses champs.
 * Sans clé d'API, rien n'est lu. Un doublon abandonné libère une place du quota : le compteur d'usage suit.
 */
export async function lireAvisDepose(id: string): Promise<LectureDepot> {
  const resultat = await lireEtRemplirAvis(await createClient(), id, lecteurConfigure());
  if (resultat.lecture !== "ignoree") refresh();
  if (resultat.lecture === "doublon") return { ok: false, existant: resultat.existant };
  return { ok: true, lue: resultat.lecture === "lue" };
}

export type EtatAvis = {
  ok?: boolean;
  /** Valeurs du formulaire, renvoyées pour le regarnir après l'envoi. */
  valeurs?: avis.ValeursAvis;
  erreurs?: ErreursAvis;
  /** L'avis qui porte déjà le n° saisi : le message d'erreur y mène. */
  avisExistantId?: string;
};

function lireSaisie(formData: FormData): avis.ValeursAvis {
  const valeurs = {} as avis.ValeursAvis;
  for (const champ of CHAMPS_AVIS) {
    const valeur = formData.get(champ);
    valeurs[champ] = typeof valeur === "string" ? valeur : "";
  }
  return valeurs;
}

/** Les champs rouges que le gestionnaire a confirmés d'un clic sur « Confirmer ce champ ». */
function lireConfirmes(formData: FormData): ChampRequisAvis[] {
  return CHAMPS_REQUIS_AVIS.filter((champ) => formData.getAll("confirme").includes(champ));
}

export async function enregistrerAvis(id: string, _etat: EtatAvis, formData: FormData): Promise<EtatAvis> {
  const saisie = lireSaisie(formData);
  const resultat = await avis.modifierAvis(await createClient(), id, saisie, lireConfirmes(formData));
  if (!resultat.ok) {
    // Le dépôt doublait un avis existant : il n'existe plus, on revient au dépôt, qui mène à l'existant. Sa place dans
    // le quota du mois est libérée : le compteur d'usage suit.
    if (resultat.depotAbandonne) {
      refresh();
      redirect(`/avis/nouveau?existant=${resultat.avisExistantId}`);
    }
    return { valeurs: saisie, erreurs: resultat.erreurs, avisExistantId: resultat.avisExistantId };
  }
  refresh();
  return { ok: true, valeurs: avis.versValeurs(resultat.avis) };
}

export type EtatValidation = {
  ok?: boolean;
  erreurs?: { conducteur_id?: string; general?: string };
};

/** « Valider ce conducteur » : le conducteur proposé, ou celui que le gestionnaire a choisi. */
export async function validerConducteur(id: string, _etat: EtatValidation, formData: FormData): Promise<EtatValidation> {
  const conducteurId = formData.get("conducteur_id");
  const resultat = await avis.validerConducteur(
    await createClient(),
    id,
    typeof conducteurId === "string" ? conducteurId : "",
  );
  if (!resultat.ok) return { erreurs: resultat.erreurs };
  refresh();
  return { ok: true };
}

/** « J'ai désigné sur l'ANTAI » : le gestionnaire vient de désigner lui-même, depuis le récap. */
export async function marquerDesigne(id: string): Promise<EtatAction> {
  const resultat = await avis.marquerDesigne(await createClient(), id);
  if (!resultat.ok) return { erreur: resultat.erreurs.general };
  refresh();
  return {};
}

export type EtatClassement = {
  ok?: boolean;
  /** Valeurs du formulaire, renvoyées pour le regarnir après un refus. */
  valeurs?: Record<ChampClassement, string>;
  erreurs?: ErreursClassement;
};

/** « Classer » : le motif choisi et, pour « Autre », le motif en toutes lettres. */
export async function classerAvis(id: string, _etat: EtatClassement, formData: FormData): Promise<EtatClassement> {
  const lire = (champ: ChampClassement) => {
    const valeur = formData.get(champ);
    return typeof valeur === "string" ? valeur : "";
  };
  const valeurs = { motif: lire("motif"), motif_libre: lire("motif_libre") };
  const resultat = await avis.classerAvis(await createClient(), id, valeurs);
  if (!resultat.ok) return { valeurs, erreurs: resultat.erreurs };
  refresh();
  return { ok: true };
}

/** « Rouvrir l'avis » : un avis désigné ou classé par erreur revient dans le suivi. */
export async function rouvrirAvis(id: string): Promise<EtatAction> {
  const resultat = await avis.rouvrirAvis(await createClient(), id);
  if (!resultat.ok) return { erreur: resultat.erreurs.general };
  refresh();
  return {};
}

export type EtatAffectationManquante = { ok?: boolean; erreur?: string };

/** « Enregistrer l'affectation » : celle qui manquait au planning, au nom du conducteur validé. */
export async function enregistrerAffectationManquante(id: string): Promise<EtatAffectationManquante> {
  const resultat = await avis.enregistrerAffectationManquante(await createClient(), id);
  if (!resultat.ok) return { erreur: resultat.erreurs.general };
  refresh();
  return { ok: true };
}

/** « Créer le véhicule » depuis l'avis : la plaque est celle de l'avis, seuls le modèle et le type se saisissent. */
export async function creerVehiculeDepuisAvis(id: string, _etat: EtatVehicule, formData: FormData): Promise<EtatVehicule> {
  const texte = (nom: string) => {
    const valeur = formData.get(nom);
    return typeof valeur === "string" ? valeur : "";
  };
  const saisie = { modele: texte("modele"), type: texte("type") };
  const resultat = await avis.creerVehiculeDepuisAvis(await createClient(), id, saisie);
  if (!resultat.ok) {
    return {
      valeurs: { plaque: "", ...saisie },
      erreurs: resultat.erreurs,
      vehiculeArchiveId: resultat.vehiculeArchiveId,
      invitationPro: resultat.invitationPro,
    };
  }
  refresh();
  const { plaque, modele, type } = resultat.vehicule;
  return { ok: true, valeurs: { plaque, modele: modele ?? "", type } };
}
