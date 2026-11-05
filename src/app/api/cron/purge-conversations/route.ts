import { clientAgentConfigure } from "@/lib/agent/client";
import { purgerConversations } from "@/lib/agent/conversations";
import { cronAutorise } from "@/lib/cron";
import { createAdminClient } from "@/lib/supabase/admin";

// Une session à la fois chez Anthropic, puis une suppression en base.
export const maxDuration = 300;

// La purge des conversations de Demande à Désigno (phase 26) : appelée chaque nuit par Vercel (`vercel.json`), ou à la
// main avec le secret. Les conversations de plus de 30 jours sont effacées, en base et chez Anthropic, avec les sessions
// des conversations terminées. Sans agent configuré, rien ne peut s'effacer chez Anthropic : 503. Un échec renvoie 500,
// pour qu'il se voie dans les logs de Vercel ; relancer n'efface que ce qui reste.
export async function GET(request: Request) {
  if (!cronAutorise(request)) return Response.json({ erreur: "Non autorisé" }, { status: 401 });

  const client = clientAgentConfigure();
  if (!client) return Response.json({ erreur: "Demande à Désigno n'est pas configurée" }, { status: 503 });

  const bilan = await purgerConversations({ admin: createAdminClient(), client });
  return Response.json(bilan, { status: bilan.echecs ? 500 : 200 });
}
