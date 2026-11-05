import { cronAutorise } from "@/lib/cron";
import { envoyeurConfigure } from "@/lib/email/envoi";
import { produireRapports } from "@/lib/rapport/rapports";
import { createAdminClient } from "@/lib/supabase/admin";

// Une entreprise après l'autre : un PDF à générer et un email à envoyer chacune.
export const maxDuration = 300;

// Le rapport mensuel (phase 25) : appelée chaque matin par Vercel (`vercel.json`), ou à la main avec le secret. Elle
// produit le rapport du mois écoulé qui manque, et retente un envoi échoué. Un échec renvoie 500, pour qu'il se voie dans
// les logs de Vercel ; relancer n'envoie aucun doublon.
export async function GET(request: Request) {
  if (!cronAutorise(request)) return Response.json({ erreur: "Non autorisé" }, { status: 401 });

  const envoyeur = envoyeurConfigure();
  if (!envoyeur) return Response.json({ erreur: "Aucun envoi d'email configuré" }, { status: 503 });

  const bilan = await produireRapports({ admin: createAdminClient(), envoyeur });
  return Response.json(bilan, { status: bilan.echecs ? 500 : 200 });
}
