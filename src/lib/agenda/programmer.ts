import { headers } from "next/headers";
import { after } from "next/server";
import { urlSiteDepuisEntetes } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { clientAgendaConfigure } from "./composio";
import { synchroniserAgenda } from "./synchro";

// La synchronisation de l'agenda après une action du gestionnaire (phase 22) : programmée après la réponse, elle ne
// ralentit pas l'écran et ne le fait jamais échouer. Une panne se lit dans les logs, et la tâche de la nuit rattrape.
// À part de synchro.ts : ce module ne sert que dans une requête de Next (server action, route).

/**
 * Programme la synchronisation de l'agenda de l'entreprise, après la réponse. Sans `entrepriseId`, c'est celle du
 * gestionnaire, résolue sous sa session avant la réponse ; la synchronisation travaille ensuite avec la clé secrète.
 * Sans Composio configuré, rien n'est programmé.
 */
export async function programmerSynchroAgenda(entrepriseId?: string): Promise<void> {
  const agenda = clientAgendaConfigure();
  if (!agenda) return;
  try {
    const urlSite = urlSiteDepuisEntetes(await headers());
    let id = entrepriseId;
    if (!id) {
      const { data, error } = await (await createClient()).from("entreprise").select("id").single<{ id: string }>();
      if (error) throw new Error(`entreprise : ${error.code} ${error.message}`);
      id = data.id;
    }
    const cible = id;
    after(() =>
      synchroniserAgenda({ admin: createAdminClient(), agenda, entrepriseId: cible, urlSite }).catch((erreur: unknown) =>
        console.error("agenda", cible, erreur instanceof Error ? erreur.message : erreur),
      ),
    );
  } catch (erreur) {
    console.error("agenda", "programmation", erreur instanceof Error ? erreur.message : erreur);
  }
}
