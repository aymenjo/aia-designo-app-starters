import { after } from "next/server";
import { clientAgendaConfigure } from "@/lib/agenda/composio";
import { synchroniserAgenda } from "@/lib/agenda/synchro";
import { lireEtRemplirAvis } from "@/lib/avis/lecture";
import { lecteurConfigure } from "@/lib/avis/lecteur-claude";
import { envoyeurConfigure } from "@/lib/email/envoi";
import { clientComposioConfigure } from "@/lib/gmail/composio";
import { traiterWebhookComposio } from "@/lib/gmail/webhook";
import { urlSite } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/admin";

// La lecture IA des avis relevés a lieu après la réponse, une minute au plus chacune (une relance comprise).
export const maxDuration = 300;

// Le webhook de Composio (phase 23) : un email arrivé dans le libellé, ou un compte Gmail ou agenda expiré. Sans
// session : la signature de Composio, vérifiée sur le corps brut, l'authentifie. Composio relance tout ce qui ne répond
// pas 2xx.
export async function POST(request: Request) {
  const secret = process.env.COMPOSIO_WEBHOOK_SECRET;
  if (!secret) return Response.json({ erreur: "Webhook Composio non configuré" }, { status: 503 });

  const admin = createAdminClient();
  const urlDuSite = urlSite(request);
  const { statut, message, aLire, entrepriseId } = await traiterWebhookComposio({
    corps: await request.text(),
    entetes: request.headers,
    secret,
    supabase: admin,
    composio: clientComposioConfigure(),
    envoyeur: envoyeurConfigure(),
    urlSite: urlDuSite,
  });

  // Un avis à la fois : l'email est déjà relevé, et un avis resté sans lecture se lit à son ouverture. Les dates d'envoi
  // lues donnent les échéances : l'agenda « Désigno » de l'entreprise reçoit ensuite leurs rappels.
  const lecteur = lecteurConfigure();
  const agenda = clientAgendaConfigure();
  if (aLire.length && lecteur) {
    after(async () => {
      for (const id of aLire) await lireEtRemplirAvis(admin, id, lecteur);
      if (agenda && entrepriseId) {
        await synchroniserAgenda({ admin, agenda, entrepriseId, urlSite: urlDuSite }).catch((erreur: unknown) =>
          console.error("agenda", entrepriseId, erreur instanceof Error ? erreur.message : erreur),
        );
      }
    });
  }
  return Response.json(statut < 300 ? { message } : { erreur: message }, { status: statut });
}
