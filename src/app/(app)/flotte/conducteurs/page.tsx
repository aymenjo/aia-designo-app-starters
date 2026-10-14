import { Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { BadgeFiche } from "@/components/BadgeFiche";
import { COLONNES_CONDUCTEUR, type Conducteur } from "@/lib/flotte/conducteurs";
import { champsManquantsConducteur, nomComplet } from "@/lib/flotte/regles";
import { createClient } from "@/lib/supabase/server";
import { AjoutConducteur } from "./AjoutConducteur";

export const metadata: Metadata = { title: "Conducteurs" };

const COLONNES = "grid grid-cols-[minmax(0,1fr)_168px_minmax(0,1fr)_152px] items-center gap-3 px-4";

const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? "s" : ""}`;

export default async function Conducteurs() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("conducteur")
    .select(COLONNES_CONDUCTEUR)
    .is("archive_le", null)
    .order("nom")
    .order("prenom")
    .overrideTypes<Conducteur[], { merge: false }>();
  if (error) throw error;
  const conducteurs = (data ?? []).map((conducteur) => ({
    ...conducteur,
    manquants: champsManquantsConducteur(conducteur).length,
  }));

  if (!conducteurs.length) {
    return (
      <div className="grid gap-6">
        <h1 className="font-display text-title font-bold">Conducteurs</h1>
        <section className="grid justify-items-start gap-4 rounded-panel border border-line p-8 max-md:p-6">
          <Users size={20} strokeWidth={1.5} aria-hidden className="text-secondary" />
          <div className="grid gap-2">
            <h2 className="text-lead font-semibold">Aucun conducteur pour l&apos;instant</h2>
            <p className="max-w-[560px] text-secondary">
              Ajoutez les conducteurs de votre flotte avec leur permis : leur fiche complète remplit le récap ANTAI,
              sans rien recopier le jour où un avis arrive.
            </p>
          </div>
          <AjoutConducteur />
        </section>
      </div>
    );
  }

  const incompletes = conducteurs.filter((conducteur) => conducteur.manquants > 0).length;

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-0.5">
          <h1 className="font-display text-title font-bold">Conducteurs</h1>
          <p className="text-secondary">
            {pluriel(conducteurs.length, "conducteur")}
            {incompletes > 0 && ` · ${pluriel(incompletes, "fiche")} incomplète${incompletes > 1 ? "s" : ""}`}
          </p>
        </div>
        <AjoutConducteur />
      </div>

      <div className="overflow-hidden rounded-card border border-line">
        <div
          aria-hidden
          className={`${COLONNES} h-8 border-b border-line bg-surface font-mono text-meta font-medium text-secondary uppercase`}
        >
          <span>Conducteur</span>
          <span>Permis</span>
          <span>Email</span>
          <span>Fiche</span>
        </div>
        <ul className="divide-y divide-line">
          {conducteurs.map((conducteur) => (
            <li key={conducteur.id}>
              <Link
                href={`/flotte/conducteurs/${conducteur.id}`}
                className={`${COLONNES} min-h-13 no-underline transition-colors duration-120 ease-enter hover:bg-surface`}
              >
                <span className="truncate font-medium">{nomComplet(conducteur)}</span>
                <span className={`truncate ${conducteur.permis_numero ? "font-mono font-medium" : "text-secondary"}`}>
                  {conducteur.permis_numero ?? "—"}
                </span>
                <span className={`truncate ${conducteur.email ? "" : "text-secondary"}`}>{conducteur.email ?? "—"}</span>
                <span>
                  <BadgeFiche manquants={conducteur.manquants} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
