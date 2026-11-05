import Anthropic from "@anthropic-ai/sdk";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cleElement, lienElement, nettoyerReponse, type ElementCite } from "@/lib/agent/citations";
import { clientAgentConfigure, type ClientAgent } from "@/lib/agent/client";
import { lireContexte } from "@/lib/agent/contexte";
import { executerTour } from "@/lib/agent/demande";
import { contexteDate, noteContexte, type RefContexte } from "@/lib/agent/regles";
import { BUCKET_AVIS } from "@/lib/avis/avis";
import { viderDossier } from "@/lib/compte/suppression";
import { lignesImpossibles, texteLigne, type LigneRecapitulatif } from "@/lib/flotte/regles-recapitulatif";
import { createAdminClient } from "@/lib/supabase/admin";
import { MAINTENANT_DEMO, creerFlotteDemo, type IdsDemo } from "./flotte-demo";
import type { Question, Ref, RefElement } from "./questions";

// Le banc des évaluations de Demande à Désigno : la phase 26 (npm run eval:agent) et la phase 31 (npm run
// eval:hors-role). Il sème le compte de démonstration sur le Supabase local, pose chaque question dans une session neuve
// avec l'agent configuré par `npm run agent:config`, note la réponse sans juge, puis efface les sessions et le compte.

/** Questions posées en même temps. */
const EN_PARALLELE = 4;

export const admin = createAdminClient();

/** Le compte de démonstration, sa session (les outils lisent sous la RLS, comme dans l'application) et l'agent. */
export type Banc = {
  ids: IdsDemo;
  userId: string;
  supabase: SupabaseClient;
  client: ClientAgent;
  anthropic: Anthropic;
};

export type Resultat = { question: Question; reponse: string; ecarts: string[]; dureeMs: number; coutCentimes: number };

/** Vérifie le Supabase local et l'agent, puis crée le compte, sa session et la flotte de démonstration. */
export async function semerBanc(): Promise<Banc> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) {
    throw new Error(`L'évaluation sème un compte de démonstration : ${url} n'est pas le Supabase local.`);
  }
  const client = clientAgentConfigure();
  if (!client) {
    throw new Error(
      "ANTHROPIC_API_KEY, ANTHROPIC_AGENT_ID ou ANTHROPIC_ENVIRONMENT_ID manquante dans .env.development.local : " +
        "lance d'abord `npm run agent:config` (evaluation/LISEZMOI.md).",
    );
  }

  const email = `eval-agent-${Date.now()}@exemple.fr`;
  const lien = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (lien.error) throw lien.error;
  const supabase = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const session = await supabase.auth.verifyOtp({ type: "email", token_hash: lien.data.properties.hashed_token });
  if (session.error || !session.data.user) throw session.error ?? new Error("aucun utilisateur");
  const userId = session.data.user.id;
  const entreprise = await admin.from("entreprise").select("id").eq("user_id", userId).single();
  if (entreprise.error) throw entreprise.error;

  const image = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
  const ids = await creerFlotteDemo(admin, entreprise.data.id, image);
  return { ids, userId, supabase, client, anthropic: new Anthropic() };
}

/** Vide le dossier des fichiers du compte, puis le supprime : la base efface le reste en cascade. */
export async function nettoyerBanc(banc: Banc | undefined) {
  if (!banc) return;
  await viderDossier(admin, BUCKET_AVIS, banc.ids.entrepriseId);
  await admin.auth.admin.deleteUser(banc.userId);
}

/** Sans casse, accents ni espaces insécables : « 373,00 € » se retrouve tel qu'on l'écrit. */
export function normaliser(texte: string) {
  return texte
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[\s  ]+/g, " ")
    .toLowerCase();
}

export function trouve(reponse: string, attendu: string | RegExp) {
  if (typeof attendu === "string") return normaliser(reponse).includes(normaliser(attendu));
  return attendu.test(reponse) || attendu.test(normaliser(reponse));
}

/** L'élément de la démo que l'écran ouvert affiche, comme le panneau l'envoie avec la demande. */
function refContexte({ ids }: Banc, ref: RefElement): RefContexte {
  if ("vehicule" in ref) return { type: "vehicule", id: ids.vehicules[ref.vehicule] };
  if ("avis" in ref) return { type: "avis", id: ids.avis[ref.avis] };
  return { type: "conducteur", id: ids.conducteurs[ref.conducteur] };
}

/** L'élément est cité : son lien, ou, pour un véhicule, son planning ; un écran, par son lien dans la réponse. */
export function cite(banc: Banc, contenu: string, elements: readonly ElementCite[], ref: Ref) {
  if ("ecran" in ref) return contenu.includes(`](${ref.ecran})`);
  const { type, id } = refContexte(banc, ref);
  if (type === "vehicule") {
    return elements.some(({ type: cite, id: idCite }) => (cite === "vehicule" || cite === "planning") && idCite === id);
  }
  return elements.some((element) => element.lien === lienElement(type, id));
}

/** Les écarts entre le récapitulatif proposé et celui attendu : aucun récapitulatif sans attendu. */
export function ecartsRecapitulatif(question: Question, propose: LigneRecapitulatif[] | null): string[] {
  const attendu = question.recapitulatif;
  if (!attendu) return propose ? ["propose un récapitulatif à tort"] : [];
  if (!propose) return ["ne propose pas de récapitulatif"];
  const operations = propose.map(({ operation }) => operation);
  const lignes = propose.map(texteLigne).join("\n");
  return [
    ...(operations.join() === attendu.operations.join() ? [] : [`propose ${operations.join(", ")}`]),
    // Phase 30 : une ligne rouge restée dans le dernier récapitulatif bloque « Confirmer ».
    ...lignesImpossibles(propose).map(({ ligne, motif }) => `ligne ${ligne} impossible : ${motif}`),
    ...(attendu.contient ?? []).filter((texte) => !trouve(lignes, texte)).map((texte) => `récapitulatif sans « ${texte} »`),
  ];
}

const nom = (ref: Ref) =>
  "ecran" in ref ? `l'écran ${ref.ecran}` : "vehicule" in ref ? ref.vehicule : "avis" in ref ? `avis ${ref.avis}` : ref.conducteur;

/** Les écarts entre la réponse et ses attendus : vide si elle est exacte. */
export function ecarts(banc: Banc, question: Question, reponse: string, elements: readonly ElementCite[]): string[] {
  return [
    ...(question.contient ?? []).filter((attendu) => !trouve(reponse, attendu)).map((a) => `manque « ${a} »`),
    ...(question.neContientPas ?? []).filter((interdit) => trouve(reponse, interdit)).map((a) => `contient « ${a} »`),
    ...(question.doitCiter ?? []).filter((ref) => !cite(banc, reponse, elements, ref)).map((ref) => `ne cite pas ${nom(ref)}`),
    ...(question.neDoitPasCiter ?? []).filter((ref) => cite(banc, reponse, elements, ref)).map((ref) => `cite à tort ${nom(ref)}`),
    ...(question.aucuneDonnee && !/\baucune?\b/.test(normaliser(reponse)) ? ["ne dit pas « aucun… »"] : []),
  ];
}

/** La session vient de passer au repos : son effacement attend que son statut le dise. */
async function effacer({ client }: Banc, sessionId: string) {
  for (let essai = 0; essai < 10; essai += 1) {
    try {
      return await client.effacerSession(sessionId);
    } catch {
      await new Promise((attente) => setTimeout(attente, 500));
    }
  }
  console.warn(`session ${sessionId} non effacée : à effacer dans la Console`);
}

/**
 * Une question dans une session neuve, partie de son écran comme dans l'application (traiterDemande) : la réponse,
 * nettoyée comme dans l'application, puis notée. `etiquette` marque la session chez Anthropic (« phase-26 »).
 */
export async function poser(banc: Banc, question: Question, etiquette: string): Promise<Resultat> {
  const { client, supabase, ids, anthropic } = banc;
  const connus = new Set<string>();
  // L'élément de l'écran et ceux qu'il désigne sont citables : la note donne leur lien.
  const lu = question.ecran ? await lireContexte(supabase, refContexte(banc, question.ecran), MAINTENANT_DEMO) : null;
  if (question.ecran && !lu) throw new Error(`[${question.id}] l'élément de l'écran est introuvable`);
  if (lu) {
    connus.add(cleElement(lu.contexte.type, lu.contexte.id));
    if (lu.derives.vehicule) connus.add(cleElement("vehicule", lu.derives.vehicule.id));
    if (lu.derives.conducteur) connus.add(cleElement("conducteur", lu.derives.conducteur.id));
  }
  // Le récapitulatif proposé est capturé, sans être enregistré : la session neuve n'a pas de conversation.
  let propose: LigneRecapitulatif[] | null = null;
  const enregistrerRecapitulatif = async (lignes: LigneRecapitulatif[]) => {
    propose = lignes;
    return { id: crypto.randomUUID(), statut: "propose" as const };
  };
  const sessionId = await client.creerSession({ entreprise_id: ids.entrepriseId, evaluation: etiquette });
  const debut = performance.now();
  try {
    // Au-delà de 2 minutes, la session est interrompue : la question compte comme fausse et lente.
    const tour = await executerTour({
      client,
      sessionId,
      texte: question.question,
      contexte: [contexteDate(MAINTENANT_DEMO), noteContexte(lu?.contexte ?? null, lu?.derives)].join("\n\n"),
      ctx: { supabase, maintenant: MAINTENANT_DEMO, connus, enregistrerRecapitulatif },
    });
    const dureeMs = performance.now() - debut;
    const { contenu, elements_cites } = tour.ok
      ? nettoyerReponse(tour.texte, connus)
      : { contenu: "", elements_cites: [] as ElementCite[] };
    const usage = (await anthropic.beta.sessions.retrieve(sessionId)).usage;
    return {
      question,
      reponse: contenu,
      ecarts: tour.ok
        ? [...ecarts(banc, question, contenu, elements_cites), ...ecartsRecapitulatif(question, propose)]
        : [`pas de réponse (${tour.raison})`],
      dureeMs,
      coutCentimes: Number(usage.list_cost?.amount ?? 0),
    };
  } finally {
    await effacer(banc, sessionId);
  }
}

/** Toutes les questions, 4 à la fois, dans l'ordre. */
export async function poserTout(banc: Banc, questions: readonly Question[], etiquette: string): Promise<Resultat[]> {
  const resultats: Resultat[] = [];
  for (let rang = 0; rang < questions.length; rang += EN_PARALLELE) {
    resultats.push(
      ...(await Promise.all(questions.slice(rang, rang + EN_PARALLELE).map((question) => poser(banc, question, etiquette)))),
    );
  }
  return resultats;
}

export const duree = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** Le détail de chaque question, puis la justesse, la durée médiane et maximale, et le coût mesuré. */
export function afficher(resultats: readonly Resultat[]) {
  for (const { question, reponse, ecarts, dureeMs } of resultats) {
    const etat = ecarts.length ? `FAUX (${ecarts.join(" ; ")})` : "juste";
    console.log(`\n[${question.id}] ${question.question}\n${duree(dureeMs)} · ${etat}\n${reponse}`);
  }
  const justes = resultats.filter(({ ecarts }) => !ecarts.length).length;
  const durees = resultats.map(({ dureeMs }) => dureeMs).toSorted((a, b) => a - b);
  const cout = resultats.reduce((somme, { coutCentimes }) => somme + coutCentimes, 0) / 100;
  console.log(
    `\nJustesse : ${justes}/${resultats.length} (${Math.round((justes / resultats.length) * 100)} %)` +
      `\nDurée : médiane ${duree(durees[Math.floor(durees.length / 2)])} · max ${duree(durees[durees.length - 1])}` +
      `\nCoût mesuré : ${cout.toFixed(2)} $ (${(cout / resultats.length).toFixed(3)} $ par demande)`,
  );
}
