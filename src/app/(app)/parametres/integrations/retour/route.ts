import { NextResponse, type NextRequest } from "next/server";
import { clientComposioConfigure } from "@/lib/gmail/composio";
import { enregistrerRetour } from "@/lib/gmail/connexion";
import { MESSAGES_GMAIL, type CleMessageGmail } from "@/lib/gmail/regles";
import { urlSite } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Le retour de Google, par Composio, après « Connecter Gmail » (phase 23) : `status` et `connected_account_id` sont
// ajoutés à l'adresse de retour. Le compte est vérifié puis enregistré, et l'écran Intégrations dit ce qui s'est passé.
// Sous la session du gestionnaire : le proxy mène à la connexion sans elle.

export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const parametres = request.nextUrl.searchParams;
  const vers = (suite: string) =>
    NextResponse.redirect(new URL(`/parametres/integrations?${suite}`, urlSite(request)), 303);
  const erreur = (cle: CleMessageGmail) => vers(`erreur=${cle}`);

  const compteId = parametres.get("connected_account_id");
  if (parametres.get("status") !== "success" || !compteId) return erreur("connexionRefusee");

  try {
    const resultat = await enregistrerRetour({
      supabase: await createClient(),
      admin: createAdminClient(),
      composio: clientComposioConfigure(),
      compteId,
    });
    if (resultat.ok) return vers(resultat.reconnecte ? "gmail=reconnecte" : "gmail=connecte");
    const cle = (Object.keys(MESSAGES_GMAIL) as CleMessageGmail[]).find((k) => MESSAGES_GMAIL[k] === resultat.erreur);
    return erreur(cle ?? "indisponible");
  } catch (e) {
    console.error("gmail", "retour", e instanceof Error ? e.message : e);
    return erreur("indisponible");
  }
}
