import { ramenerImpayesEnFree } from "@/lib/abonnement/impayes";
import { clientStripeConfigure } from "@/lib/abonnement/stripe";
import { cronAutorise } from "@/lib/cron";
import { createAdminClient } from "@/lib/supabase/admin";

// Les impayés (phase 19) : appelée chaque nuit par Vercel (`vercel.json`), ou à la main avec le secret. Le lendemain de
// sa date limite, un abonnement toujours impayé est annulé chez Stripe, et sa facture ouverte annulée ; le webhook
// repasse ensuite le compte en Free. Relancer le même jour ne fait rien de plus. Un échec renvoie 500, avec le bilan,
// pour qu'il se voie dans les logs de Vercel.
export async function GET(request: Request) {
  if (!cronAutorise(request)) return Response.json({ erreur: "Non autorisé" }, { status: 401 });
  const stripe = clientStripeConfigure();
  if (!stripe) return Response.json({ erreur: "Stripe non configuré" }, { status: 503 });

  try {
    const bilan = await ramenerImpayesEnFree({ supabase: createAdminClient(), stripe });
    return Response.json(bilan, { status: bilan.echecs ? 500 : 200 });
  } catch (erreur) {
    console.error("impayés", erreur instanceof Error ? erreur.message : erreur);
    return Response.json({ erreur: "Impayés interrompus" }, { status: 500 });
  }
}
