import type { Metadata } from "next";
import { schemaIdAvis } from "@/lib/avis/regles";
import { createClient } from "@/lib/supabase/server";
import { DepotAvis } from "./DepotAvis";

export const metadata: Metadata = { title: "Déposer un avis" };

// Vaut aussi pour les server actions de la page : la lecture IA, juste après le dépôt, peut prendre une minute
// (une relance comprise, voir lecteur-claude.ts).
export const maxDuration = 120;

export default async function NouvelAvis(props: PageProps<"/avis/nouveau">) {
  const idExistant = schemaIdAvis.safeParse((await props.searchParams).existant);
  const supabase = await createClient();
  // Le dossier de l'entreprise dans le bucket : le navigateur y envoie le fichier.
  // Après un dépôt abandonné, l'avis qui portait déjà son n°, relu sous RLS : un id inconnu est ignoré.
  const [{ data: entreprise, error }, existant] = await Promise.all([
    supabase.from("entreprise").select("id").single<{ id: string }>(),
    idExistant.success
      ? supabase
          .from("avis")
          .select("id, numero")
          .eq("id", idExistant.data)
          .not("numero", "is", null)
          .maybeSingle<{ id: string; numero: string }>()
      : { data: null, error: null },
  ]);
  if (error ?? existant.error) throw error ?? existant.error;

  return (
    <div className="grid max-w-[640px] gap-6 max-md:gap-5">
      <div className="grid gap-1">
        <h1 className="font-display text-title font-bold max-md:text-[22px]">Déposer un avis</h1>
        <p className="text-secondary">
          Un scan ou une photo de l&apos;avis de contravention. Désigno lit ses informations, et vous les vérifiez
          ensuite à côté de l&apos;image.
        </p>
      </div>
      <DepotAvis entrepriseId={entreprise.id} existant={existant.data} />
    </div>
  );
}
