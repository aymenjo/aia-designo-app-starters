import type { Metadata } from "next";
import { CompteurUsage } from "@/components/CompteurUsage";
import type { Plan } from "@/lib/abonnement/plans";
import { lireUsage } from "@/lib/abonnement/quotas";
import { schemaIdAvis } from "@/lib/avis/regles";
import { formaterDateHeure } from "@/lib/format";
import { lireNonExploitable, schemaIdEmail } from "@/lib/gmail/emails";
import { lienGmail } from "@/lib/gmail/regles";
import { createClient } from "@/lib/supabase/server";
import { DepotAvis } from "./DepotAvis";

export const metadata: Metadata = { title: "Déposer un avis" };

// Vaut aussi pour les server actions de la page : la lecture IA, juste après le dépôt, peut prendre une minute
// (une relance comprise, voir lecteur-claude.ts).
export const maxDuration = 120;

export default async function NouvelAvis(props: PageProps<"/avis/nouveau">) {
  const recherche = await props.searchParams;
  const idExistant = schemaIdAvis.safeParse(recherche.existant);
  const idEmail = schemaIdEmail.safeParse(recherche.email);
  const supabase = await createClient();
  // Le dossier de l'entreprise dans le bucket : le navigateur y envoie le fichier.
  // Après un dépôt abandonné, l'avis qui portait déjà son n°, relu sous RLS : un id inconnu est ignoré.
  // Sur téléphone, le compteur d'usage est ici, et non dans la barre haute : le gestionnaire sait avant la photo si
  // l'avis sera « Verrouillé ». Un échec le tait, comme dans la barre haute.
  // Depuis « Emails non exploitables » (phase 23) : l'email, s'il y est encore, est rappelé, et l'avis lui sera rattaché.
  const [{ data: entreprise, error }, existant, usage, email] = await Promise.all([
    supabase.from("entreprise").select("id, plan").single<{ id: string; plan: Plan }>(),
    idExistant.success
      ? supabase
          .from("avis")
          .select("id, numero")
          .eq("id", idExistant.data)
          .not("numero", "is", null)
          .maybeSingle<{ id: string; numero: string }>()
      : { data: null, error: null },
    lireUsage(supabase).catch((erreur: unknown) => {
      console.error("usage", erreur);
      return null;
    }),
    idEmail.success ? lireNonExploitable(supabase, idEmail.data) : { data: null, error: null },
  ]);
  if (error ?? existant.error ?? email.error) throw error ?? existant.error ?? email.error;

  return (
    <div className="grid max-w-[640px] gap-6 max-md:gap-5">
      <div className="grid gap-1">
        <h1 className="font-display text-title font-bold max-md:text-[22px]">Déposer un avis</h1>
        {usage && (
          <span className="flex py-1 md:hidden">
            <CompteurUsage plan={entreprise.plan} usage={usage} />
          </span>
        )}
        <p className="text-secondary">
          Un scan ou une photo de l&apos;avis de contravention. Désigno lit ses informations, et vous les vérifiez
          ensuite à côté de l&apos;image.
        </p>
      </div>
      {email.data && (
        <section aria-label="Email d'origine" className="grid gap-1 rounded-card bg-surface p-4">
          <p className="font-mono text-meta font-medium text-secondary uppercase">Reçu par Gmail</p>
          <p className="font-medium">{email.data.objet ?? "(sans objet)"}</p>
          <p className="text-label text-secondary">
            {email.data.expediteur ?? "Expéditeur inconnu"} ·{" "}
            {formaterDateHeure(email.data.recu_le ?? email.data.releve_le)}
          </p>
          <p className="text-label">
            Déposez ici la pièce jointe, téléchargée depuis l&apos;email&nbsp;: l&apos;avis lui sera rattaché.{" "}
            <a href={lienGmail(email.data.boite, email.data.message_id)} target="_blank" rel="noreferrer">
              Ouvrir dans Gmail
            </a>
          </p>
        </section>
      )}
      <DepotAvis entrepriseId={entreprise.id} existant={existant.data} emailGmailId={email.data?.id ?? null} />
    </div>
  );
}
