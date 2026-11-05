import type { Plan } from "@/lib/abonnement/plans";
import { BUCKET_RAPPORTS, MESSAGES_RAPPORT, moisDepuisSegment, nomFichierRapport } from "@/lib/rapport/liste";
import { createClient } from "@/lib/supabase/server";

const texte = (message: string, status: number) =>
  new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

/**
 * Le PDF d'un mois, tel qu'il est parti (Pro). Le plan est relu à chaque requête : le retour en Free arrête le
 * téléchargement. La RLS limite la ligne et le fichier au dossier de l'entreprise.
 */
export async function GET(_requete: Request, { params }: RouteContext<"/rapports/[mois]">) {
  const mois = moisDepuisSegment((await params).mois);
  if (!mois) return texte(MESSAGES_RAPPORT.introuvable, 404);

  const supabase = await createClient();
  const entreprise = await supabase.from("entreprise").select("plan").single<{ plan: Plan }>();
  if (entreprise.error) throw entreprise.error;
  if (entreprise.data.plan !== "pro") return texte(MESSAGES_RAPPORT.fonctionPro, 403);

  const rapport = await supabase
    .from("rapport_mensuel")
    .select("fichier")
    .eq("mois", mois)
    .maybeSingle<{ fichier: string }>();
  if (rapport.error) throw rapport.error;
  if (!rapport.data) return texte(MESSAGES_RAPPORT.introuvable, 404);

  const { data, error } = await supabase.storage.from(BUCKET_RAPPORTS).download(rapport.data.fichier);
  if (error) throw error;
  return new Response(data, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${nomFichierRapport(mois)}"`,
      "Cache-Control": "no-store",
    },
  });
}
