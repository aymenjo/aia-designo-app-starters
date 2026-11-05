import type { SupabaseClient } from "@supabase/supabase-js";
import { cleElement, elementsDesResultats, nettoyerReponse } from "./citations";
import type { ClientAgent, EvenementSession } from "./client";
import { lireContexte, nommerElement, type ContexteLu } from "./contexte";
import {
  COLONNES_MESSAGE,
  conversationEnCours,
  type ConversationServeur,
  type MessageConversation,
} from "./conversations";
import { ENTREES_OUTILS, type NomOutil } from "./definition";
import { executerOutil, type ContexteOutils } from "./outils";
import {
  enregistrerRecapitulatif,
  expirerOrphelins,
  marquerSignales,
  rattacherRecapitulatifs,
  remplacerPourCorrection,
  sortsANoter,
} from "./recapitulatifs";
import {
  DUREE_MAX_DEMANDE_MS,
  INTERVALLE_ARRET_MS,
  LONGUEUR_MAX_ETAPE,
  MESSAGES_AGENT,
  NOTE_ARRET,
  contexteDate,
  libelleEtape,
  noteContexte,
  noteCorrection,
  noteRecapitulatifs,
  remiseAZeroDemandes,
  verifierDemande,
  verrouMortAvant,
  type EntreeEtape,
  type RefContexte,
} from "./regles";
import { compterDemande } from "./usage";

// Une demande à Désigno (phase 26) : la route /api/agent la lance, et `after()` la garde en vie si l'onglet se ferme. Le
// serveur enregistre la demande, l'envoie à la session de la conversation, exécute chaque outil appelé par l'agent sous
// la session du gestionnaire, puis enregistre la réponse, nettoyée de tout lien inconnu. Une seule demande à la fois
// par conversation ; une demande coupée net (déploiement, plantage) est rattrapée par la suivante.
//
// Un récapitulatif de modifications (phase 29) proposé pendant le tour est rattaché à la réponse ; sans réponse, il
// expire. Ce qu'il devient ensuite (appliqué, annulé, expiré) est signalé à l'agent avec la demande suivante.
//
// La limite de 100 demandes par mois (phase 27) : une demande compte dès qu'elle est acceptée, une fois le verrou pris
// et avant d'entrer dans la conversation, même si Désigno échoue ensuite. Un refus qui ne laisse aucune trace (demande
// vide, plan Free, demande précédente en cours, limite atteinte) ne compte pas.
//
// Le contexte de l'écran (phase 28) part avec chaque demande, dans une note, et s'enregistre avec elle. Pendant le tour,
// chaque appel d'outil devient une étape (« Je consulte le planning de AB-123-CD… »), signalée au panneau et écrite sur
// la conversation pour un panneau rouvert. « Arrêter » pose le verrou de la demande dans `conversation.arret_demande` :
// le tour le guette chaque seconde, interrompt la session et enregistre « Demande arrêtée. » à la place de la réponse.
// La demande reste comptée ; un récapitulatif proposé pendant le tour expire, et la réponse partielle est écartée.
//
// « Modifier » (phase 30) : la demande part marquée de l'id du récapitulatif à corriger. Une fois acceptée et comptée,
// elle le remplace, l'agent reçoit ses lignes dans une note avec la consigne de le refaire, et le message du gestionnaire
// garde la marque, rappelée sous sa bulle. Un récapitulatif qui n'attend plus « Confirmer » n'est pas touché.

/** Ce que la route renvoie au panneau, au fil de la demande (NDJSON). */
export type EvenementDemande =
  /**
   * La demande est acceptée et comptée : Désigno cherche. `demandes` est le total du mois, celle-ci comprise.
   * `remplace` : le récapitulatif que la demande corrige (phase 30), qui ne s'applique plus.
   */
  | { type: "attente"; demandes: number; remplace?: string }
  /** L'étape en cours, à chaque appel d'outil de l'agent (phase 28). */
  | { type: "etape"; texte: string }
  /** Un message enregistré : la réponse, l'erreur ou la mention d'arrêt qui la remplace. */
  | { type: "message"; message: MessageConversation }
  /** La demande est refusée, sans rien enregistrer. */
  | { type: "erreur"; erreur: string };

export type ResultatTour =
  | { ok: true; texte: string; evenementId: string }
  | { ok: false; raison: "delai" | "arret" | "echec" | "vide" | "refus"; detail?: string };

/** Délai laissé à une session restée en plein travail pour s'arrêter, avant la demande suivante. */
const DELAI_RECONCILIATION_MS = 30_000;

/**
 * La réponse d'un tour : le texte de l'agent après son dernier appel d'outil (ce qui précède annonce une recherche), ou
 * tout son texte s'il n'a rien écrit ensuite. `null` sans texte. L'id est celui du dernier message : une réponse
 * retrouvée après une coupure n'est enregistrée qu'une fois.
 */
export function reponseDuTour(evenements: readonly EvenementSession[]) {
  const messages = evenements.flatMap((e, rang) => (e.type === "message" && e.texte.trim() ? [{ ...e, rang }] : []));
  const dernierOutil = evenements.findLastIndex((e) => e.type === "outil");
  const apres = messages.filter(({ rang }) => rang > dernierOutil);
  const retenus = apres.length ? apres : messages;
  if (!retenus.length) return null;
  const dernier = retenus[retenus.length - 1];
  return { texte: retenus.map((m) => m.texte.trim()).join("\n\n"), evenementId: dernier.id, le: dernier.le };
}

/**
 * Un tour de la session : la demande part, puis chaque appel d'outil est exécuté et son résultat renvoyé, jusqu'à la fin
 * du tour. Au-delà du délai, ou à l'arrêt demandé par le gestionnaire, la session est interrompue. Le flux est ouvert
 * avant l'envoi, pour ne rien manquer. `surEtape` suit chaque appel d'outil, sans retarder son exécution ;
 * `arretDemande` est interrogé chaque seconde.
 */
export async function executerTour({
  client,
  sessionId,
  texte,
  contexte,
  ctx,
  delaiMs = DUREE_MAX_DEMANDE_MS,
  surEtape,
  arretDemande,
}: {
  client: ClientAgent;
  sessionId: string;
  texte: string;
  contexte: string;
  ctx: ContexteOutils;
  delaiMs?: number;
  surEtape?: (nom: string, entree: unknown) => void;
  arretDemande?: () => Promise<boolean>;
}): Promise<ResultatTour> {
  const abandon = new AbortController();
  let delaiDepasse = false;
  let arrete = false;
  const minuteur = setTimeout(() => {
    delaiDepasse = true;
    abandon.abort();
  }, delaiMs);
  // Une vérification à la fois : une lecture lente ne s'empile pas.
  let verification = false;
  const guet = arretDemande
    ? setInterval(() => {
        if (verification || abandon.signal.aborted) return;
        verification = true;
        arretDemande()
          .then((oui) => {
            if (oui && !abandon.signal.aborted) {
              arrete = true;
              abandon.abort();
            }
          })
          .catch((erreur: unknown) => console.error("arrêt de la demande", erreur instanceof Error ? erreur.message : erreur))
          .finally(() => (verification = false));
      }, INTERVALLE_ARRET_MS)
    : undefined;
  const tour: EvenementSession[] = [];
  const appels = new Map<string, Promise<{ contenu: string; erreur: boolean }>>();
  // Une fin de tour ne compte qu'une fois le tour commencé : le flux ne doit pas clore la demande sur l'état d'avant.
  let commence = false;

  try {
    const flux = await client.ecouter(sessionId, abandon.signal);
    await client.envoyer(sessionId, [{ type: "demande", texte, contexte }]);
    for await (const evenement of flux) {
      if (evenement.type === "demande" || evenement.type === "message" || evenement.type === "outil") commence = true;
      if (evenement.type === "outil") {
        tour.push(evenement);
        appels.set(evenement.id, executerOutil(ctx, evenement.nom, evenement.entree));
        try {
          surEtape?.(evenement.nom, evenement.entree);
        } catch {
          // L'étape n'est qu'un suivi : l'outil s'exécute quoi qu'il arrive.
        }
      } else if (evenement.type === "message") {
        tour.push(evenement);
      } else if (evenement.type === "attente") {
        // Les résultats partent ensemble : l'agent reprend une fois tous reçus.
        const resultats = await Promise.all(
          evenement.ids.map(async (id) => {
            const appel = appels.get(id);
            appels.delete(id);
            const { contenu, erreur } = appel
              ? await appel
              : { contenu: JSON.stringify({ erreur: MESSAGES_AGENT.interrompue }), erreur: true };
            return { type: "resultat" as const, outilId: id, contenu, erreur };
          }),
        );
        if (resultats.length) await client.envoyer(sessionId, resultats);
      } else if (evenement.type === "fin" && commence) {
        const reponse = reponseDuTour(tour);
        return reponse ? { ok: true, texte: reponse.texte, evenementId: reponse.evenementId } : { ok: false, raison: "vide" };
      } else if (evenement.type === "echec" && commence) {
        return { ok: false, raison: evenement.raison === "refusal" ? "refus" : "echec", detail: evenement.raison };
      }
    }
    if (!delaiDepasse && !arrete) return { ok: false, raison: "echec", detail: "flux fermé avant la fin du tour" };
  } catch (erreur) {
    if (!delaiDepasse && !arrete) throw erreur;
  } finally {
    clearTimeout(minuteur);
    clearInterval(guet);
    abandon.abort();
  }

  try {
    await client.envoyer(sessionId, [{ type: "interruption" }]);
  } catch (erreur) {
    console.error("interruption de la session", erreur instanceof Error ? erreur.message : erreur);
  }
  return { ok: false, raison: arrete ? "arret" : "delai" };
}

/** La ligne d'une lecture ou d'une écriture, `null` s'il n'y en a pas, ou son erreur levée. */
function verifier<T>(
  { data, error }: { data: T | null; error: { code: string; message: string } | null },
  quoi: string,
): T | null {
  if (error) throw new Error(`${quoi} : ${error.code} ${error.message}`);
  return data;
}

type MessageAEnregistrer = {
  role: "gestionnaire" | "agent";
  contenu: string;
  erreur?: boolean;
  arret?: boolean;
  contexte?: ContexteLu["contexte"] | null;
  correction?: boolean;
  elements_cites?: unknown[];
  evenement_id?: string;
  cree_le?: string;
};

/** Enregistre un message de la conversation ; un message de l'agent déjà enregistré (même événement) est ignoré. */
async function enregistrer(
  admin: SupabaseClient,
  conversation: ConversationServeur,
  message: MessageAEnregistrer,
): Promise<MessageConversation | null> {
  const ligne = { conversation_id: conversation.id, entreprise_id: conversation.entreprise_id, ...message };
  const requete = message.evenement_id
    ? admin.from("message").upsert(ligne, { onConflict: "evenement_id", ignoreDuplicates: true })
    : admin.from("message").insert(ligne);
  const lignes = verifier(await requete.select(COLONNES_MESSAGE), "message") as MessageConversation[] | null;
  return lignes?.[0] ?? null;
}

/** Les éléments connus de la conversation s'enrichissent de ceux de la demande. */
async function retenirElements(admin: SupabaseClient, conversation: ConversationServeur, connus: ReadonlySet<string>) {
  if (connus.size === conversation.elements_connus.length) return;
  verifier(
    await admin.from("conversation").update({ elements_connus: [...connus] }).eq("id", conversation.id),
    "éléments connus",
  );
  conversation.elements_connus = [...connus];
}

/**
 * Les événements du dernier tour de la session : ceux qui suivent la dernière demande. Les outils qui y attendent encore
 * leur résultat sont ceux d'une demande coupée net.
 */
function dernierTour(historique: readonly EvenementSession[]) {
  const debut = historique.findLastIndex((e) => e.type === "demande");
  const tour = debut < 0 ? [] : historique.slice(debut + 1);
  const repondus = new Set(tour.flatMap((e) => (e.type === "resultat" ? [e.outilId] : [])));
  const orphelins = tour.flatMap((e) => (e.type === "outil" && !repondus.has(e.id) ? [e.id] : []));
  return { tour, orphelins };
}

/**
 * Rattrape une demande coupée net, ou arrêtée : la session est arrêtée si elle travaille encore, chaque outil resté sans
 * réponse reçoit une erreur, puis la réponse du dernier tour est enregistrée si elle manque. Après un arrêt
 * (`enregistrerReponse: false`), la réponse partielle est écartée. Renvoie `false` si la session est terminée : la
 * conversation en ouvre une autre.
 */
async function reconcilier(
  admin: SupabaseClient,
  client: ClientAgent,
  conversation: ConversationServeur & { session_id: string },
  { enregistrerReponse = true }: { enregistrerReponse?: boolean } = {},
): Promise<boolean> {
  const sessionId = conversation.session_id;
  const statut = await client.statut(sessionId);
  if (statut === "terminated") return false;

  let historique = await client.historique(sessionId);
  const { orphelins } = dernierTour(historique);
  if (statut !== "idle" || orphelins.length) {
    const erreur = (outilId: string) => ({
      type: "resultat" as const,
      outilId,
      contenu: JSON.stringify({ erreur: MESSAGES_AGENT.interrompue }),
      erreur: true,
    });
    const abandon = new AbortController();
    const minuteur = setTimeout(() => abandon.abort(), DELAI_RECONCILIATION_MS);
    try {
      const flux = await client.ecouter(sessionId, abandon.signal);
      await client.envoyer(sessionId, orphelins.length ? orphelins.map(erreur) : [{ type: "interruption" }]);
      for await (const evenement of flux) {
        if (evenement.type === "attente") await client.envoyer(sessionId, evenement.ids.map(erreur));
        if (evenement.type === "fin" || evenement.type === "echec") break;
      }
    } catch (erreur) {
      if (!abandon.signal.aborted) throw erreur;
    } finally {
      clearTimeout(minuteur);
      abandon.abort();
    }
    historique = await client.historique(sessionId);
  }

  if (!enregistrerReponse) return true;
  const { tour } = dernierTour(historique);
  const reponse = reponseDuTour(tour);
  if (reponse) {
    const resultats = tour.flatMap((e) => (e.type === "resultat" ? [e.contenu] : []));
    const connus = new Set([...conversation.elements_connus, ...elementsDesResultats(resultats)]);
    const { contenu, elements_cites } = nettoyerReponse(reponse.texte, connus);
    if (contenu) {
      const message = await enregistrer(admin, conversation, {
        role: "agent",
        contenu,
        elements_cites,
        evenement_id: reponse.evenementId,
        cree_le: reponse.le,
      });
      // Le récapitulatif proposé pendant le tour coupé : la réponse retrouvée le présente.
      if (message) await rattacherRecapitulatifs(admin, conversation.id, message.id);
      await retenirElements(admin, conversation, connus);
    }
  }
  return true;
}

const MESSAGE_ECHEC: Record<Exclude<Exclude<ResultatTour, { ok: true }>["raison"], "arret">, string> = {
  delai: MESSAGES_AGENT.delai,
  echec: MESSAGES_AGENT.indisponible,
  vide: MESSAGES_AGENT.indisponible,
  refus: MESSAGES_AGENT.refus,
};

/**
 * Traite une demande du gestionnaire, de bout en bout. `supabase` porte son jeton (RLS) : le plan, l'entreprise, le
 * contexte de l'écran et les outils passent par lui. `admin` écrit la conversation et ses messages. `surEvenement` suit
 * la demande ; la demande va au bout même si plus personne n'écoute, sauf si le gestionnaire l'arrête. Ne lève pas : une
 * panne devient un message d'erreur enregistré.
 */
export async function traiterDemande({
  admin,
  supabase,
  client,
  texte: brut,
  contexte: refContexte,
  corrige = null,
  maintenant = new Date(),
  delaiMs,
  surEvenement = () => {},
}: {
  admin: SupabaseClient;
  supabase: SupabaseClient;
  client: ClientAgent;
  texte: unknown;
  /** L'élément de l'écran ouvert à l'envoi : un avis, un véhicule ou un conducteur. */
  contexte?: RefContexte | null;
  /** « Modifier » (phase 30) : l'id du récapitulatif que la demande corrige. */
  corrige?: string | null;
  maintenant?: Date;
  delaiMs?: number;
  surEvenement?: (evenement: EvenementDemande) => void;
}): Promise<void> {
  const signaler = (evenement: EvenementDemande) => {
    try {
      surEvenement(evenement);
    } catch {
      // Plus personne n'écoute : la demande continue.
    }
  };

  const demande = verifierDemande(brut);
  if (!demande.ok) return signaler({ type: "erreur", erreur: demande.erreur });

  // Le plan est relu à chaque demande : en Free, ou de retour en Free, rien n'est traité.
  const entreprise = await supabase.from("entreprise").select("id, plan").maybeSingle<{ id: string; plan: string }>();
  if (entreprise.error || !entreprise.data) {
    console.error("demande à Désigno : entreprise", entreprise.error?.message);
    return signaler({ type: "erreur", erreur: MESSAGES_AGENT.indisponible });
  }
  if (entreprise.data.plan !== "pro") return signaler({ type: "erreur", erreur: MESSAGES_AGENT.pro });

  let conversation: ConversationServeur;
  let verrou: string;
  let reprise: boolean;
  try {
    conversation = await conversationEnCours(admin, entreprise.data.id, maintenant);
    // Le verrou : une seule demande à la fois. Celui d'une demande morte (plus vieux que la route) se reprend.
    verrou = maintenant.toISOString();
    reprise = conversation.demande_en_cours_depuis !== null;
    const pris = verifier(
      await admin
        .from("conversation")
        .update({ demande_en_cours_depuis: verrou })
        .eq("id", conversation.id)
        .or(`demande_en_cours_depuis.is.null,demande_en_cours_depuis.lt."${verrouMortAvant(maintenant).toISOString()}"`)
        .select("id")
        .maybeSingle(),
      "verrou",
    );
    if (!pris) return signaler({ type: "erreur", erreur: MESSAGES_AGENT.enCours });
  } catch (erreur) {
    console.error("demande à Désigno", erreur instanceof Error ? erreur.message : erreur);
    return signaler({ type: "erreur", erreur: MESSAGES_AGENT.indisponible });
  }

  const libererVerrou = async () => {
    const libere = await admin
      .from("conversation")
      .update({ demande_en_cours_depuis: null, etape: null })
      .eq("id", conversation.id)
      .eq("demande_en_cours_depuis", verrou);
    if (libere.error) console.error("demande à Désigno : verrou", libere.error.message);
  };

  // La demande est comptée avant d'entrer dans la conversation : une demande enregistrée a toujours été comptée. À la
  // limite, ou si le compte échoue, rien n'est enregistré.
  let demandes: number | null;
  try {
    demandes = await compterDemande(admin, conversation.entreprise_id, maintenant);
  } catch (erreur) {
    console.error("demande à Désigno", erreur instanceof Error ? erreur.message : erreur);
    await libererVerrou();
    return signaler({ type: "erreur", erreur: MESSAGES_AGENT.indisponible });
  }
  if (demandes === null) {
    await libererVerrou();
    return signaler({ type: "erreur", erreur: MESSAGES_AGENT.limite(remiseAZeroDemandes(maintenant)) });
  }

  const echouer = async (message: string) => {
    // Un récapitulatif proposé par un tour sans réponse n'a jamais été présenté : il expire.
    await expirerOrphelins(admin, conversation.id).catch((erreur: unknown) => {
      console.error("demande à Désigno : récapitulatifs orphelins", erreur instanceof Error ? erreur.message : erreur);
    });
    const enregistre = await enregistrer(admin, conversation, { role: "agent", contenu: message, erreur: true }).catch(
      (erreur: unknown) => {
        console.error("demande à Désigno : erreur", erreur instanceof Error ? erreur.message : erreur);
        return null;
      },
    );
    signaler(enregistre ? { type: "message", message: enregistre } : { type: "erreur", erreur: message });
  };

  // « Arrêter » : le gestionnaire a posé le verrou de cette demande-ci. Une demande suivante a un autre verrou.
  const arretDemande = async () => {
    const lue = verifier(
      await admin
        .from("conversation")
        .select("arret_demande")
        .eq("id", conversation.id)
        .maybeSingle<{ arret_demande: string | null }>(),
      "arrêt demandé",
    );
    return lue?.arret_demande != null && Date.parse(lue.arret_demande) === Date.parse(verrou);
  };

  const arreter = async () => {
    // Un récapitulatif proposé pendant le tour arrêté n'a jamais été présenté : il expire.
    await expirerOrphelins(admin, conversation.id).catch((erreur: unknown) => {
      console.error("demande à Désigno : récapitulatifs orphelins", erreur instanceof Error ? erreur.message : erreur);
    });
    const enregistre = await enregistrer(admin, conversation, {
      role: "agent",
      contenu: MESSAGES_AGENT.arretee,
      arret: true,
    }).catch((erreur: unknown) => {
      console.error("demande à Désigno : arrêt", erreur instanceof Error ? erreur.message : erreur);
      return null;
    });
    signaler(enregistre ? { type: "message", message: enregistre } : { type: "erreur", erreur: MESSAGES_AGENT.indisponible });
  };

  // Les étapes passent par une file : elles arrivent dans l'ordre des appels d'outil, sans retarder les outils.
  let etapes: Promise<void> = Promise.resolve();

  try {
    // Le récapitulatif corrigé ne s'applique plus, dès la demande acceptée.
    const corrigees = corrige ? await remplacerPourCorrection(admin, conversation.id, corrige) : null;
    signaler({ type: "attente", demandes, ...(corrigees && corrige ? { remplace: corrige } : {}) });
    // Une demande précédente coupée net : son verrou est resté, ou sa réponse manque. Une demande arrêtée : sa session
    // peut encore tourner, ou garder des outils sans résultat.
    const dernier = verifier(
      await admin
        .from("message")
        .select("role, erreur, arret")
        .eq("conversation_id", conversation.id)
        .order("cree_le", { ascending: false })
        .limit(1)
        .maybeSingle<{ role: string; erreur: boolean; arret: boolean }>(),
      "dernier message",
    );
    const apresArret = Boolean(dernier?.arret);
    const aRattraper = reprise || dernier?.role === "gestionnaire" || Boolean(dernier?.erreur) || apresArret;

    // L'élément de l'écran, lu sous la session du gestionnaire : celui d'une autre entreprise est ignoré.
    const lu = refContexte
      ? await lireContexte(supabase, refContexte, maintenant).catch((erreur: unknown) => {
          console.error("demande à Désigno : contexte", erreur instanceof Error ? erreur.message : erreur);
          return null;
        })
      : null;

    await enregistrer(admin, conversation, {
      role: "gestionnaire",
      contenu: demande.texte,
      contexte: lu?.contexte ?? null,
      correction: Boolean(corrige),
    });
    if (!conversation.premiere_demande) {
      verifier(
        await admin
          .from("conversation")
          .update({ premiere_demande: demande.texte.slice(0, 500) })
          .eq("id", conversation.id)
          .is("premiere_demande", null),
        "première demande",
      );
    }

    let sessionId = conversation.session_id;
    if (
      sessionId &&
      aRattraper &&
      !(await reconcilier(admin, client, { ...conversation, session_id: sessionId }, { enregistrerReponse: !apresArret }))
    ) {
      sessionId = null;
    }
    if (!sessionId) {
      sessionId = await client.creerSession({ entreprise_id: conversation.entreprise_id });
      verifier(await admin.from("conversation").update({ session_id: sessionId }).eq("id", conversation.id), "session");
    }

    // Les récapitulatifs qu'aucune réponse n'a présentés expirent ; l'agent apprend le sort des autres avec la date.
    await expirerOrphelins(admin, conversation.id);
    // Arrêtée pendant le rattrapage : la demande ne part pas.
    if (await arretDemande()) return await arreter();

    const sorts = await sortsANoter(admin, conversation.id);
    // L'élément de l'écran et ceux qu'il désigne sont citables : la note donne leur lien.
    const connus = new Set(conversation.elements_connus);
    if (lu) {
      connus.add(cleElement(lu.contexte.type, lu.contexte.id));
      if (lu.derives.vehicule) connus.add(cleElement("vehicule", lu.derives.vehicule.id));
      if (lu.derives.conducteur) connus.add(cleElement("conducteur", lu.derives.conducteur.id));
    }

    const nommer = nommerElement(supabase, new Map(lu?.noms));
    const surEtape = (nom: string, entree: unknown) => {
      etapes = etapes
        .then(async () => {
          const valide = Object.hasOwn(ENTREES_OUTILS, nom) ? ENTREES_OUTILS[nom as NomOutil].safeParse(entree) : null;
          const texte = (await libelleEtape(nom, valide?.success ? (valide.data as EntreeEtape) : {}, nommer)).slice(
            0,
            LONGUEUR_MAX_ETAPE,
          );
          // Écrite d'abord : un panneau rouvert la relit, et ne la voit jamais en retard sur le flux.
          const ecrite = await admin
            .from("conversation")
            .update({ etape: texte })
            .eq("id", conversation.id)
            .eq("demande_en_cours_depuis", verrou);
          if (ecrite.error) console.error("demande à Désigno : étape", ecrite.error.message);
          signaler({ type: "etape", texte });
        })
        .catch((erreur: unknown) => {
          console.error("demande à Désigno : étape", erreur instanceof Error ? erreur.message : erreur);
        });
    };

    const resultat = await executerTour({
      client,
      sessionId,
      texte: demande.texte,
      contexte: [
        contexteDate(maintenant),
        noteContexte(lu?.contexte ?? null, lu?.derives),
        apresArret ? NOTE_ARRET : null,
        noteRecapitulatifs(sorts),
        corrigees ? noteCorrection(corrigees) : null,
      ]
        .filter(Boolean)
        .join("\n\n"),
      ctx: {
        supabase,
        maintenant,
        connus,
        enregistrerRecapitulatif: (lignes) => enregistrerRecapitulatif(admin, conversation, lignes),
      },
      delaiMs,
      surEtape,
      arretDemande,
    });
    // Les étapes du tour partent avant sa réponse.
    await etapes;
    // La note est partie avec la demande, que le tour aboutisse ou non.
    await marquerSignales(
      admin,
      sorts.map(({ id }) => id),
      maintenant,
    );
    await retenirElements(admin, conversation, connus);

    if (!resultat.ok) {
      if (resultat.raison === "arret") return await arreter();
      if (resultat.raison !== "delai") console.error("demande à Désigno :", resultat.raison, resultat.detail ?? "");
      return await echouer(MESSAGE_ECHEC[resultat.raison]);
    }
    const { contenu, elements_cites } = nettoyerReponse(resultat.texte, connus);
    // Sans texte, la réponse est une erreur : elle ne présente aucun récapitulatif.
    if (!contenu) await expirerOrphelins(admin, conversation.id);
    const message = await enregistrer(admin, conversation, {
      role: "agent",
      contenu: contenu || MESSAGES_AGENT.indisponible,
      erreur: !contenu,
      elements_cites,
      evenement_id: resultat.evenementId,
    });
    if (message) {
      const recapitulatif = contenu ? await rattacherRecapitulatifs(admin, conversation.id, message.id) : null;
      signaler({ type: "message", message: recapitulatif ? { ...message, recapitulatif } : message });
    }
  } catch (erreur) {
    console.error("demande à Désigno", erreur instanceof Error ? erreur.message : erreur);
    await echouer(MESSAGES_AGENT.indisponible);
  } finally {
    await etapes;
    await libererVerrou();
  }
}
