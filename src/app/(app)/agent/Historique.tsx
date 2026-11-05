"use client";

import { ArrowLeft } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Alerte } from "@/components/ui/Alerte";
import { Bouton } from "@/components/ui/Bouton";
import type { ConversationListee } from "@/lib/agent/conversations";
import { CONSERVATION_JOURS, MESSAGES_AGENT } from "@/lib/agent/regles";
import { formaterDateAHeure } from "@/lib/format";
import { lireConversationPasseeAction, listerConversationsAction } from "./actions";
import { FilMessages } from "./FilMessages";

// L'historique de Demande à Désigno (phase 32, DESIGN.md) : une vue qui remplace le fil dans le panneau. La liste des
// conversations des 30 derniers jours, la conversation en cours en tête, puis une conversation terminée, rouverte en
// lecture seule : ses messages et ses récapitulatifs, sans saisie ni bouton. La pilule « Sur : … » n'y paraît pas.

const RETOUR_EN_COURS = "Revenir à la conversation en cours";

/** Un bouton icône du panneau : l'en-tête, et « ← » de la liste. */
export const BOUTON_ICONE =
  "grid size-8 flex-none cursor-pointer place-items-center rounded-full text-secondary transition-colors duration-120 ease-enter hover:bg-[rgb(0_0_0/0.05)] hover:text-ink disabled:cursor-not-allowed disabled:text-disabled disabled:hover:bg-transparent";

/** La barre sous l'en-tête : le retour à gauche, et ce que la vue montre. */
function Barre({ children }: { children: ReactNode }) {
  return <div className="flex h-12 flex-none items-center justify-between gap-3 border-b border-line pr-5 pl-3">{children}</div>;
}

/** La liste : une ligne par conversation, la date, la première demande sur 2 lignes, et les récapitulatifs appliqués. */
export function ListeConversations({
  retour,
  ouvrir,
}: {
  /** ← : le fil de la conversation en cours. */
  retour: () => void;
  ouvrir: (conversation: ConversationListee) => void;
}) {
  // `undefined` pendant le chargement, `null` en panne.
  const [conversations, setConversations] = useState<ConversationListee[] | null | undefined>(undefined);

  useEffect(() => {
    let actuel = true;
    void listerConversationsAction().then((lues) => {
      if (actuel) setConversations(lues);
    });
    return () => {
      actuel = false;
    };
  }, []);

  return (
    <>
      <Barre>
        <div className="flex min-w-0 items-center gap-1">
          <button
            type="button"
            aria-label={RETOUR_EN_COURS}
            title={RETOUR_EN_COURS}
            onClick={retour}
            className={BOUTON_ICONE}
          >
            <ArrowLeft size={16} strokeWidth={1.5} aria-hidden />
          </button>
          <h3 className="truncate text-label font-semibold">
            Conversations <span className="font-normal text-secondary">· {CONSERVATION_JOURS} jours</span>
          </h3>
        </div>
      </Barre>
      <div className="flex-1 overflow-y-auto">
        {conversations === null && (
          <div className="p-5">
            <Alerte variante="erreur">{MESSAGES_AGENT.indisponible}</Alerte>
          </div>
        )}
        {conversations?.length === 0 && <p className="p-5 text-secondary">{MESSAGES_AGENT.historiqueVide}</p>}
        {conversations && conversations.length > 0 && (
          <ul aria-label={MESSAGES_AGENT.historique}>
            {conversations.map((conversation) => (
              <li key={conversation.id} className="border-b border-line">
                <button
                  type="button"
                  onClick={() => ouvrir(conversation)}
                  className="grid w-full cursor-pointer gap-1 px-5 py-3 text-left transition-colors duration-120 ease-enter hover:bg-surface"
                >
                  <span className="flex items-center gap-2 text-caption text-secondary">
                    {conversation.enCours && (
                      <span className="inline-flex h-5 items-center rounded-full border border-line bg-surface px-2 text-ink">
                        En cours
                      </span>
                    )}
                    {formaterDateAHeure(conversation.debut)}
                  </span>
                  <span className="line-clamp-2 break-words">{conversation.premiereDemande}</span>
                  {conversation.appliques > 0 && (
                    <span className="text-caption text-secondary">{MESSAGES_AGENT.appliques(conversation.appliques)}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

type Lecture = Awaited<ReturnType<typeof lireConversationPasseeAction>>;

/** Une conversation terminée, en lecture seule : ses messages et ses récapitulatifs, puis l'alerte à la place de la saisie. */
export function ConversationPassee({
  id,
  debut,
  retour,
  revenir,
}: {
  id: string;
  debut: string;
  /** ← Conversations : la liste. */
  retour: () => void;
  /** Le fil de la conversation en cours, avec sa saisie. */
  revenir: () => void;
}) {
  const [lue, setLue] = useState<{ id: string; lecture: Lecture } | null>(null);

  useEffect(() => {
    let actuel = true;
    void lireConversationPasseeAction(id).then((lecture) => {
      if (actuel) setLue({ id, lecture });
    });
    return () => {
      actuel = false;
    };
  }, [id]);

  const lecture = lue?.id === id ? lue.lecture : null;
  const boutonRevenir = (
    <Bouton variante="secondaire" taille="sm" onClick={revenir} className="justify-self-start">
      {RETOUR_EN_COURS}
    </Bouton>
  );

  return (
    <>
      <Barre>
        <Bouton variante="ghost" taille="sm" onClick={retour} className="px-2">
          <ArrowLeft size={16} strokeWidth={1.5} aria-hidden />
          Conversations
        </Bouton>
        <span className="text-caption text-secondary">{formaterDateAHeure(debut)}</span>
      </Barre>
      <div className="grid flex-1 content-start gap-4 overflow-y-auto p-5">
        {lecture?.ok && <FilMessages messages={lecture.conversation.messages} lectureSeule />}
        {lecture && !lecture.ok && (
          <Alerte variante={lecture.erreur === MESSAGES_AGENT.plusConsultable ? "info" : "erreur"}>{lecture.erreur}</Alerte>
        )}
      </div>
      <div className="grid flex-none border-t border-line px-4 pt-3 pb-4">
        {lecture && !lecture.ok ? (
          boutonRevenir
        ) : (
          <Alerte>
            <p>{MESSAGES_AGENT.lectureSeule}</p>
            <div className="mt-2 grid">{boutonRevenir}</div>
          </Alerte>
        )}
      </div>
    </>
  );
}
