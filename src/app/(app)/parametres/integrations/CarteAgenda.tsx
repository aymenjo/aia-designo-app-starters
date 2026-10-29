import { CalendarClock } from "lucide-react";
import type { ReactNode } from "react";
import { CadenasPro } from "@/components/CadenasPro";
import { Confirmation } from "@/components/Confirmation";
import { Alerte } from "@/components/ui/Alerte";
import { FONCTIONS_PRO, type Plan } from "@/lib/abonnement/plans";
import type { ConnexionAgenda } from "@/lib/agenda/connexion";
import { MESSAGES_AGENDA, NOM_AGENDA } from "@/lib/agenda/regles";
import { formaterDateAHeure } from "@/lib/format";
import { BoutonStripe } from "../abonnement/BoutonStripe";
import { connecterAgenda, deconnecterAgenda } from "./actions";

type Props = {
  plan: Plan;
  connexion: ConnexionAgenda | null;
  /** Composio est configuré : sans lui, rien ne se connecte. */
  disponible: boolean;
};

const EXPLICATION = FONCTIONS_PRO.find(({ nom }) => nom === "Rappels Google Calendar")!.explication;

function Ligne({ libelle, children }: { libelle: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-3">
      <dt className="text-secondary">{libelle}</dt>
      <dd className="min-w-0 font-medium break-words">{children}</dd>
    </div>
  );
}

/**
 * Les rappels Google Calendar, dans l'écran Intégrations : la connexion, l'agenda « Désigno », et ses états (à
 * connecter, actifs, interrompus, en pause en Free). Une interruption n'a ni bandeau ni email : cette carte la montre.
 */
export function CarteAgenda({ plan, connexion, disponible }: Props) {
  const deconnexion = connexion && (
    <Confirmation
      libelle="Déconnecter Google Calendar"
      titre="Déconnecter Google Calendar ?"
      explication={MESSAGES_AGENDA.deconnexion}
      confirmer="Déconnecter"
      enCours="Déconnexion…"
      action={deconnecterAgenda}
    />
  );
  const connecter = (libelle: string) => (
    <BoutonStripe
      action={connecterAgenda}
      enCours="Ouverture de Google…"
      precision="Sur la page sécurisée de Google : choisissez le compte où créer l'agenda."
    >
      {libelle}
    </BoutonStripe>
  );

  const contenu = () => {
    // Retour en Free : la connexion reste, rien n'est ajouté ni déplacé.
    if (plan !== "pro") {
      return (
        <>
          <CadenasPro fonction={connexion ? "Rappels en pause" : "Rappels Google Calendar"}>
            <p>{connexion ? MESSAGES_AGENDA.pause : EXPLICATION}</p>
          </CadenasPro>
          {deconnexion && <div>{deconnexion}</div>}
        </>
      );
    }
    if (!connexion) {
      return (
        <>
          <ul className="grid list-disc gap-1 pl-5 text-secondary">
            <li>{MESSAGES_AGENDA.agendaCree}</li>
            <li>{MESSAGES_AGENDA.rappel}</li>
            <li>{MESSAGES_AGENDA.aucunAutre}</li>
          </ul>
          {disponible ? (
            connecter("Connecter Google Calendar")
          ) : (
            <Alerte variante="erreur">{MESSAGES_AGENDA.indisponible}</Alerte>
          )}
        </>
      );
    }

    return (
      <>
        <dl className="-my-3 divide-y divide-line">
          <Ligne libelle="Compte Google">{connexion.email_compte ?? "—"}</Ligne>
          <Ligne libelle="Agenda">« {NOM_AGENDA} »</Ligne>
          {connexion.interrompue_le ? (
            <Ligne libelle="Rappels interrompus depuis le">
              <span className="text-urgent">{formaterDateAHeure(connexion.interrompue_le)}</span>
            </Ligne>
          ) : (
            <Ligne libelle="Rappels actifs depuis le">{formaterDateAHeure(connexion.active_depuis)}</Ligne>
          )}
        </dl>
        {connexion.interrompue_le ? (
          <>
            <Alerte variante="erreur">{MESSAGES_AGENDA.interrompus}</Alerte>
            {/* Comme le bandeau de Gmail : sans Composio, le clic dit que les rappels sont indisponibles. */}
            {connecter("Reconnecter Google Calendar")}
          </>
        ) : (
          <p className="text-label text-secondary">
            {MESSAGES_AGENDA.rappel} {MESSAGES_AGENDA.aucunAutre}
          </p>
        )}
        <div>{deconnexion}</div>
      </>
    );
  };

  return (
    <section aria-labelledby="rappels-agenda" className="grid gap-5 rounded-card border border-line p-6 max-md:p-5">
      <div className="flex items-start gap-3">
        <CalendarClock size={16} strokeWidth={1.5} aria-hidden className="mt-1 flex-none text-secondary" />
        <div className="grid gap-1">
          <h2 id="rappels-agenda" className="font-semibold">
            Rappels Google Calendar
          </h2>
          <p className="text-label text-secondary">
            Retrouvez vos échéances de désignation là où vous planifiez votre semaine.
          </p>
        </div>
      </div>
      {contenu()}
    </section>
  );
}
