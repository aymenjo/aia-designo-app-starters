import type { ReactNode } from "react";

type Props = {
  libelle: string;
  chiffre: string;
  /** Seule la tuile des euros évités met son chiffre en vert. */
  vert?: boolean;
  /** 20 px de padding au lieu de 24 : à côté du panneau de l'agent, ou dans l'aperçu de la landing. */
  serree?: boolean;
  children: ReactNode;
};

/**
 * Tuile stat (DESIGN.md) : libellé, chiffre, sous-ligne. Les tuiles voisines alignent leurs rangées : la grille
 * parente leur donne 3 rangées chacune. Sur téléphone, en 2×2, le padding passe à 16 px et le chiffre à 28 px.
 */
export function Tuile({ libelle, chiffre, vert = false, serree = false, children }: Props) {
  return (
    <div
      role="group"
      aria-label={libelle}
      className={`row-span-3 grid grid-rows-subgrid gap-1 rounded-card border border-line bg-white max-md:p-4 ${serree ? "p-5" : "p-6"}`}
    >
      <p className="text-label text-secondary">{libelle}</p>
      <p
        className={`font-display text-stat font-extrabold whitespace-nowrap max-md:text-[28px] ${vert ? "text-ok" : "text-ink"}`}
      >
        {chiffre}
      </p>
      <p className="text-label text-secondary">{children}</p>
    </div>
  );
}
