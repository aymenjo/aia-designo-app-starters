"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import * as avis from "@/lib/avis/avis";
import { lireEtRemplirAvis } from "@/lib/avis/lecture";
import { lecteurConfigure } from "@/lib/avis/lecteur-claude";
import { CHAMPS_AVIS, CHAMPS_REQUIS_AVIS, type ChampRequisAvis, type ErreursAvis } from "@/lib/avis/regles";
import { createClient } from "@/lib/supabase/server";

/** Le fichier est déjà dans le bucket : le navigateur l'y a envoyé (une server action est limitée à 1 Mo). */
export async function deposerAvis(chemin: string, nom: string): Promise<avis.ResultatDepot> {
  return avis.creerAvis(await createClient(), { chemin, nom });
}

export type LectureDepot =
  | { ok: true; lue: boolean }
  /** Le n° lu est celui d'un avis existant : le dépôt est abandonné, et l'écran de dépôt mène à l'existant. */
  | { ok: false; existant: { id: string; numero: string } };

/** Juste après le dépôt, l'IA lit l'avis et pré-remplit ses champs. Sans clé d'API, rien n'est lu. */
export async function lireAvisDepose(id: string): Promise<LectureDepot> {
  const resultat = await lireEtRemplirAvis(await createClient(), id, lecteurConfigure());
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
    // Le dépôt doublait un avis existant : il n'existe plus, on revient au dépôt, qui mène à l'existant.
    if (resultat.depotAbandonne) redirect(`/avis/nouveau?existant=${resultat.avisExistantId}`);
    return { valeurs: saisie, erreurs: resultat.erreurs, avisExistantId: resultat.avisExistantId };
  }
  refresh();
  return { ok: true, valeurs: avis.versValeurs(resultat.avis) };
}
