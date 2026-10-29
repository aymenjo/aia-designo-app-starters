import type { Metadata } from "next";
import { Alerte } from "@/components/ui/Alerte";
import type { Plan } from "@/lib/abonnement/plans";
import { clientAgendaConfigure } from "@/lib/agenda/composio";
import { lireConnexionAgenda } from "@/lib/agenda/connexion";
import { MESSAGES_AGENDA, estCleMessageAgenda } from "@/lib/agenda/regles";
import { clientComposioConfigure, type LibelleGmail } from "@/lib/gmail/composio";
import { libellesDeLaBoite, lireConnexionGmail } from "@/lib/gmail/connexion";
import { MESSAGES_GMAIL, estCleMessageGmail } from "@/lib/gmail/regles";
import { createClient } from "@/lib/supabase/server";
import { CarteAgenda } from "./CarteAgenda";
import { CarteGmail } from "./CarteGmail";

export const metadata: Metadata = { title: "Intégrations" };

export default async function Integrations(props: PageProps<"/parametres/integrations">) {
  const { gmail, erreur, agenda, erreur_agenda: erreurAgenda } = await props.searchParams;
  const supabase = await createClient();
  const [entreprise, connexion, connexionAgenda] = await Promise.all([
    supabase.from("entreprise").select("plan").single<{ plan: Plan }>(),
    lireConnexionGmail(supabase),
    lireConnexionAgenda(supabase),
  ]);
  if (entreprise.error) throw entreprise.error;
  if (connexion.error) throw connexion.error;
  if (connexionAgenda.error) throw connexionAgenda.error;
  const { plan } = entreprise.data;

  // Les libellés de la boîte, pour le choix : en Pro, sur une connexion qui n'est pas déjà interrompue. Une panne de
  // Composio tait seulement le choix.
  const composio = clientComposioConfigure();
  let libelles: LibelleGmail[] | null | undefined;
  if (composio && plan === "pro" && connexion.data && !connexion.data.interrompue_le) {
    libelles = await libellesDeLaBoite(composio, connexion.data.compte_id).catch((e: unknown) => {
      console.error("gmail", "libellés", e instanceof Error ? e.message : e);
      return undefined;
    });
  }
  const aChoisir = connexion.data && !connexion.data.libelle_id;

  return (
    <div className="grid max-w-[720px] gap-6">
      <header className="grid gap-1">
        <h1 className="font-display text-title font-bold">Intégrations</h1>
        <p className="text-secondary">Les services de Google que Désigno utilise pour vous, avec votre accord.</p>
      </header>

      {gmail === "reconnecte" && <Alerte variante="succes">{MESSAGES_GMAIL.reconnecte}</Alerte>}
      {gmail === "connecte" && (
        <Alerte variante="succes">
          {aChoisir ? "Gmail est connecté : choisissez maintenant le libellé à relever." : "Gmail est connecté."}
        </Alerte>
      )}
      {estCleMessageGmail(erreur) && <Alerte variante="erreur">{MESSAGES_GMAIL[erreur]}</Alerte>}
      {(agenda === "connecte" || agenda === "reconnecte") && (
        <Alerte variante="succes">{MESSAGES_AGENDA[agenda]}</Alerte>
      )}
      {estCleMessageAgenda(erreurAgenda) && <Alerte variante="erreur">{MESSAGES_AGENDA[erreurAgenda]}</Alerte>}

      <CarteGmail plan={plan} connexion={connexion.data} libelles={libelles} disponible={composio !== null} />
      <CarteAgenda plan={plan} connexion={connexionAgenda.data} disponible={clientAgendaConfigure() !== null} />
    </div>
  );
}
