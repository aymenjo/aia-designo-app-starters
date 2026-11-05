import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { BUCKET_AVIS, appliquerLecture } from "./avis";
import {
  CHAMPS_AVIS,
  CHAMP_REQUIS_DE,
  NIVEAUX_CONFIANCE,
  normaliserNumeroAvis,
  plusFaible,
  schemaIdAvis,
  verifierSaisieAvis,
  type ChampAvis,
  type ChampRequisAvis,
  type Confiance,
  type Confiances,
  type ErreursAvis,
  type SaisieAvis,
  type ValeursRefusees,
} from "./regles";

// Lecture IA d'un avis déposé (phase 9) : le fichier est lu une seule fois, juste après le dépôt, et ses champs
// pré-remplis avec un niveau de confiance. Le lecteur est injecté : les tests n'appellent jamais l'API.

const champLu = (description: string) =>
  z
    .object({
      valeur: z.string().nullable(),
      confiance: z.enum(NIVEAUX_CONFIANCE),
    })
    .describe(description);

/** Ce qui est demandé au lecteur : les champs du formulaire, aux formats de saisie, chacun avec son niveau. */
export const schemaLecture = z.object({
  numero: champLu("N° de l'avis : 10 chiffres."),
  plaque: champLu("Immatriculation du véhicule, telle qu'imprimée."),
  infraction_date: champLu("Date de l'infraction, JJ/MM/AAAA."),
  infraction_heure: champLu("Heure de l'infraction, HH:MM sur 24 h."),
  lieu: champLu("Lieu de l'infraction, tel qu'imprimé."),
  infraction: champLu("Libellé de l'infraction, tel qu'imprimé."),
  montant: champLu("Montant de l'amende forfaitaire en euros, par exemple 135,00."),
  date_envoi: champLu("Date d'envoi imprimée sur l'avis, JJ/MM/AAAA."),
} satisfies Record<ChampAvis, ReturnType<typeof champLu>>);
export type Lecture = z.infer<typeof schemaLecture>;

/** Le fichier stocké, tel que le lecteur le reçoit : PDF, JPEG ou PNG. */
export type FichierAvis = { contenu: Buffer; type: string };
export type Lecteur = (fichier: FichierAvis) => Promise<Lecture>;

/**
 * Une lecture prête à écrire : une saisie valide, le niveau de chaque champ requis, et les valeurs lues mais refusées
 * par les règles, avec leur motif.
 */
export type LectureNettoyee = { saisie: SaisieAvis; confiances: Confiances; refusees: ValeursRefusees };

/** La date et l'heure vont ensemble : l'une vidée, l'autre l'est aussi (une heure seule n'est pas lisible). */
const COUPLES: Partial<Record<ChampAvis, ChampAvis>> = {
  infraction_date: "infraction_heure",
  infraction_heure: "infraction_date",
};

/**
 * Passe la lecture par les règles de la saisie : un champ fautif est vidé et devient rouge, jusqu'à ce que tout soit
 * valide. Les règles croisées s'appliquent aussi : une date d'envoi antérieure à l'infraction est vidée. Un champ vide
 * est toujours rouge, et la date et l'heure prennent le moins sûr de leurs deux niveaux. Ce qui a été lu puis vidé
 * est gardé dans `refusees`, avec le message de la règle, pour que l'écran le montre.
 */
export function nettoyerLecture(lecture: Lecture): LectureNettoyee {
  const lues: SaisieAvis = {};
  const niveaux = {} as Record<ChampAvis, Confiance>;
  for (const champ of CHAMPS_AVIS) {
    const valeur = lecture[champ].valeur?.trim() || null;
    lues[champ] = valeur;
    niveaux[champ] = valeur ? lecture[champ].confiance : "non_lu";
  }

  const saisie = { ...lues };
  const refusees: ValeursRefusees = {};
  // Chaque tour vide au moins un champ rempli : la boucle s'arrête.
  for (let erreurs = verifierSaisieAvis(saisie); enErreur(erreurs).length; erreurs = verifierSaisieAvis(saisie)) {
    for (const champ of enErreur(erreurs)) {
      const requis = CHAMP_REQUIS_DE[champ];
      refusees[requis] ??= { valeur: valeurLue(lues, requis), motif: erreurs[champ]! };
      for (const vide of [champ, COUPLES[champ] ?? champ]) {
        saisie[vide] = null;
        niveaux[vide] = "non_lu";
      }
    }
  }

  const confiances: Confiances = {};
  for (const champ of CHAMPS_AVIS) {
    const requis = CHAMP_REQUIS_DE[champ];
    confiances[requis] = plusFaible(confiances[requis], niveaux[champ]);
  }
  return { saisie, confiances, refusees };
}

function enErreur(erreurs: ErreursAvis): ChampAvis[] {
  return CHAMPS_AVIS.filter((champ) => erreurs[champ]);
}

/** Ce qui a été lu pour un champ requis : la date et l'heure ensemble, « 31/02/2026 08:30 ». */
function valeurLue(lues: SaisieAvis, requis: ChampRequisAvis) {
  return CHAMPS_AVIS.filter((champ) => CHAMP_REQUIS_DE[champ] === requis && lues[champ])
    .map((champ) => lues[champ])
    .join(" ");
}

export type ResultatLecture =
  | { lecture: "ignoree" | "lue" | "echec" }
  /** Le n° lu est celui d'un avis existant : le dépôt est abandonné, fichier compris. */
  | { lecture: "doublon"; existant: { id: string; numero: string } };

/**
 * Lit l'avis déposé et remplit ses champs, sous la session du gestionnaire (RLS). La lecture n'a lieu qu'une fois :
 * un verrou en base l'empêche de repartir, même appelée deux fois. Sans lecteur (pas de clé d'API), rien n'est fait.
 * Si la lecture échoue, l'avis reste intact et se saisit à la main.
 */
export async function lireEtRemplirAvis(
  supabase: SupabaseClient,
  id: string,
  lecteur: Lecteur | null,
): Promise<ResultatLecture> {
  if (!lecteur || !schemaIdAvis.safeParse(id).success) return { lecture: "ignoree" };

  // Seul un avis jamais lu, encore « À traiter », est lu. Un avis verrouillé (plan Free) attend son déverrouillage.
  const { data: verrou, error } = await supabase
    .from("avis")
    .update({ lecture_ia: "en_cours" })
    .eq("id", id)
    .is("lecture_ia", null)
    .eq("statut", "a_traiter")
    .eq("verrouille", false)
    .select("fichier, fichier_type")
    .maybeSingle<{ fichier: string; fichier_type: string }>();
  if (error) console.error("avis", "lecture", error.code, error.message);
  if (error || !verrou) return { lecture: "ignoree" };

  try {
    const { data: fichier, error: erreurFichier } = await supabase.storage.from(BUCKET_AVIS).download(verrou.fichier);
    if (erreurFichier) throw erreurFichier;
    const lue = nettoyerLecture(
      await lecteur({ contenu: Buffer.from(await fichier.arrayBuffer()), type: verrou.fichier_type }),
    );

    const resultat = await appliquerLecture(supabase, id, lue);
    if (resultat.ok) return { lecture: "lue" };
    if (resultat.depotAbandonne && resultat.avisExistantId) {
      return {
        lecture: "doublon",
        existant: { id: resultat.avisExistantId, numero: normaliserNumeroAvis(lue.saisie.numero ?? "") ?? "" },
      };
    }
    throw new Error(`lecture non enregistrée : ${Object.keys(resultat.erreurs).join(", ")}`);
  } catch (erreur) {
    console.error("avis", "lecture", erreur instanceof Error ? erreur.message : erreur);
    await supabase.from("avis").update({ lecture_ia: "echec" }).eq("id", id);
    return { lecture: "echec" };
  }
}
