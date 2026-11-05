import { after } from "next/server";
import { DEMANDES_AGENT_PAR_MOIS } from "@/lib/abonnement/plans";
import { UUID } from "@/lib/agent/citations";
import { clientAgentConfigure } from "@/lib/agent/client";
import { schemaRefContexte } from "@/lib/agent/contexte";
import { traiterDemande, type EvenementDemande } from "@/lib/agent/demande";
import { DUREE_MAX_ROUTE_S, MESSAGES_AGENT, remiseAZeroDemandes, verifierDemande } from "@/lib/agent/regles";
import { lireDemandesDuMois } from "@/lib/agent/usage";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientAuJeton } from "@/lib/supabase/jeton";
import { createClient } from "@/lib/supabase/server";

// Demande à Désigno (phase 26) : DUREE_MAX_ROUTE_S (src/lib/agent/regles.ts). Une demande dure au plus 2 minutes, plus
// le rattrapage d'une demande coupée.
export const maxDuration = 300;

const json = (corps: { erreur: string }, status: number) => Response.json(corps, { status });

/**
 * Envoie une demande à Désigno : `{ texte, contexte?, corrige? }`, le contexte étant l'élément de l'écran ouvert
 * (phase 28), et `corrige` l'id du récapitulatif que la demande corrige, par « Modifier » (phase 30). La
 * réponse suit la demande en NDJSON, une ligne par événement (`attente`, `etape`, `message`, `erreur`). La demande va au
 * bout même si l'onglet se ferme : `after` la garde en vie, et le panneau retrouve sa réponse à la réouverture ; seul
 * « Arrêter » l'interrompt. Hors Pro, rien n'est traité, ni au-delà de 100 demandes dans le mois (phase 27).
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!data?.claims || !session) return json({ erreur: "Non autorisé" }, 401);

  const corps = (await request.json().catch(() => null)) as { texte?: unknown; contexte?: unknown; corrige?: unknown } | null;
  const demande = verifierDemande(corps?.texte);
  if (!demande.ok) return json({ erreur: demande.erreur }, 400);
  // L'élément de l'écran est facultatif ; mal formé, la demande est refusée. Son entreprise est vérifiée à la lecture.
  const contexte = corps?.contexte == null ? null : schemaRefContexte.safeParse(corps.contexte);
  if (contexte && !contexte.success) return json({ erreur: "Requête invalide" }, 400);
  // Le récapitulatif corrigé, facultatif ; sa conversation est vérifiée au remplacement.
  const corrige = corps?.corrige == null ? null : corps.corrige;
  if (corrige !== null && (typeof corrige !== "string" || !UUID.test(corrige))) return json({ erreur: "Requête invalide" }, 400);

  // Le plan est relu à chaque demande ; `traiterDemande` le relit encore, pour un appel qui passerait outre.
  const { data: entreprise } = await supabase.from("entreprise").select("plan").maybeSingle<{ plan: string }>();
  if (entreprise?.plan !== "pro") return json({ erreur: MESSAGES_AGENT.pro }, 403);

  // La limite, avant de toucher à l'agent : une demande refusée ne coûte rien. `traiterDemande` reste l'autorité, avec
  // un compte atomique : deux demandes simultanées à 99 n'en acceptent qu'une.
  const maintenant = new Date();
  const demandes = await lireDemandesDuMois(supabase, maintenant).catch((erreur: unknown) => {
    console.error("demande à Désigno", erreur instanceof Error ? erreur.message : erreur);
    return null;
  });
  if (demandes === null) return json({ erreur: MESSAGES_AGENT.indisponible }, 503);
  if (demandes >= DEMANDES_AGENT_PAR_MOIS) {
    return json({ erreur: MESSAGES_AGENT.limite(remiseAZeroDemandes(maintenant)) }, 429);
  }

  const client = clientAgentConfigure();
  if (!client) return json({ erreur: MESSAGES_AGENT.indisponible }, 503);

  // Les outils lisent avec le jeton du gestionnaire, jusqu'à la fin de la demande : un jeton qui expirerait avant est
  // renouvelé, et les cookies suivent la réponse.
  let jeton = session.access_token;
  if ((session.expires_at ?? 0) * 1000 - Date.now() < DUREE_MAX_ROUTE_S * 1000) {
    const { data: renouvele } = await supabase.auth.refreshSession();
    if (renouvele.session) jeton = renouvele.session.access_token;
  }

  const encodeur = new TextEncoder();
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const ecrivain = writable.getWriter();
  // L'onglet fermé, l'écriture échoue : la demande continue sans lui.
  const ecrire = (evenement: EvenementDemande) => {
    ecrivain.write(encodeur.encode(`${JSON.stringify(evenement)}\n`)).catch(() => {});
  };

  const traitement = traiterDemande({
    admin: createAdminClient(),
    supabase: createClientAuJeton(jeton),
    client,
    texte: demande.texte,
    contexte: contexte?.data ?? null,
    corrige,
    surEvenement: ecrire,
  }).finally(() => ecrivain.close().catch(() => {}));
  after(() => traitement);

  return new Response(readable, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
