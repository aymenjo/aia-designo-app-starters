import { envoyerAlertes } from "@/lib/avis/alertes";
import { cronAutorise, urlSite } from "@/lib/cron";
import { envoyeurConfigure } from "@/lib/email/envoi";
import { createAdminClient } from "@/lib/supabase/admin";

// Alertes J-15, J-7, J-2 (phase 14) : appelée chaque matin par Vercel (`vercel.json`), ou à la main avec le secret.
// Un échec renvoie 500, pour qu'il se voie dans les logs de Vercel ; relancer le même jour n'envoie aucun doublon.
export async function GET(request: Request) {
  if (!cronAutorise(request)) return Response.json({ erreur: "Non autorisé" }, { status: 401 });

  const envoyeur = envoyeurConfigure();
  if (!envoyeur) return Response.json({ erreur: "Aucun envoi d'email configuré" }, { status: 503 });

  const bilan = await envoyerAlertes({ supabase: createAdminClient(), envoyeur, urlSite: urlSite(request) });
  return Response.json(bilan, { status: bilan.echecs ? 500 : 200 });
}
