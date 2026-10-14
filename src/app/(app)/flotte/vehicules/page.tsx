import { FileUp, Truck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Plaque } from "@/components/Plaque";
import { classesBouton } from "@/components/ui/Bouton";
import { COLONNES_VEHICULE, type Vehicule } from "@/lib/flotte/vehicules";
import { createClient } from "@/lib/supabase/server";
import { AjoutVehicule } from "./AjoutVehicule";
import { PastilleType } from "./PastilleType";

export const metadata: Metadata = { title: "Véhicules" };

const COLONNES = "grid grid-cols-[148px_minmax(0,1fr)_96px] items-center gap-3 px-4";

export default async function Vehicules() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vehicule")
    .select(COLONNES_VEHICULE)
    .is("archive_le", null)
    .order("plaque")
    .overrideTypes<Vehicule[], { merge: false }>();
  if (error) throw error;
  const vehicules = data ?? [];

  const actions = (
    <div className="flex flex-wrap gap-2">
      <AjoutVehicule />
      <Link href="/flotte/import" className={classesBouton({ variante: "secondaire" })}>
        <FileUp size={16} strokeWidth={1.5} aria-hidden />
        Importer un fichier
      </Link>
    </div>
  );

  if (!vehicules.length) {
    return (
      <div className="grid gap-6">
        <h1 className="font-display text-title font-bold">Véhicules</h1>
        <section className="grid justify-items-start gap-4 rounded-panel border border-line p-8 max-md:p-6">
          <Truck size={20} strokeWidth={1.5} aria-hidden className="text-secondary" />
          <div className="grid gap-2">
            <h2 className="text-lead font-semibold">Aucun véhicule pour l&apos;instant</h2>
            <p className="max-w-[560px] text-secondary">
              Ajoutez les véhicules de votre flotte : Désigno rattache chaque avis au véhicule flashé grâce à sa
              plaque, puis retrouve qui le conduisait.
            </p>
          </div>
          {actions}
        </section>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-0.5">
          <h1 className="font-display text-title font-bold">Véhicules</h1>
          <p className="text-secondary">
            {vehicules.length} véhicule{vehicules.length > 1 ? "s" : ""}
          </p>
        </div>
        {actions}
      </div>

      <div className="overflow-hidden rounded-card border border-line">
        <div
          aria-hidden
          className={`${COLONNES} h-8 border-b border-line bg-surface font-mono text-meta font-medium text-secondary uppercase`}
        >
          <span>Plaque</span>
          <span>Modèle</span>
          <span>Type</span>
        </div>
        <ul className="divide-y divide-line">
          {vehicules.map((vehicule) => (
            <li key={vehicule.id}>
              <Link
                href={`/flotte/vehicules/${vehicule.id}`}
                className={`${COLONNES} min-h-13 no-underline transition-colors duration-120 ease-enter hover:bg-surface`}
              >
                <span>
                  <Plaque plaque={vehicule.plaque} />
                </span>
                <span className={`truncate ${vehicule.modele ? "" : "text-secondary"}`}>{vehicule.modele ?? "—"}</span>
                <span>
                  <PastilleType type={vehicule.type} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
