import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BadgeEcheanceDepassee } from "@/components/BadgeEcheanceDepassee";
import { StatutAvis } from "@/components/StatutAvis";
import { Alerte } from "@/components/ui/Alerte";
import { lireAvis, urlFichier, versValeurs } from "@/lib/avis/avis";
import { echeanceDepassee } from "@/lib/avis/echeance";
import { champsAConfirmer, champsManquantsAvis, schemaIdAvis } from "@/lib/avis/regles";
import { formaterDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { enregistrerAvis } from "../actions";
import { FormulaireAvis } from "./FormulaireAvis";
import { VisionneuseAvis } from "./VisionneuseAvis";

export const metadata: Metadata = { title: "Avis" };

export default async function PageAvis(props: PageProps<"/avis/[id]">) {
  const { id } = await props.params;
  if (!schemaIdAvis.safeParse(id).success) notFound();

  const supabase = await createClient();
  const { data: avis, error } = await lireAvis(supabase, id);
  if (error) throw error;
  if (!avis) notFound();
  const url = await urlFichier(supabase, avis.fichier);

  return (
    <div className="grid gap-6">
      <Link href="/avis" className="inline-flex items-center gap-1.5 justify-self-start text-label">
        <ArrowLeft size={16} strokeWidth={1.5} aria-hidden />
        Avis
      </Link>

      <header className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-title font-bold">
          {avis.numero ? (
            <>
              Avis n° <span className="font-mono font-medium tracking-normal">{avis.numero}</span>
            </>
          ) : (
            `Avis déposé le ${formaterDate(avis.depose_le)}`
          )}
        </h1>
        <StatutAvis statut={avis.statut} />
        {echeanceDepassee(avis) && <BadgeEcheanceDepassee />}
      </header>

      {avis.lecture_ia === "echec" && (
        <Alerte>
          Désigno n&apos;a pas pu lire cet avis&nbsp;: saisissez ses champs à la main, en vous aidant de l&apos;image.
        </Alerte>
      )}

      {/* L'image à gauche reste visible pendant que l'on parcourt les champs. */}
      <div className="grid items-start gap-6 lg:grid-cols-12">
        <div className="lg:sticky lg:top-8 lg:col-span-7">
          <VisionneuseAvis url={url} type={avis.fichier_type} />
        </div>
        <div className="lg:col-span-5">
          <FormulaireAvis
            action={enregistrerAvis.bind(null, avis.id)}
            valeurs={versValeurs(avis)}
            plaque={avis.plaque}
            vehicule={avis.vehicule}
            manquants={avis.statut === "a_traiter" ? champsManquantsAvis(avis) : []}
            confiances={avis.confiances}
            aConfirmer={champsAConfirmer(avis)}
            refusees={avis.valeurs_refusees}
          />
        </div>
      </div>
    </div>
  );
}
