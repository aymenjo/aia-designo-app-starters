import type { SupabaseClient } from "@supabase/supabase-js";
import { aujourdhuiParis } from "@/lib/dates";
import { emailDuGestionnaire } from "@/lib/email/destinataire";
import { empreinteEmail } from "@/lib/email/empreinte";
import type { Envoyeur } from "@/lib/email/envoi";
import { echeancesDuJour, seuilDuJour, type SeuilAlerte } from "./echeance";
import { emailAlertes, type AvisAlerte } from "./email-alertes";
import { STATUTS_AVIS, estOuvert } from "./regles";

// La tâche quotidienne des alertes (phase 14), avec la clé secrète : elle lit les avis de toutes les entreprises.
// Le jour J, à l'heure de Paris, un avis ouvert est concerné si son échéance tombe à J+15, J+7 ou J+2. Seul le jour
// exact compte : un seuil passé à la création n'est pas rattrapé, et un avis rouvert ne reçoit que les seuils suivants.
// Chaque seuil d'un avis part une fois : `alerte_envoyee` le réserve avant l'envoi.

type AvisConcerne = AvisAlerte & { entreprise_id: string; entreprise: { user_id: string } };

export type BilanAlertes = {
  /** Les emails partis, un par entreprise au plus. */
  emails: number;
  /** Les avis cités dans ces emails. */
  avis: number;
  /** Les entreprises dont l'email n'est pas parti : une relance le même jour le retente. */
  echecs: number;
};

const PAGE = 1000;

/** Les avis ouverts dont l'échéance atteint un seuil ce jour-là, toutes entreprises confondues. */
async function avisConcernes(supabase: SupabaseClient, aujourdhui: string): Promise<AvisConcerne[]> {
  const tous: AvisConcerne[] = [];
  // La réponse est plafonnée (`max_rows`) : on lit page par page.
  for (let debut = 0; ; debut += PAGE) {
    const { data, error } = await supabase
      .from("avis")
      .select("id, entreprise_id, numero, plaque, infraction_le, echeance, entreprise!inner(user_id)")
      .in("statut", STATUTS_AVIS.filter(estOuvert))
      .in("echeance", echeancesDuJour(aujourdhui))
      .order("id")
      .range(debut, debut + PAGE - 1)
      .overrideTypes<AvisConcerne[], { merge: false }>();
    if (error) throw new Error(`alertes : lecture des avis : ${error.code} ${error.message}`);
    tous.push(...data);
    if (data.length < PAGE) return tous;
  }
}

/** Réserve les seuils du jour ; ne renvoie que les avis réservés ici, pas ceux d'un passage précédent. */
async function reserver(supabase: SupabaseClient, lignes: { avis_id: string; seuil: SeuilAlerte }[]) {
  const { data, error } = await supabase
    .from("alerte_envoyee")
    .upsert(lignes, { onConflict: "avis_id,seuil", ignoreDuplicates: true })
    .select("avis_id");
  if (error) throw new Error(`réservation : ${error.code} ${error.message}`);
  return new Set(data.map(({ avis_id }) => avis_id as string));
}

/** Libère les seuils réservés, pour qu'une relance le même jour retente l'envoi. */
async function liberer(supabase: SupabaseClient, lignes: { avis_id: string; seuil: SeuilAlerte }[]) {
  const parSeuil = Map.groupBy(lignes, ({ seuil }) => seuil);
  for (const [seuil, deCeSeuil] of parSeuil) {
    const { error } = await supabase
      .from("alerte_envoyee")
      .delete()
      .eq("seuil", seuil)
      .in(
        "avis_id",
        deCeSeuil.map(({ avis_id }) => avis_id),
      );
    if (error) console.error("alertes", "libération", error.code, error.message);
  }
}

/**
 * Envoie à chaque entreprise un seul email, qui regroupe ses avis concernés ce jour-là. Relancée le même jour, la tâche
 * n'envoie rien de plus. L'échec d'une entreprise n'arrête pas les autres : ses seuils sont libérés pour la relance.
 * `supabase` porte la clé secrète.
 */
export async function envoyerAlertes({
  supabase,
  envoyeur,
  urlSite,
  aujourdhui = aujourdhuiParis(),
}: {
  supabase: SupabaseClient;
  envoyeur: Envoyeur;
  urlSite: string;
  aujourdhui?: string;
}): Promise<BilanAlertes> {
  const bilan: BilanAlertes = { emails: 0, avis: 0, echecs: 0 };
  const parEntreprise = Map.groupBy(await avisConcernes(supabase, aujourdhui), (un) => un.entreprise_id);

  for (const [entrepriseId, sesAvis] of parEntreprise) {
    let reservees: { avis_id: string; seuil: SeuilAlerte }[] = [];
    try {
      const lignes = sesAvis.map((un) => ({ avis_id: un.id, seuil: seuilDuJour(un.echeance, aujourdhui)! }));
      const ids = await reserver(supabase, lignes);
      reservees = lignes.filter(({ avis_id }) => ids.has(avis_id));
      const aEnvoyer = sesAvis.filter((un) => ids.has(un.id));
      if (!aEnvoyer.length) continue;

      const a = await emailDuGestionnaire(supabase, sesAvis[0].entreprise.user_id);
      const contenu = emailAlertes({ avis: aEnvoyer, aujourdhui, urlSite });
      // Envoyé mais sans réponse, puis relancé : Resend reconnaît le même email et ne le renvoie pas.
      const empreinte = await empreinteEmail(a, contenu.sujet, contenu.html);
      await envoyeur({ a, ...contenu, cleIdempotence: `alertes/${entrepriseId}/${aujourdhui}/${empreinte}` });
      bilan.emails += 1;
      bilan.avis += aEnvoyer.length;
    } catch (erreur) {
      console.error("alertes", entrepriseId, erreur instanceof Error ? erreur.message : erreur);
      bilan.echecs += 1;
      if (reservees.length) await liberer(supabase, reservees);
    }
  }
  return bilan;
}
