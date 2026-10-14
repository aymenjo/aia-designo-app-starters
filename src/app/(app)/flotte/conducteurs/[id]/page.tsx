import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BadgeFiche } from "@/components/BadgeFiche";
import { Confirmation } from "@/components/Confirmation";
import { Reactivation } from "@/components/Reactivation";
import { Alerte } from "@/components/ui/Alerte";
import { lireAffectations, lireChoixAffectation } from "@/lib/flotte/affectations";
import { COLONNES_CONDUCTEUR, versValeurs, type Conducteur } from "@/lib/flotte/conducteurs";
import { lienPlanning } from "@/lib/flotte/planning";
import {
  LIBELLES_CHAMP_CONDUCTEUR,
  champsManquantsConducteur,
  nomComplet,
  schemaIdConducteur,
} from "@/lib/flotte/regles";
import { formaterDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { FournisseurAffectations } from "../../planning/FenetreAffectation";
import { ListeAffectations } from "../../planning/ListeAffectations";
import { NouvelleAffectation } from "../../planning/NouvelleAffectation";
import { archiverConducteur, modifierConducteur, reactiverConducteur, supprimerConducteur } from "../actions";
import { FormulaireConducteur } from "../FormulaireConducteur";

export const metadata: Metadata = { title: "Conducteur" };

export default async function FicheConducteur(props: PageProps<"/flotte/conducteurs/[id]">) {
  const { id } = await props.params;
  if (!schemaIdConducteur.safeParse(id).success) notFound();

  const supabase = await createClient();
  const [{ data: conducteur, error }, reponseAffectations, choix] = await Promise.all([
    supabase.from("conducteur").select(COLONNES_CONDUCTEUR).eq("id", id).maybeSingle<Conducteur>(),
    lireAffectations(supabase, { conducteur_id: id }),
    lireChoixAffectation(supabase),
  ]);
  if (error) throw error;
  if (reponseAffectations.error) throw reponseAffectations.error;
  if (!conducteur) notFound();

  const manquants = champsManquantsConducteur(conducteur);
  const nom = nomComplet(conducteur);
  const affectations = reponseAffectations.data ?? [];
  const historique = affectations.length > 0;

  const sectionAffectations = (
    <section className="grid gap-4 rounded-card border border-line p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h2 className="font-semibold">Affectations</h2>
          <p className="text-label text-secondary">
            Les véhicules qu&apos;il a conduits, et quand.{" "}
            <Link href={lienPlanning({ conducteur: conducteur.id })}>Voir dans le planning</Link>
          </p>
        </div>
        {!conducteur.archive_le && (
          <NouvelleAffectation variante="secondaire" valeurs={{ conducteur_id: conducteur.id }} />
        )}
      </div>
      <ListeAffectations affectations={affectations} afficher="vehicule" />
    </section>
  );

  const sectionSuppression = !historique && (
    <section className="flex flex-wrap items-center justify-between gap-4 rounded-card border border-line p-6">
      <div className="grid gap-1">
        <h2 className="font-semibold">Supprimer ce conducteur</h2>
        <p className="text-label text-secondary">Il n&apos;a aucun historique : vous pouvez effacer sa fiche.</p>
      </div>
      <Confirmation
        libelle="Supprimer ce conducteur"
        titre={`Supprimer ${nom} ?`}
        explication="Sa fiche sera effacée définitivement, sans possibilité de la réactiver."
        confirmer="Supprimer"
        enCours="Suppression…"
        action={supprimerConducteur.bind(null, conducteur.id)}
      />
    </section>
  );

  return (
    <FournisseurAffectations {...choix}>
      <div className="grid max-w-[720px] gap-6">
        <Link href="/flotte/conducteurs" className="inline-flex items-center gap-1.5 justify-self-start text-label">
          <ArrowLeft size={16} strokeWidth={1.5} aria-hidden />
          Conducteurs
        </Link>

        <header className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-title font-bold">{nom}</h1>
          <BadgeFiche manquants={manquants.length} />
          {conducteur.archive_le && (
            <span className="inline-flex h-6 items-center rounded-full border border-dashed border-gray-300 px-2.5 text-caption font-medium text-secondary">
              Archivé le {formaterDate(conducteur.archive_le)}
            </span>
          )}
        </header>

        {conducteur.archive_le ? (
          <>
            <Alerte>
              Ce conducteur est archivé : il n&apos;apparaît plus dans la liste. Réactivez-le pour modifier sa fiche.
            </Alerte>
            <Reactivation reactiver={reactiverConducteur.bind(null, conducteur.id)} />
            <FormulaireConducteur
              key="archive"
              action={modifierConducteur.bind(null, conducteur.id)}
              valeurs={versValeurs(conducteur)}
              desactive
            />
            {sectionAffectations}
            {sectionSuppression}
          </>
        ) : (
          <>
            {manquants.length > 0 && (
              <Alerte>
                <p className="font-medium">Pour ouvrir le récap ANTAI, complétez&nbsp;:</p>
                <ul className="list-disc pl-5">
                  {manquants.map((champ) => (
                    <li key={champ}>{LIBELLES_CHAMP_CONDUCTEUR[champ]}</li>
                  ))}
                </ul>
              </Alerte>
            )}
            <FormulaireConducteur
              key="actif"
              action={modifierConducteur.bind(null, conducteur.id)}
              valeurs={versValeurs(conducteur)}
            />
            {sectionAffectations}
            <section className="flex flex-wrap items-center justify-between gap-4 rounded-card border border-line p-6">
              <div className="grid gap-1">
                <h2 className="font-semibold">Archiver ce conducteur</h2>
                <p className="text-label text-secondary">
                  Il disparaîtra de la liste, et vous pourrez le réactiver depuis cette fiche.
                  {historique && " Il a un historique : il ne peut pas être supprimé."}
                </p>
              </div>
              <Confirmation
                libelle="Archiver ce conducteur"
                titre={`Archiver ${nom} ?`}
                explication="Il disparaîtra de la liste et ne sera plus proposé. Son historique reste consultable, et vous pourrez le réactiver depuis cette fiche."
                confirmer="Archiver"
                enCours="Archivage…"
                action={archiverConducteur.bind(null, conducteur.id)}
              />
            </section>
            {sectionSuppression}
          </>
        )}
      </div>
    </FournisseurAffectations>
  );
}
