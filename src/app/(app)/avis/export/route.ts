import type { Plan } from "@/lib/abonnement/plans";
import { MESSAGES_EXPORT, lignesExport, listerAvisPourExport, nomFichierExport } from "@/lib/avis/export";
import { ecrireCsv } from "@/lib/csv";
import { aujourdhuiParis } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

/**
 * L'historique complet des avis en CSV (Pro), quel que soit le filtre de la liste. Le plan est relu à chaque requête :
 * le retour en Free arrête l'export. La RLS limite la lecture aux avis de l'entreprise.
 */
export async function GET() {
  const supabase = await createClient();
  const entreprise = await supabase.from("entreprise").select("plan").single<{ plan: Plan }>();
  if (entreprise.error) throw entreprise.error;
  if (entreprise.data.plan !== "pro") {
    return new Response(MESSAGES_EXPORT.fonctionPro, {
      status: 403,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  return new Response(ecrireCsv(lignesExport(await listerAvisPourExport(supabase))), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nomFichierExport(aujourdhuiParis())}"`,
      "Cache-Control": "no-store",
    },
  });
}
