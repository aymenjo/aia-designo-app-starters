import { NextResponse, type NextRequest } from "next/server";
import { clientAgendaConfigure } from "@/lib/agenda/composio";
import { enregistrerRetour } from "@/lib/agenda/connexion";
import { programmerSynchroAgenda } from "@/lib/agenda/programmer";
import { MESSAGES_AGENDA, type CleMessageAgenda } from "@/lib/agenda/regles";
import { urlSite } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Le retour de Google, par Composio, après « Connecter Google Calendar » (phase 22) : `status` et
// `connected_account_id` sont ajoutés à l'adresse de retour. Le compte est vérifié puis enregistré, l'agenda « Désigno »
// créé, et ses événements posés après la réponse. Sous la session du gestionnaire : le proxy mène à la connexion sans
// elle.

export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const parametres = request.nextUrl.searchParams;
  const vers = (suite: string) =>
    NextResponse.redirect(new URL(`/parametres/integrations?${suite}`, urlSite(request)), 303);
  const erreur = (cle: CleMessageAgenda) => vers(`erreur_agenda=${cle}`);

  const compteId = parametres.get("connected_account_id");
  if (parametres.get("status") !== "success" || !compteId) return erreur("connexionRefusee");

  try {
    const resultat = await enregistrerRetour({
      supabase: await createClient(),
      admin: createAdminClient(),
      agenda: clientAgendaConfigure(),
      compteId,
    });
    if (resultat.ok) {
      await programmerSynchroAgenda(resultat.entrepriseId);
      return vers(resultat.reconnecte ? "agenda=reconnecte" : "agenda=connecte");
    }
    const cle = (Object.keys(MESSAGES_AGENDA) as CleMessageAgenda[]).find((k) => MESSAGES_AGENDA[k] === resultat.erreur);
    return erreur(cle ?? "indisponible");
  } catch (e) {
    console.error("agenda", "retour", e instanceof Error ? e.message : e);
    return erreur("indisponible");
  }
}
