import type { ReactNode } from "react";

/** Un groupe de champs d'une fiche, sous un titre. */
export function Bloc({ titre, description, children }: { titre: string; description?: string; children: ReactNode }) {
  return (
    <section className="grid gap-5 rounded-card border border-line p-6 max-md:p-5">
      <div className="grid gap-1">
        <h2 className="font-semibold">{titre}</h2>
        {description && <p className="text-label text-secondary">{description}</p>}
      </div>
      {children}
    </section>
  );
}
