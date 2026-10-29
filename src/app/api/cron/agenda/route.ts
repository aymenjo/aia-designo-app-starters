import { clientAgendaConfigure } from "@/lib/agenda/composio";
import { synchroniserTousLesAgendas } from "@/lib/agenda/synchro";
import { cronAutorise } from "@/lib/cron";
import { urlSite } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/admin";

// Une entreprise après l'autre, jusqu'à quelques appels à Google chacune.
export const maxDuration = 300;

// Les rappels Google Calendar (phase 22) : appelée chaque nuit par Vercel (`vercel.json`), ou à la main avec le secret.
// Elle rattrape ce que la synchronisation après chaque action n'a pas pu faire. Un échec renvoie 500, pour qu'il se voie
// dans les logs de Vercel ; relancer ne pose rien de plus que ce qui manque.
export async function GET(request: Request) {
  if (!cronAutorise(request)) return Response.json({ erreur: "Non autorisé" }, { status: 401 });

  const bilan = await synchroniserTousLesAgendas({
    admin: createAdminClient(),
    agenda: clientAgendaConfigure(),
    urlSite: urlSite(request),
  });
  return Response.json(bilan, { status: bilan.echecs ? 500 : 200 });
}
