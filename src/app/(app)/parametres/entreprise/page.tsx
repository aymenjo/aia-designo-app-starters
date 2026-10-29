import type { Metadata } from "next";
import { BadgeFiche } from "@/components/BadgeFiche";
import { Alerte } from "@/components/ui/Alerte";
import type { Plan } from "@/lib/abonnement/plans";
import { lireFiche, versValeurs, versValeursDirection } from "@/lib/entreprise/fiche";
import { LIBELLES_CHAMP, champsManquants } from "@/lib/entreprise/regles";
import { createClient } from "@/lib/supabase/server";
import { enregistrerEntreprise } from "./actions";
import { FormulaireEntreprise } from "./FormulaireEntreprise";

export const metadata: Metadata = { title: "Fiche entreprise" };

export default async function FicheEntreprise() {
  const supabase = await createClient();
  const [fiche, entreprise] = await Promise.all([
    lireFiche(supabase),
    supabase.from("entreprise").select("plan").single<{ plan: Plan }>(),
  ]);
  if (entreprise.error) throw entreprise.error;
  const manquants = champsManquants(fiche);

  return (
    <div className="grid max-w-[720px] gap-6">
      <header className="grid gap-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-title font-bold">Fiche entreprise</h1>
          <BadgeFiche manquants={manquants.length} />
        </div>
        <p className="text-secondary">Ces informations figurent sur le récap ANTAI et sur vos factures.</p>
      </header>

      {manquants.length > 0 && (
        <Alerte>
          <p className="font-medium">Pour ouvrir le récap ANTAI et passer en Pro, complétez&nbsp;:</p>
          <ul className="list-disc pl-5">
            {manquants.map((champ) => (
              <li key={champ}>{LIBELLES_CHAMP[champ]}</li>
            ))}
          </ul>
        </Alerte>
      )}

      <FormulaireEntreprise
        action={enregistrerEntreprise}
        valeurs={versValeurs(fiche)}
        direction={{ plan: entreprise.data.plan, valeurs: versValeursDirection(fiche.emails_direction) }}
      />
    </div>
  );
}
