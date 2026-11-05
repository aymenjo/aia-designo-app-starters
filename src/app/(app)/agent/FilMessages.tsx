"use client";

import { Alerte } from "@/components/ui/Alerte";
import type { MessageConversation } from "@/lib/agent/conversations";
import { MESSAGES_AGENT, type ContexteDemande } from "@/lib/agent/regles";
import type { RecapitulatifConversation } from "@/lib/flotte/regles-recapitulatif";
import { Recapitulatif } from "./Recapitulatif";
import { ReponseAgent } from "./ReponseAgent";

// Le fil d'une conversation de Demande à Désigno (DESIGN.md) : les bulles du gestionnaire, alignées à droite, avec
// dessous « Corrige le récapitulatif » (phase 30) et « Sur : … » (phase 28) ; les réponses de l'agent en texte libre,
// avec leur récapitulatif (phase 29) ; « Demande arrêtée. » en gris ; une réponse en erreur, en alerte. Le même fil sert
// la conversation en cours et, en lecture seule, une conversation terminée de l'historique (phase 32).

/** Le libellé d'un élément derrière « Sur : » : une plaque en mono, sans le cadre de la plaque. */
export function LibelleContexte({ contexte }: { contexte: Pick<ContexteDemande, "type" | "libelle"> }) {
  return (
    <>
      Sur : <span className={contexte.type === "vehicule" ? "font-mono font-medium" : undefined}>{contexte.libelle}</span>
    </>
  );
}

type Props = { messages: readonly MessageConversation[] } & (
  | { lectureSeule: true; surChangement?: never; surModifier?: never }
  | {
      lectureSeule?: false;
      /** Un récapitulatif appliqué, annulé ou devenu inapplicable : le panneau garde son nouvel état. */
      surChangement: (recapitulatif: RecapitulatifConversation) => void;
      /** « Modifier » sur le récapitulatif `id` ; `null` quand la saisie est désactivée (limite atteinte). */
      surModifier: ((id: string) => void) | null;
    }
);

export function FilMessages({ messages, lectureSeule, surChangement, surModifier }: Props) {
  return messages.map((message) =>
    message.role === "gestionnaire" ? (
      <div key={message.id} className="grid max-w-[85%] justify-items-end gap-1 justify-self-end">
        <p className="rounded-[16px_16px_4px_16px] bg-surface px-3.5 py-2.5 whitespace-pre-wrap break-words">
          {message.contenu}
        </p>
        {(message.correction || message.contexte) && (
          <p className="text-caption text-secondary">
            {message.correction && MESSAGES_AGENT.corrige}
            {message.correction && message.contexte && " · "}
            {message.contexte && <LibelleContexte contexte={message.contexte} />}
          </p>
        )}
      </div>
    ) : message.arret ? (
      <p key={message.id} className="text-label text-secondary">
        {message.contenu}
      </p>
    ) : message.erreur ? (
      <Alerte key={message.id} variante="erreur">
        {message.contenu}
      </Alerte>
    ) : (
      <div key={message.id} className="grid gap-3">
        <ReponseAgent contenu={message.contenu} />
        {message.recapitulatif &&
          (lectureSeule ? (
            <Recapitulatif recapitulatif={message.recapitulatif} lectureSeule />
          ) : (
            <Recapitulatif
              recapitulatif={message.recapitulatif}
              surChangement={surChangement}
              surModifier={surModifier ? () => surModifier(message.recapitulatif!.id) : null}
            />
          ))}
      </div>
    ),
  );
}
