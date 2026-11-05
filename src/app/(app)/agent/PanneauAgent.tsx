"use client";

import { ArrowUp, History, SquarePen, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { CadenasPro } from "@/components/CadenasPro";
import { Alerte } from "@/components/ui/Alerte";
import { classesBouton } from "@/components/ui/Bouton";
import { DEMANDES_AGENT_PAR_MOIS, FONCTIONS_PRO, type Plan } from "@/lib/abonnement/plans";
import type { ConversationListee, MessageConversation } from "@/lib/agent/conversations";
import type { RecapitulatifConversation } from "@/lib/flotte/regles-recapitulatif";
import type { EvenementDemande } from "@/lib/agent/demande";
import {
  EXEMPLES,
  INTERVALLE_SUIVI_MS,
  LONGUEUR_MAX_DEMANDE,
  MESSAGES_AGENT,
  elementDeLEcran,
  remiseAZeroDemandes,
  type ContexteDemande,
  type RefContexte,
} from "@/lib/agent/regles";
import {
  arreterDemandeAction,
  lireContexteAction,
  lireConversationAction,
  nouvelleConversationAction,
  type EtatConversation,
} from "./actions";
import { FilMessages, LibelleContexte } from "./FilMessages";
import { BOUTON_ICONE, ConversationPassee, ListeConversations } from "./Historique";

// Le panneau « Demande à Désigno » (phase 26, DESIGN.md) : l'en-tête, la conversation en cours, et la saisie. Une
// demande part par /api/agent, qui suit la réponse ; si la connexion se coupe, ou si le panneau se rouvre pendant une
// demande, le panneau interroge le serveur jusqu'à la réponse. Une réponse peut présenter un récapitulatif de
// modifications (phase 29), appliqué seulement par « Confirmer ».
//
// Phase 28 : ouvert sur un avis, un véhicule ou un conducteur, le panneau le rappelle sous l'en-tête (« Sur : … »), et
// chaque demande part avec lui ; la bulle du gestionnaire le rappelle dessous. Pendant la recherche, la carte à bordure
// conique affiche l'étape en cours, avec « Arrêter » : la rotation s'arrête, puis « Demande arrêtée. » s'inscrit dans le
// fil, en gris, et la saisie est libre aussitôt.
//
// Sous la saisie, le compteur « 12/100 demandes ce mois-ci » (phase 27), relu avec la conversation et avancé dès qu'une
// demande est acceptée. À la limite, une alerte donne la date de remise à zéro, et la saisie et les exemples sont
// désactivés jusque-là ; « Nouvelle conversation » reste possible.
//
// « Modifier » (phase 30) met la saisie en correction : la pilule « Corrige le récapitulatif × » au-dessus, le focus
// dedans, et la demande suivante part marquée du récapitulatif. Accepté, il passe « Remplacé » ; la bulle rappelle
// « Corrige le récapitulatif » dessous. × ou Échap retire la marque.
//
// L'historique (phase 32) remplace le fil dans le panneau : l'icône ouvre la liste des conversations des 30 derniers
// jours, une ligne ouvre une conversation terminée en lecture seule, et « ← » revient en arrière. Le fil garde son état
// pendant ce temps : une demande en cours continue, et son suivi aussi.

const PRO = FONCTIONS_PRO.find(({ nom }) => nom === "Demande à Désigno")!;

export function PanneauAgent({ plan, fermer }: { plan: Plan; fermer: () => void }) {
  return (
    <aside
      aria-label="Demande à Désigno"
      className="fixed inset-y-0 right-0 z-30 flex w-100 flex-col border-l border-line bg-white shadow-agent motion-safe:animate-panneau max-md:hidden wide:sticky wide:top-0 wide:h-screen"
    >
      {plan === "pro" ? (
        <Conversation fermer={fermer} />
      ) : (
        <>
          <EnTete fermer={fermer} />
          <div className="p-5">
            <CadenasPro fonction={PRO.nom}>
              <p>{PRO.explication}</p>
              <p>
                Désigno cherche dans vos véhicules, vos conducteurs, votre planning et vos avis, puis répond en citant
                chaque élément, avec un lien pour vérifier d&apos;un clic.
              </p>
            </CadenasPro>
          </div>
        </>
      )}
    </aside>
  );
}

function EnTete({
  fermer,
  historique,
  nouvelle,
}: {
  fermer: () => void;
  /** L'icône historique : enfoncée tant que la liste ou une conversation terminée remplace le fil. */
  historique?: { basculer: () => void; ouvert: boolean };
  nouvelle?: { action: () => void; desactive: boolean };
}) {
  return (
    <div className="flex h-14 flex-none items-center justify-between gap-3 border-b border-line pr-3 pl-5">
      <h2 className="font-display text-lead font-bold tracking-[-0.01em]">Demande à Désigno</h2>
      <div className="flex items-center gap-1">
        {historique && (
          <button
            type="button"
            aria-label={MESSAGES_AGENT.historique}
            title={MESSAGES_AGENT.historique}
            aria-pressed={historique.ouvert}
            onClick={historique.basculer}
            className={`${BOUTON_ICONE} aria-pressed:bg-[rgb(0_0_0/0.06)] aria-pressed:text-ink`}
          >
            <History size={16} strokeWidth={1.5} aria-hidden />
          </button>
        )}
        {nouvelle && (
          <button
            type="button"
            aria-label="Nouvelle conversation"
            title="Nouvelle conversation"
            onClick={nouvelle.action}
            disabled={nouvelle.desactive}
            className={BOUTON_ICONE}
          >
            <SquarePen size={16} strokeWidth={1.5} aria-hidden />
          </button>
        )}
        <button type="button" aria-label="Fermer" title="Fermer" onClick={fermer} className={BOUTON_ICONE}>
          <X size={16} strokeWidth={1.5} aria-hidden />
        </button>
      </div>
    </div>
  );
}

/** Lit une réponse NDJSON, ligne par ligne. */
async function* lignes(corps: ReadableStream<Uint8Array>): AsyncGenerator<EvenementDemande> {
  const lecteur = corps.getReader();
  const decodeur = new TextDecoder();
  let reste = "";
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    reste += decodeur.decode(value, { stream: true });
    const morceaux = reste.split("\n");
    reste = morceaux.pop() ?? "";
    for (const ligne of morceaux) if (ligne.trim()) yield JSON.parse(ligne) as EvenementDemande;
  }
  if (reste.trim()) yield JSON.parse(reste) as EvenementDemande;
}

/** L'élément de l'écran ouvert, et son libellé lu sous la session du gestionnaire ; `null` sur un autre écran. */
function useContexteEcran(): ContexteDemande | null {
  const ref = elementDeLEcran(usePathname());
  const cle = ref ? `${ref.type}:${ref.id}` : null;
  const [lu, setLu] = useState<{ cle: string; contexte: ContexteDemande | null } | null>(null);

  useEffect(() => {
    if (!cle) return;
    const [type, id] = cle.split(":") as [RefContexte["type"], string];
    let actuel = true;
    void lireContexteAction({ type, id }).then((resultat) => {
      if (actuel) setLu({ cle, contexte: resultat && { type, id, libelle: resultat.libelle } });
    });
    return () => {
      actuel = false;
    };
  }, [cle]);

  return cle && lu?.cle === cle ? lu.contexte : null;
}

/** Ce que le panneau montre : le fil de la conversation en cours, la liste de l'historique, ou une conversation terminée. */
type Vue = { type: "fil" } | { type: "liste" } | { type: "passee"; conversation: Pick<ConversationListee, "id" | "debut"> };

function Conversation({ fermer }: { fermer: () => void }) {
  const [vue, setVue] = useState<Vue>({ type: "fil" });
  const [messages, setMessages] = useState<MessageConversation[]>([]);
  const [chargee, setChargee] = useState(false);
  // Une demande en cours : envoyée d'ici (`envoi`), ou trouvée en cours à l'ouverture (`suivi`).
  const [envoi, setEnvoi] = useState(false);
  const [suivi, setSuivi] = useState(false);
  // L'étape en cours (phase 28) ; « Arrêter » paraît une fois la demande acceptée, et `arret` suit le clic.
  const [etape, setEtape] = useState<string | null>(null);
  const [acceptee, setAcceptee] = useState(false);
  const [arret, setArret] = useState(false);
  const contexteEcran = useContexteEcran();
  const [erreur, setErreur] = useState<string | null>(null);
  const [saisie, setSaisie] = useState("");
  // « Modifier » (phase 30) : l'id du récapitulatif que la prochaine demande corrige.
  const [correction, setCorrection] = useState<string | null>(null);
  // Rien avant le premier chargement : un « 0/100 » ne doit pas sauter à « 12/100 ».
  const [usage, setUsage] = useState<EtatConversation["usage"] | null>(null);
  const fil = useRef<HTMLDivElement>(null);
  const champ = useRef<HTMLTextAreaElement>(null);

  const recharger = useCallback(async () => {
    const etat = await lireConversationAction();
    if (!etat) return;
    setMessages(etat.messages);
    setSuivi(etat.enCours);
    setEtape(etat.etape);
    if (!etat.enCours) setArret(false);
    setUsage(etat.usage);
    setChargee(true);
  }, []);

  useEffect(() => {
    // Le chargement à l'ouverture : l'état suit la réponse du serveur.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void recharger();
  }, [recharger]);

  // Une demande en cours sans connexion ouverte (onglet fermé puis rouvert, coupure) : le serveur la finit seul.
  useEffect(() => {
    if (!suivi || envoi) return;
    const minuteur = setInterval(() => void recharger(), INTERVALLE_SUIVI_MS);
    return () => clearInterval(minuteur);
  }, [suivi, envoi, recharger]);

  const enCours = envoi || suivi;
  // La correction ne vaut que pour un récapitulatif qui attend encore « Confirmer ».
  const corrige =
    correction !== null &&
    messages.some(({ recapitulatif }) => recapitulatif?.id === correction && recapitulatif.statut === "propose")
      ? correction
      : null;
  const atteinte = usage !== null && usage.demandes >= DEMANDES_AGENT_PAR_MOIS;
  // Le refus de la limite : l'alerte au-dessus de la saisie le dit déjà.
  const refusLimite = atteinte ? MESSAGES_AGENT.limite(usage.retour) : null;

  // De retour au fil, il défile en bas, et la saisie reprend le focus.
  useEffect(() => {
    fil.current?.scrollTo({ top: fil.current.scrollHeight });
  }, [messages, enCours, vue]);
  const vueAvant = useRef(vue.type);
  useEffect(() => {
    if (vue.type === "fil" && vueAvant.current !== "fil") champ.current?.focus();
    vueAvant.current = vue.type;
  }, [vue.type]);

  async function envoyer(texte: string) {
    const demande = texte.trim();
    if (!demande || enCours || atteinte) return;
    // Le contexte suit l'écran affiché à l'envoi : sans élément, la demande part sans lui. La marque de correction part
    // avec la demande, et revient si la demande est refusée.
    const contexte = contexteEcran;
    const corrigeEnvoi = corrige;
    setErreur(null);
    setSaisie("");
    setCorrection(null);
    setEtape(null);
    setAcceptee(false);
    setArret(false);
    setEnvoi(true);
    setMessages((liste) => [
      ...liste,
      {
        id: `local-${Date.now()}`,
        role: "gestionnaire",
        contenu: demande,
        erreur: false,
        arret: false,
        contexte,
        correction: corrigeEnvoi !== null,
        cree_le: new Date().toISOString(),
      },
    ]);
    try {
      const reponse = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          texte: demande,
          ...(contexte ? { contexte: { type: contexte.type, id: contexte.id } } : {}),
          ...(corrigeEnvoi ? { corrige: corrigeEnvoi } : {}),
        }),
      });
      if (!reponse.ok || !reponse.body) {
        const corps = (await reponse.json().catch(() => null)) as { erreur?: string } | null;
        setErreur(corps?.erreur ?? MESSAGES_AGENT.indisponible);
        setSaisie(demande);
        setCorrection(corrigeEnvoi);
        setMessages((liste) => liste.filter(({ id }) => !id.startsWith("local-")));
        return;
      }
      for await (const evenement of lignes(reponse.body)) {
        if (evenement.type === "etape") setEtape(evenement.texte);
        if (evenement.type === "attente") {
          setAcceptee(true);
          const remplace = evenement.remplace;
          if (remplace) {
            setMessages((liste) =>
              liste.map((message) =>
                message.recapitulatif?.id === remplace ? { ...message, recapitulatif: { ...message.recapitulatif, statut: "remplace" } } : message,
              ),
            );
          }
          setUsage((actuel) => ({
            demandes: evenement.demandes,
            retour: actuel?.retour ?? remiseAZeroDemandes(new Date()),
          }));
        }
        if (evenement.type === "message") setMessages((liste) => [...liste, evenement.message]);
        if (evenement.type === "erreur") {
          setErreur(evenement.erreur);
          setSaisie(demande);
          setCorrection(corrigeEnvoi);
          setMessages((liste) => liste.filter(({ id }) => !id.startsWith("local-")));
        }
      }
    } catch {
      // La connexion s'est coupée : la demande continue sur le serveur, que le panneau interroge.
    } finally {
      setEnvoi(false);
      await recharger();
    }
  }

  /** Le récapitulatif appliqué, annulé ou devenu inapplicable : sa carte suit, sans recharger la conversation. */
  const mettreAJour = useCallback((recapitulatif: RecapitulatifConversation) => {
    setMessages((liste) =>
      liste.map((message) => (message.recapitulatif?.id === recapitulatif.id ? { ...message, recapitulatif } : message)),
    );
  }, []);

  /** « Modifier » : la prochaine demande corrige ce récapitulatif ; la saisie prend le focus. */
  function modifier(id: string) {
    setCorrection(id);
    champ.current?.focus();
  }

  /** × ou Échap : la demande suivante ne corrige plus rien. */
  function abandonnerCorrection() {
    setCorrection(null);
    champ.current?.focus();
  }

  /** « Arrêter » : la rotation s'arrête aussitôt ; la mention « Demande arrêtée. » suit, par le flux ou par le suivi. */
  async function arreter() {
    setArret(true);
    setErreur(null);
    const resultat = await arreterDemandeAction();
    if (!resultat.ok) {
      setArret(false);
      setErreur(resultat.erreur);
    }
  }

  async function nouvelle() {
    setVue({ type: "fil" });
    setErreur(null);
    const resultat = await nouvelleConversationAction();
    if (!resultat.ok) return setErreur(resultat.erreur);
    setMessages([]);
    setSuivi(false);
    setCorrection(null);
    champ.current?.focus();
  }

  function soumettre(e: FormEvent) {
    e.preventDefault();
    void envoyer(saisie);
  }

  function touche(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape" && corrige) {
      e.preventDefault();
      return abandonnerCorrection();
    }
    // Entrée envoie ; Maj+Entrée va à la ligne.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void envoyer(saisie);
    }
  }

  const enTete = (
    <EnTete
      fermer={fermer}
      historique={{
        basculer: () => setVue((actuelle) => (actuelle.type === "fil" ? { type: "liste" } : { type: "fil" })),
        ouvert: vue.type !== "fil",
      }}
      nouvelle={{ action: () => void nouvelle(), desactive: enCours || !messages.length }}
    />
  );
  const auFil = () => setVue({ type: "fil" });

  if (vue.type === "liste") {
    return (
      <>
        {enTete}
        <ListeConversations
          retour={auFil}
          ouvrir={(conversation) => setVue(conversation.enCours ? { type: "fil" } : { type: "passee", conversation })}
        />
      </>
    );
  }
  if (vue.type === "passee") {
    return (
      <>
        {enTete}
        <ConversationPassee
          id={vue.conversation.id}
          debut={vue.conversation.debut}
          retour={() => setVue({ type: "liste" })}
          revenir={auFil}
        />
      </>
    );
  }

  return (
    <>
      {enTete}
      {contexteEcran && (
        <div className="flex-none px-5 pt-3">
          <p className="inline-flex h-7 max-w-full items-center truncate rounded-full border border-line bg-surface px-3 text-caption">
            <span className="truncate">
              <LibelleContexte contexte={contexteEcran} />
            </span>
          </p>
        </div>
      )}
      <div ref={fil} className="grid flex-1 content-start gap-4 overflow-y-auto p-5">
        {chargee && !messages.length && !enCours && (
          <div className="grid gap-3">
            <p className="text-secondary">
              Posez une question sur votre flotte, votre planning ou vos avis, ou décrivez un changement. Désigno cite
              chaque élément sur lequel il s&apos;appuie, et ne modifie rien avant « Confirmer ».
            </p>
            <ul aria-label="Exemples de demandes" className="grid gap-2">
              {EXEMPLES.map((exemple) => (
                <li key={exemple}>
                  <button
                    type="button"
                    onClick={() => void envoyer(exemple)}
                    disabled={atteinte}
                    className={`${classesBouton({ variante: "secondaire", taille: "sm" })} h-auto min-h-8 py-1.5 text-left whitespace-normal`}
                  >
                    {exemple}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <FilMessages messages={messages} surChangement={mettreAJour} surModifier={atteinte ? null : modifier} />
        {enCours && (
          // La rotation tourne pendant la recherche, et s'arrête au clic sur « Arrêter ».
          <div className={arret ? "rounded-card border border-line" : "bordure-agent animate-agent-spin rounded-card"}>
            <div className="flex min-h-10 items-center justify-between gap-3 rounded-[11px] bg-white py-1 pr-1 pl-3.5 text-label text-secondary">
              <span role="status">{arret ? MESSAGES_AGENT.arretEnCours : (etape ?? MESSAGES_AGENT.etapeDefaut)}</span>
              {(suivi || acceptee) && (
                <button
                  type="button"
                  onClick={() => void arreter()}
                  disabled={arret}
                  className={`${classesBouton({ variante: "ghost", taille: "sm" })} flex-none`}
                >
                  Arrêter
                </button>
              )}
            </div>
          </div>
        )}
        {erreur && erreur !== refusLimite && <Alerte variante="erreur">{erreur}</Alerte>}
      </div>
      <form onSubmit={soumettre} className="grid flex-none gap-2 border-t border-line px-4 pt-3 pb-4">
        {refusLimite && (
          <Alerte>
            <p>{refusLimite}</p>
            <p>{MESSAGES_AGENT.limiteEcrans}</p>
          </Alerte>
        )}
        {corrige && (
          <p className="inline-flex h-7 max-w-full items-center gap-1 justify-self-start rounded-full border border-line bg-surface pr-1 pl-3 text-caption">
            <span className="truncate">{MESSAGES_AGENT.corrige}</span>
            <button
              type="button"
              aria-label="Ne plus corriger le récapitulatif"
              title="Ne plus corriger le récapitulatif"
              onClick={abandonnerCorrection}
              className="grid size-5 flex-none cursor-pointer place-items-center rounded-full text-secondary transition-colors duration-120 ease-enter hover:bg-[rgb(0_0_0/0.05)] hover:text-ink"
            >
              <X size={12} strokeWidth={1.5} aria-hidden />
            </button>
          </p>
        )}
        <div className="flex items-end gap-2 rounded-field border border-line-strong py-1.5 pr-1.5 pl-3 focus-within:border-ink has-[textarea:disabled]:bg-surface">
          <label htmlFor="demande-agent" className="sr-only">
            Votre demande
          </label>
          <textarea
            id="demande-agent"
            ref={champ}
            rows={1}
            value={saisie}
            maxLength={LONGUEUR_MAX_DEMANDE}
            onChange={(e) => setSaisie(e.currentTarget.value)}
            onKeyDown={touche}
            disabled={atteinte}
            placeholder={corrige ? MESSAGES_AGENT.placeholderCorrection : "Posez une question ou décrivez un changement…"}
            className="field-sizing-content max-h-40 min-h-8 flex-1 resize-none bg-transparent py-1 outline-none placeholder:text-disabled disabled:cursor-not-allowed"
          />
          <button
            type="submit"
            aria-label="Envoyer"
            disabled={enCours || atteinte || !saisie.trim()}
            className="grid size-8 flex-none cursor-pointer place-items-center rounded-full bg-ink text-white transition-colors duration-120 ease-enter hover:bg-ink-hover disabled:cursor-not-allowed disabled:bg-line disabled:text-disabled"
          >
            <ArrowUp size={16} strokeWidth={1.5} aria-hidden />
          </button>
        </div>
        <div className="flex items-center justify-between gap-3 text-caption text-secondary">
          {usage && (
            <span className="font-mono font-medium">
              {usage.demandes}/{DEMANDES_AGENT_PAR_MOIS} demandes ce mois-ci
            </span>
          )}
          {!atteinte && <span className="ml-auto">Maj+Entrée : à la ligne</span>}
        </div>
      </form>
    </>
  );
}
