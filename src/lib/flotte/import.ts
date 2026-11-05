import type { SupabaseClient } from "@supabase/supabase-js";
import { creerAffectation } from "./affectations";
import { creerConducteur } from "./conducteurs";
import type { ErreursAffectation } from "./regles";
import {
  MESSAGES_IMPORT,
  analyserImport,
  lireFichier,
  type ChampLigneVehicule,
  type Comptes,
  type ConducteurExistant,
  type Existants,
  type FicheArchivee,
  type LigneConducteur,
  type LigneVehicule,
  type Motifs,
  type RapportImport,
  type StatutLigne,
  type VehiculeExistant,
  motifsHorsLimite,
} from "./regles-import";
import { creerVehicule, rattacherAvis, supprimerVehicule } from "./vehicules";

// Import CSV de la flotte (phase 6), sous la session du gestionnaire (RLS). Les lignes s'écrivent une à une avec
// les écritures des écrans : mêmes règles, mêmes messages, et la même gestion des écritures concurrentes.

export type FichierRecu = { nom: string; octets: Uint8Array };

/** La flotte de l'entreprise, archivés compris, et son plan. `max_rows` (1 000) suffit largement à une flotte de PME. */
export async function lireExistants(supabase: SupabaseClient): Promise<Existants> {
  const [entreprise, vehicules, conducteurs] = await Promise.all([
    supabase.from("entreprise").select("plan").single<Pick<Existants, "plan">>(),
    supabase
      .from("vehicule")
      .select("id, plaque, archive_le, lecture_seule_le")
      .overrideTypes<VehiculeExistant[], { merge: false }>(),
    supabase
      .from("conducteur")
      .select("id, prenom, nom, permis_numero, email, archive_le")
      .overrideTypes<ConducteurExistant[], { merge: false }>(),
  ]);
  if (entreprise.error) throw entreprise.error;
  if (vehicules.error) throw vehicules.error;
  if (conducteurs.error) throw conducteurs.error;
  return { plan: entreprise.data.plan, vehicules: vehicules.data ?? [], conducteurs: conducteurs.data ?? [] };
}

/** L'aperçu : les fichiers lus et analysés face à la flotte en base. Rien n'est écrit. */
export async function analyserFlotte(supabase: SupabaseClient, fichiers: readonly FichierRecu[]) {
  const lus = fichiers.map(({ nom, octets }) => lireFichier(nom, octets));
  return analyserImport(lus, await lireExistants(supabase));
}

/** Les écritures, injectables pour éprouver la compensation. */
export const ECRITURES = { creerConducteur, creerVehicule, creerAffectation, supprimerVehicule, rattacherAvis };

/**
 * Un refus d'écriture sur la clé (plaque, permis, email) ne peut venir, après l'analyse, que d'une écriture
 * concurrente : la ligne est alors ignorée, comme à l'aperçu. Tout autre refus la met en erreur.
 */
function refuser<Champ extends string>(
  ligne: { statut: StatutLigne; motifs: Motifs<Champ>; ficheArchivee?: FicheArchivee },
  erreurs: Motifs<Champ>,
  cles: readonly Champ[],
  ficheArchivee?: FicheArchivee,
) {
  ligne.statut = cles.some((champ) => erreurs[champ]) ? "ignoree" : "en_erreur";
  ligne.motifs = erreurs;
  if (ficheArchivee) ligne.ficheArchivee = ficheArchivee;
}

/** Les erreurs d'une affectation, sur les colonnes du fichier véhicules. */
function motifsAffectation(erreurs: ErreursAffectation): Motifs<ChampLigneVehicule> {
  const motifs: Motifs<ChampLigneVehicule> = {};
  for (const [champ, message] of Object.entries(erreurs)) {
    const colonne = champ.startsWith("debut_") ? "attitre_depuis" : "attitre";
    motifs[colonne] ??= message;
  }
  return motifs;
}

/**
 * Refait l'analyse, puis écrit les lignes à importer : les conducteurs d'abord, puis chaque véhicule et
 * l'affectation de son attitré. Une ligne s'importe en entier ou pas du tout : si l'affectation échoue, le véhicule
 * qui vient d'être créé, sans historique, est aussitôt supprimé. Les avis qui portent sa plaque ne le rejoignent
 * qu'une fois la ligne écrite : rattachés plus tôt, ils empêcheraient cette suppression. Un import interrompu se
 * reprend en réimportant les mêmes fichiers : les lignes déjà écrites sont alors ignorées.
 */
export async function importerFlotte(
  supabase: SupabaseClient,
  fichiers: readonly FichierRecu[],
  ecritures = ECRITURES,
): Promise<RapportImport> {
  const { analyse, aEcrire } = await analyserFlotte(supabase, fichiers);
  const importes: Comptes = { vehicules: 0, conducteurs: 0, affectations: 0 };

  const lignesConducteurs = new Map<number, LigneConducteur>();
  const lignesVehicules = new Map<number, LigneVehicule>();
  for (const fichier of analyse.fichiers) {
    if (fichier.type === "conducteurs") for (const ligne of fichier.lignes) lignesConducteurs.set(ligne.ligne, ligne);
    if (fichier.type === "vehicules") for (const ligne of fichier.lignes) lignesVehicules.set(ligne.ligne, ligne);
  }

  try {
    const crees = new Map<number, string>();
    for (const { ligne, saisie } of aEcrire.conducteurs) {
      const analysee = lignesConducteurs.get(ligne)!;
      const resultat = await ecritures.creerConducteur(supabase, saisie);
      if (!resultat.ok) {
        const archive = resultat.conducteurArchiveId;
        refuser(analysee, resultat.erreurs, ["permis_numero", "email"], archive ? { type: "conducteur", id: archive } : undefined);
        continue;
      }
      crees.set(ligne, resultat.conducteur.id);
      analysee.statut = "importee";
      importes.conducteurs++;
    }

    for (const { ligne, saisie, attitre } of aEcrire.vehicules) {
      const analysee = lignesVehicules.get(ligne)!;
      const reference = attitre?.conducteur;
      const conducteurId = reference && ("id" in reference ? reference.id : crees.get(reference.ligne));
      if (reference && !conducteurId && "ligne" in reference) {
        // Son attitré, du même import, n'a pas pu être créé : le véhicule attend qu'il le soit.
        refuser(analysee, { attitre: MESSAGES_IMPORT.attitreEnErreur(reference.ligne) }, []);
        continue;
      }

      const vehicule = await ecritures.creerVehicule(supabase, saisie, { rattacher: false });
      if (!vehicule.ok && vehicule.invitationPro) {
        // Un véhicule ajouté en même temps, depuis un autre écran : la limite Free est atteinte avant cette ligne.
        analysee.statut = "hors_limite";
        analysee.motifs = motifsHorsLimite(attitre);
        continue;
      }
      if (!vehicule.ok) {
        const archive = vehicule.vehiculeArchiveId;
        refuser(analysee, vehicule.erreurs, ["plaque"], archive ? { type: "vehicule", id: archive } : undefined);
        continue;
      }

      if (attitre && conducteurId) {
        const affectation = await ecritures.creerAffectation(supabase, {
          vehicule_id: vehicule.vehicule.id,
          conducteur_id: conducteurId,
          debut_date: attitre.debut_date,
        });
        if (!affectation.ok) {
          const suppression = await ecritures.supprimerVehicule(supabase, vehicule.vehicule.id);
          if (!suppression.ok) console.error("import : véhicule sans son attitré", ligne, suppression.erreurs);
          refuser(analysee, motifsAffectation(affectation.erreurs), []);
          continue;
        }
        importes.affectations++;
      }
      analysee.statut = "importee";
      importes.vehicules++;
      const rattachement = await ecritures.rattacherAvis(supabase, vehicule.vehicule);
      if (rattachement) console.error("import : avis non rattachés", ligne, rattachement.message);
    }
  } catch (erreur) {
    // Une coupure en route : ce qui est écrit le reste, le rapport dit où reprendre.
    console.error("import interrompu", erreur);
    for (const analysee of [...lignesConducteurs.values(), ...lignesVehicules.values()]) {
      if (analysee.statut === "a_importer") refuser(analysee, { general: MESSAGES_IMPORT.interrompu }, []);
    }
  }

  return { ...analyse, importes };
}
