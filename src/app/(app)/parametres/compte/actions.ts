"use server";

import { redirect } from "next/navigation";
import type { EtatAction } from "@/components/Confirmation";
import { clientStripeConfigure } from "@/lib/abonnement/stripe";
import { clientAgendaConfigure } from "@/lib/agenda/composio";
import { MESSAGES_COMPTE } from "@/lib/compte/regles";
import { supprimerCompte } from "@/lib/compte/suppression";
import { clientComposioConfigure } from "@/lib/gmail/composio";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * « Supprimer définitivement » : le compte et toutes les données de l'entreprise sont effacés, puis cet appareil est
 * déconnecté. Les cookies de session partent même si l'utilisateur n'existe plus. Une panne se lit dans les logs ; le
 * gestionnaire voit seulement qu'il peut réessayer. `redirect` est hors du `try` : il lève une exception que Next
 * intercepte.
 */
export async function supprimerMonCompte(_etat: EtatAction, formData: FormData): Promise<EtatAction> {
  const saisie = formData.get("confirmation");
  const supabase = await createClient();
  try {
    const resultat = await supprimerCompte({
      supabase,
      admin: createAdminClient(),
      stripe: clientStripeConfigure(),
      composio: clientComposioConfigure(),
      agenda: clientAgendaConfigure(),
      saisie: typeof saisie === "string" ? saisie : "",
    });
    if (!resultat.ok) return { erreur: resultat.erreur };
  } catch (erreur) {
    console.error("suppression de compte", erreur instanceof Error ? erreur.message : erreur);
    return { erreur: MESSAGES_COMPTE.indisponible };
  }
  await supabase.auth.signOut({ scope: "local" });
  redirect("/connexion?compte=supprime");
}
