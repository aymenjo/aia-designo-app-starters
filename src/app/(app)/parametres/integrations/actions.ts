"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { EtatAction } from "@/components/Confirmation";
import { clientAgendaConfigure } from "@/lib/agenda/composio";
import * as connexionAgenda from "@/lib/agenda/connexion";
import { MESSAGES_AGENDA } from "@/lib/agenda/regles";
import { clientComposioConfigure } from "@/lib/gmail/composio";
import { choisirLibelle, deconnecterGmail, demarrerConnexion } from "@/lib/gmail/connexion";
import { MESSAGES_GMAIL } from "@/lib/gmail/regles";
import { urlSiteDepuisEntetes } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/** Une panne de Composio se lit dans les logs ; le gestionnaire voit seulement que la relève est indisponible. */
function indisponible(erreur: unknown): EtatAction {
  console.error("gmail", erreur instanceof Error ? erreur.message : erreur);
  return { erreur: MESSAGES_GMAIL.indisponible };
}

/**
 * « Connecter Gmail » et « Reconnecter Gmail » : la page de Google, par Composio. Le retour arrive sur
 * /parametres/integrations/retour. `redirect` est hors du `try` : il lève une exception que Next intercepte.
 */
export async function connecterGmail(): Promise<EtatAction> {
  const urlSite = urlSiteDepuisEntetes(await headers());
  let url: string;
  try {
    const resultat = await demarrerConnexion({
      supabase: await createClient(),
      composio: clientComposioConfigure(),
      urlSite,
    });
    if (!resultat.ok) return { erreur: resultat.erreur };
    url = resultat.url;
  } catch (erreur) {
    return indisponible(erreur);
  }
  redirect(url);
}

/** « Choisir ce libellé » et « Changer de libellé » : la relève reprend sur ce libellé, pour les nouveaux emails. */
export async function choisirLibelleGmail(_etat: EtatAction, formData: FormData): Promise<EtatAction> {
  const libelle = formData.get("libelle");
  try {
    const resultat = await choisirLibelle({
      supabase: await createClient(),
      admin: createAdminClient(),
      composio: clientComposioConfigure(),
      libelleId: typeof libelle === "string" ? libelle : "",
    });
    if (!resultat.ok) return { erreur: resultat.erreur };
  } catch (erreur) {
    return indisponible(erreur);
  }
  refresh();
  return {};
}

/** « Déconnecter Gmail » : l'accès est révoqué chez Composio, puis la connexion effacée ; les avis relevés restent. */
export async function deconnecter(): Promise<EtatAction> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.from("entreprise").select("id").single<{ id: string }>();
    if (error) throw error;
    await deconnecterGmail({ admin: createAdminClient(), composio: clientComposioConfigure(), entrepriseId: data.id });
  } catch (erreur) {
    return indisponible(erreur);
  }
  refresh();
  return {};
}

/** Une panne de Composio ou de Google se lit dans les logs ; le gestionnaire voit seulement que l'agenda est indisponible. */
function agendaIndisponible(erreur: unknown): EtatAction {
  console.error("agenda", erreur instanceof Error ? erreur.message : erreur);
  return { erreur: MESSAGES_AGENDA.indisponible };
}

/**
 * « Connecter Google Calendar » et « Reconnecter Google Calendar » : la page de Google, par Composio. Le retour arrive
 * sur /parametres/integrations/retour/agenda.
 */
export async function connecterAgenda(): Promise<EtatAction> {
  const urlSite = urlSiteDepuisEntetes(await headers());
  let url: string;
  try {
    const resultat = await connexionAgenda.demarrerConnexion({
      supabase: await createClient(),
      agenda: clientAgendaConfigure(),
      urlSite,
    });
    if (!resultat.ok) return { erreur: resultat.erreur };
    url = resultat.url;
  } catch (erreur) {
    return agendaIndisponible(erreur);
  }
  redirect(url);
}

/** « Déconnecter Google Calendar » : l'agenda « Désigno » est supprimé chez Google, puis l'accès révoqué. */
export async function deconnecterAgenda(): Promise<EtatAction> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.from("entreprise").select("id").single<{ id: string }>();
    if (error) throw error;
    await connexionAgenda.deconnecterAgenda({
      admin: createAdminClient(),
      agenda: clientAgendaConfigure(),
      entrepriseId: data.id,
    });
  } catch (erreur) {
    return agendaIndisponible(erreur);
  }
  refresh();
  return {};
}
