import type { SupabaseClient } from "@supabase/supabase-js";
import type { Plan } from "@/lib/abonnement/plans";
import { creerAvisGmail, piecesDejaRelevees } from "@/lib/avis/avis";
import { TAILLE_MAX_FICHIER } from "@/lib/avis/regles";
import type { Envoyeur } from "@/lib/email/envoi";
import { AccesGmailRefuse, type ClientComposio } from "./composio";
import { COLONNES_CONNEXION, signalerInterruption, type ConnexionGmail, type ReponseWebhook } from "./connexion";
import {
  contenuConforme,
  dateReception,
  schemaEvenement,
  trierPiecesJointes,
  type Ecart,
  type EmailReleve,
  type EtatReleve,
} from "./regles";
import { verifierSignature } from "./signature";

// Le webhook de Composio (phase 23), avec la clé secrète : il relève les emails du libellé choisi et signale une connexion
// interrompue. Composio relance tout ce qui ne répond pas 2xx : une réponse 500 est une demande de relance, une réponse
// 200 un « reçu, rien de plus à faire ». Tout est donc rejouable : l'email est réservé par son id Gmail, et chaque pièce
// jointe ne donne qu'un avis. La lecture IA des avis créés a lieu après la réponse (`aLire`).

export type ResultatWebhook = ReponseWebhook & {
  /** Les avis créés et jamais lus, que la route fait lire après avoir répondu. */
  aLire: string[];
  /** L'entreprise de ces avis : la route synchronise son agenda (phase 22) une fois qu'ils sont lus. */
  entrepriseId?: string;
};

type Dependances = {
  supabase: SupabaseClient;
  composio: ClientComposio | null;
  envoyeur: Envoyeur | null;
  urlSite: string;
};

const IGNORE = (message: string): ResultatWebhook => ({ statut: 200, message: `ignoré : ${message}`, aLire: [] });

type Connexion = ConnexionGmail & { entreprise: { plan: Plan } };

/** L'email déjà réservé par une livraison précédente, ou réservé maintenant. */
type EmailEnBase = { id: string; etat: EtatReleve | "ignore" | "depose" };

async function reserverEmail(
  supabase: SupabaseClient,
  connexion: Connexion,
  email: EmailReleve,
  premier: { etat: EtatReleve; ecarts: Ecart[] },
): Promise<EmailEnBase> {
  const ligne = {
    entreprise_id: connexion.entreprise_id,
    message_id: email.id,
    boite: connexion.email_compte,
    expediteur: email.sender?.trim().slice(0, 320) || null,
    objet: email.subject?.trim().slice(0, 500) || null,
    recu_le: dateReception(email.message_timestamp),
    ...premier,
  };
  const reserve = await supabase
    .from("email_gmail")
    .upsert(ligne, { onConflict: "entreprise_id,message_id", ignoreDuplicates: true })
    .select("id, etat");
  if (reserve.error) throw new Error(`réservation de l'email : ${reserve.error.code} ${reserve.error.message}`);
  if (reserve.data.length) return reserve.data[0] as EmailEnBase;

  const existant = await supabase
    .from("email_gmail")
    .select("id, etat")
    .eq("entreprise_id", connexion.entreprise_id)
    .eq("message_id", email.id)
    .single<EmailEnBase>();
  if (existant.error) throw new Error(`email relevé : ${existant.error.code} ${existant.error.message}`);
  return existant.data;
}

/**
 * Relève un email : chaque pièce jointe exploitable est téléchargée et devient un avis ; l'email est « non exploitable »
 * dès qu'une pièce jointe est écartée, ou s'il n'en a aucune. Un refus de Google interrompt la relève : la pièce jointe
 * est écartée (« connexion interrompue ») et le gestionnaire est prévenu. Un email que le gestionnaire a déjà ignoré ou
 * déposé garde son état.
 */
async function releverEmail(
  { supabase, composio, envoyeur, urlSite }: Dependances,
  { declencheurId, compteId, email }: { declencheurId: string; compteId: string; email: EmailReleve },
): Promise<ResultatWebhook> {
  const { data: connexion, error } = await supabase
    .from("connexion_google")
    .select(`${COLONNES_CONNEXION}, entreprise:entreprise(plan)`)
    .eq("declencheur_id", declencheurId)
    .maybeSingle<Connexion>();
  if (error) throw new Error(`connexion Gmail : ${error.code} ${error.message}`);
  // L'ancien déclencheur d'un changement de libellé ou d'une reconnexion, ou un compte déconnecté.
  if (!connexion || connexion.compte_id !== compteId) return IGNORE("déclencheur inconnu");
  // Retour en Free : la connexion reste, mais la relève est en pause. `plan` fait foi.
  if (connexion.entreprise.plan !== "pro") return IGNORE("relève en pause (Free)");
  if (email.label_ids && connexion.libelle_id && !email.label_ids.includes(connexion.libelle_id)) {
    return IGNORE("hors du libellé");
  }

  const { exploitables, ecarts } = trierPiecesJointes(email.payload);
  const etat = (ecartes: Ecart[]): EtatReleve =>
    ecartes.length || !exploitables.length ? "non_exploitable" : "releve";
  const reserve = await reserverEmail(supabase, connexion, email, { etat: etat(ecarts), ecarts });

  const deja = await piecesDejaRelevees(supabase, reserve.id);
  const aTelecharger = exploitables.filter(({ cle }) => !deja.has(cle));
  if (aTelecharger.length && !composio) return { statut: 503, message: "Composio n'est pas configuré", aLire: [] };

  const ecartes = [...ecarts];
  let crees = 0;
  let refus = false;
  for (const piece of aTelecharger) {
    let contenu: Buffer;
    try {
      contenu = await composio!.pieceJointe(compteId, email.id, piece.attachmentId);
    } catch (erreur) {
      if (!(erreur instanceof AccesGmailRefuse)) throw erreur;
      refus = true;
      ecartes.push({ nom: piece.nom, motif: "connexion" });
      continue;
    }
    if (!contenuConforme(piece.type, contenu)) {
      ecartes.push({ nom: piece.nom, motif: "format" });
      continue;
    }
    const avis = await creerAvisGmail(supabase, {
      entrepriseId: connexion.entreprise_id,
      emailGmailId: reserve.id,
      pieceJointe: piece.cle,
      contenu,
      type: piece.type,
      nom: piece.nom,
    });
    if (avis.ok) crees += 1;
    else ecartes.push({ nom: piece.nom, motif: contenu.length > TAILLE_MAX_FICHIER ? "taille" : "format" });
  }

  // L'état d'après tout ce que l'email a donné, livraisons précédentes comprises, sauf si le gestionnaire l'a traité.
  if (reserve.etat === "releve" || reserve.etat === "non_exploitable") {
    const { error: erreurEtat } = await supabase
      .from("email_gmail")
      .update({ etat: etat(ecartes), ecarts: ecartes })
      .eq("id", reserve.id)
      .in("etat", ["releve", "non_exploitable"]);
    if (erreurEtat) throw new Error(`état de l'email : ${erreurEtat.code} ${erreurEtat.message}`);
  }

  // Les avis de l'email jamais lus, même créés par une livraison précédente qui n'a pas abouti.
  const { data: nonLus, error: erreurLus } = await supabase
    .from("avis")
    .select("id")
    .eq("email_gmail_id", reserve.id)
    .is("lecture_ia", null)
    .eq("verrouille", false)
    .overrideTypes<{ id: string }[], { merge: false }>();
  if (erreurLus) throw new Error(`avis à lire : ${erreurLus.code} ${erreurLus.message}`);
  const aLire = nonLus.map(({ id }) => id);

  const releve = `relevé : ${crees} avis créé(s), ${ecartes.length} pièce(s) jointe(s) écartée(s)`;
  const entrepriseId = connexion.entreprise_id;
  if (!refus) return { statut: 200, message: releve, aLire, entrepriseId };
  const signalement = await signalerInterruption({ admin: supabase, envoyeur, urlSite, compteId });
  return { ...signalement, message: `${releve}, ${signalement.message}`, aLire, entrepriseId };
}

/**
 * Vérifie la signature de l'événement, puis le traite. `corps` est le corps brut, tel que Composio l'a signé ; `supabase`
 * porte la clé secrète.
 */
export async function traiterWebhookComposio({
  corps,
  entetes,
  secret,
  ...dependances
}: Dependances & { corps: string; entetes: Headers; secret: string }): Promise<ResultatWebhook> {
  if (!verifierSignature({ corps, entetes, secret })) return { statut: 400, message: "Signature invalide", aLire: [] };

  let brut: unknown;
  try {
    brut = JSON.parse(corps);
  } catch {
    return { statut: 400, message: "Corps illisible", aLire: [] };
  }
  const type = typeof brut === "object" && brut && "type" in brut ? String(brut.type) : "";
  const evenement = schemaEvenement.safeParse(brut);
  if (!evenement.success) {
    // Un type attendu mais d'une autre forme : Composio a changé son format. La réponse 500 le fait voir, et relancer.
    if (type === "composio.trigger.message" || type === "composio.connected_account.expired") {
      console.error("composio", type, "forme inattendue", evenement.error.issues.slice(0, 3));
      return { statut: 500, message: "Événement d'une forme inattendue", aLire: [] };
    }
    return IGNORE(type || "événement sans type");
  }

  try {
    const { data } = evenement;
    if (data.type === "composio.connected_account.expired") {
      return { ...(await signalerInterruption({ admin: dependances.supabase, ...dependances, compteId: data.data.id })), aLire: [] };
    }
    return await releverEmail(dependances, {
      declencheurId: data.metadata.trigger_id,
      compteId: data.metadata.connected_account_id,
      email: data.data,
    });
  } catch (erreur) {
    console.error("composio", type, erreur instanceof Error ? erreur.message : erreur);
    return { statut: 500, message: "Erreur interne : Composio relancera", aLire: [] };
  }
}
