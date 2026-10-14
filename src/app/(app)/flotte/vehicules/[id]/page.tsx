import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Confirmation } from "@/components/Confirmation";
import { Plaque } from "@/components/Plaque";
import { Reactivation } from "@/components/Reactivation";
import { Alerte } from "@/components/ui/Alerte";
import { lireAffectations, lireChoixAffectation } from "@/lib/flotte/affectations";
import { lienPlanning } from "@/lib/flotte/planning";
import { schemaIdVehicule } from "@/lib/flotte/regles";
import { COLONNES_VEHICULE, type Vehicule } from "@/lib/flotte/vehicules";
import { formaterDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { FournisseurAffectations } from "../../planning/FenetreAffectation";
import { ListeAffectations } from "../../planning/ListeAffectations";
import { NouvelleAffectation } from "../../planning/NouvelleAffectation";
import { archiverVehicule, modifierVehicule, reactiverVehicule, supprimerVehicule } from "../actions";
import { FormulaireVehicule } from "../FormulaireVehicule";
import { PastilleType } from "../PastilleType";

export const metadata: Metadata = { title: "Véhicule" };

export default async function FicheVehicule(props: PageProps<"/flotte/vehicules/[id]">) {
  const { id } = await props.params;
  if (!schemaIdVehicule.safeParse(id).success) notFound();

  const supabase = await createClient();
  const [{ data: vehicule, error }, affectations, choix] = await Promise.all([
    supabase.from("vehicule").select(COLONNES_VEHICULE).eq("id", id).maybeSingle<Vehicule>(),
    lireAffectations(supabase, { vehicule_id: id }),
    lireChoixAffectation(supabase),
  ]);
  if (error) throw error;
  if (affectations.error) throw affectations.error;
  if (!vehicule) notFound();

  const valeurs = { plaque: vehicule.plaque, modele: vehicule.modele ?? "", type: vehicule.type };
  const historique = (affectations.data ?? []).length > 0;

  const sectionAffectations = (
    <section className="grid gap-4 rounded-card border border-line p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h2 className="font-semibold">Affectations</h2>
          <p className="text-label text-secondary">
            Qui a conduit ce véhicule, et quand. <Link href={lienPlanning({ vehicule: vehicule.id })}>Voir dans le planning</Link>
          </p>
        </div>
        {!vehicule.archive_le && <NouvelleAffectation variante="secondaire" valeurs={{ vehicule_id: vehicule.id }} />}
      </div>
      <ListeAffectations affectations={affectations.data ?? []} afficher="conducteur" />
    </section>
  );

  const sectionSuppression = !historique && (
    <section className="flex flex-wrap items-center justify-between gap-4 rounded-card border border-line p-6">
      <div className="grid gap-1">
        <h2 className="font-semibold">Supprimer ce véhicule</h2>
        <p className="text-label text-secondary">Il n&apos;a aucun historique : vous pouvez l&apos;effacer.</p>
      </div>
      <Confirmation
        libelle="Supprimer ce véhicule"
        titre={`Supprimer ${vehicule.plaque} ?`}
        explication="Il sera effacé définitivement, sans possibilité de le réactiver."
        confirmer="Supprimer"
        enCours="Suppression…"
        action={supprimerVehicule.bind(null, vehicule.id)}
      />
    </section>
  );

  return (
    <FournisseurAffectations {...choix}>
      <div className="grid max-w-[640px] gap-6">
        <Link href="/flotte/vehicules" className="inline-flex items-center gap-1.5 justify-self-start text-label">
          <ArrowLeft size={16} strokeWidth={1.5} aria-hidden />
          Véhicules
        </Link>

        <header className="flex flex-wrap items-center gap-3">
          <h1>
            <Plaque plaque={vehicule.plaque} grand />
          </h1>
          <PastilleType type={vehicule.type} />
          {vehicule.archive_le && (
            <span className="inline-flex h-6 items-center rounded-full border border-dashed border-gray-300 px-2.5 text-caption font-medium text-secondary">
              Archivé le {formaterDate(vehicule.archive_le)}
            </span>
          )}
        </header>

        {vehicule.archive_le ? (
          <>
            <Alerte>
              Ce véhicule est archivé : il n&apos;apparaît plus dans la liste. Réactivez-le pour le modifier.
            </Alerte>
            <Reactivation reactiver={reactiverVehicule.bind(null, vehicule.id)} />
            <section className="rounded-card border border-line p-6">
              <FormulaireVehicule
                key="archive"
                action={modifierVehicule.bind(null, vehicule.id)}
                valeurs={valeurs}
                libelleBouton="Enregistrer"
                enCours="Enregistrement…"
                desactive
              />
            </section>
            {sectionAffectations}
            {sectionSuppression}
          </>
        ) : (
          <>
            <section className="rounded-card border border-line p-6">
              <FormulaireVehicule
                key="actif"
                action={modifierVehicule.bind(null, vehicule.id)}
                valeurs={valeurs}
                libelleBouton="Enregistrer"
                enCours="Enregistrement…"
                messageSucces="Modifications enregistrées."
              />
            </section>
            {sectionAffectations}
            <section className="flex flex-wrap items-center justify-between gap-4 rounded-card border border-line p-6">
              <div className="grid gap-1">
                <h2 className="font-semibold">Archiver ce véhicule</h2>
                <p className="text-label text-secondary">
                  Il disparaîtra de la liste, et vous pourrez le réactiver depuis cette fiche.
                  {historique && " Il a un historique : il ne peut pas être supprimé."}
                </p>
              </div>
              <Confirmation
                libelle="Archiver ce véhicule"
                titre={`Archiver ${vehicule.plaque} ?`}
                explication="Il disparaîtra de la liste. Son historique reste consultable, et vous pourrez le réactiver depuis cette fiche."
                confirmer="Archiver"
                enCours="Archivage…"
                action={archiverVehicule.bind(null, vehicule.id)}
              />
            </section>
            {sectionSuppression}
          </>
        )}
      </div>
    </FournisseurAffectations>
  );
}
