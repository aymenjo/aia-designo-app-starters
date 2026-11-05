import { deverrouillerAvis } from "@/lib/abonnement/quotas";
import { cronAutorise } from "@/lib/cron";
import { createAdminClient } from "@/lib/supabase/admin";

// Déverrouillage des avis Free (phase 17) : appelé chaque nuit par Vercel (`vercel.json`), ou à la main avec le secret.
// Le 1er du mois, les avis verrouillés des mois passés entrent dans le quota du nouveau mois. Relancer ne change rien ;
// si la tâche saute, le premier dépôt de chaque entreprise la rattrape. Un échec renvoie 500, pour qu'il se voie dans
// les logs de Vercel.
export async function GET(request: Request) {
  if (!cronAutorise(request)) return Response.json({ erreur: "Non autorisé" }, { status: 401 });

  try {
    return Response.json({ avis: await deverrouillerAvis({ supabase: createAdminClient() }) });
  } catch (erreur) {
    console.error("déverrouillage", erreur instanceof Error ? erreur.message : erreur);
    return Response.json({ erreur: "Déverrouillage interrompu" }, { status: 500 });
  }
}
