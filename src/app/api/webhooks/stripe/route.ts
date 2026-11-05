import { after } from "next/server";
import { traiterWebhookStripe } from "@/lib/abonnement/webhook";
import { clientAgendaConfigure } from "@/lib/agenda/composio";
import { synchroniserAgenda } from "@/lib/agenda/synchro";
import { envoyeurConfigure } from "@/lib/email/envoi";
import { urlSite } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/admin";

// Le webhook Stripe (phase 18) : abonnement créé, modifié ou supprimé, et facture payée. Sans session : la signature de
// Stripe, vérifiée sur le corps brut, l'authentifie. Stripe relance tout ce qui ne répond pas 2xx.
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return Response.json({ erreur: "Webhook Stripe non configuré" }, { status: 503 });

  const admin = createAdminClient();
  const urlDuSite = urlSite(request);
  const { statut, message, applique } = await traiterWebhookStripe({
    corps: await request.text(),
    signature: request.headers.get("stripe-signature"),
    secret,
    supabase: admin,
    envoyeur: envoyeurConfigure(),
    urlSite: urlDuSite,
  });

  // Passé en Pro : l'agenda « Désigno » reçoit les rappels qui lui manquent (phase 22), après la réponse.
  const agenda = clientAgendaConfigure();
  if (applique?.plan === "pro" && agenda) {
    const { entrepriseId } = applique;
    after(() =>
      synchroniserAgenda({ admin, agenda, entrepriseId, urlSite: urlDuSite }).catch((erreur: unknown) =>
        console.error("agenda", entrepriseId, erreur instanceof Error ? erreur.message : erreur),
      ),
    );
  }
  return Response.json(statut < 300 ? { message } : { erreur: message }, { status: statut });
}
