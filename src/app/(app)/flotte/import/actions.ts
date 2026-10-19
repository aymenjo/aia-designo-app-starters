"use server";

import { refresh } from "next/cache";
import { analyserFlotte, importerFlotte, type FichierRecu } from "@/lib/flotte/import";
import { AUCUN, verifierDepotImport, type AnalyseImport, type RapportImport } from "@/lib/flotte/regles-import";
import { createClient } from "@/lib/supabase/server";

/** Les fichiers déposés, contrôlés à nouveau ici : l'écran les a déjà contrôlés, mais rien n'oblige à passer par lui. */
async function lireDepot(formData: FormData): Promise<{ ok: true; fichiers: FichierRecu[] } | { ok: false; erreur: string }> {
  const fichiers = formData.getAll("fichiers").filter((valeur): valeur is File => valeur instanceof File);
  const controle = verifierDepotImport(fichiers);
  if (!controle.ok) return controle;
  return {
    ok: true,
    fichiers: await Promise.all(
      fichiers.map(async (fichier) => ({ nom: fichier.name, octets: new Uint8Array(await fichier.arrayBuffer()) })),
    ),
  };
}

/** L'aperçu de l'import : rien n'est écrit. */
export async function analyserFichiers(formData: FormData): Promise<AnalyseImport> {
  const depot = await lireDepot(formData);
  if (!depot.ok) return { erreur: depot.erreur, fichiers: [], aImporter: AUCUN };
  const { analyse } = await analyserFlotte(await createClient(), depot.fichiers);
  return analyse;
}

/** L'import des lignes valides : l'analyse est refaite sur les fichiers prévisualisés, puis chaque ligne est écrite. */
export async function importerFichiers(formData: FormData): Promise<RapportImport> {
  const depot = await lireDepot(formData);
  if (!depot.ok) return { erreur: depot.erreur, fichiers: [], aImporter: AUCUN, importes: AUCUN };
  const rapport = await importerFlotte(await createClient(), depot.fichiers);
  refresh();
  return rapport;
}
