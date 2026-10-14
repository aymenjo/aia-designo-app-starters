import type { Metadata } from "next";

export const metadata: Metadata = { title: "Tableau de bord" };

export default function TableauDeBord() {
  return (
    <div className="grid gap-6">
      <h1 className="font-display text-title font-bold">Tableau de bord</h1>
      <section className="grid gap-2 rounded-panel border border-line p-8 max-md:p-6">
        <h2 className="text-lead font-semibold">Votre espace est prêt</h2>
        <p className="max-w-[560px] text-secondary">
          Vous suivrez ici vos avis de contravention et leurs échéances de désignation, pour que rien ne vous
          échappe.
        </p>
      </section>
    </div>
  );
}
