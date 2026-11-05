import { Lock } from "lucide-react";
import type { ReactNode } from "react";
import { LienPasserEnPro } from "./LienPasserEnPro";
import { PastillePlan } from "./PastillePlan";

type Props = {
  /** Le nom de la fonction : « Historique complet ». */
  fonction: string;
  /** La phrase d'explication. */
  children: ReactNode;
  /** Sans lien sur l'écran Abonnement, qui porte déjà « Passer en Pro ». */
  lien?: boolean;
};

/** Le cadenas d'une fonction Pro (DESIGN.md) : ce que le gestionnaire obtiendra en passant en Pro, et le lien pour y aller. */
export function CadenasPro({ fonction, children, lien = true }: Props) {
  return (
    <div role="group" aria-label={fonction} className="flex gap-3 rounded-card bg-surface p-4">
      <span className="grid size-8 flex-none place-items-center rounded-full border border-line bg-white text-secondary">
        <Lock size={16} strokeWidth={1.5} aria-hidden />
      </span>
      <div className="grid min-w-0 content-start gap-1">
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{fonction}</span>
          <PastillePlan plan="pro" />
        </p>
        <div className="grid gap-1 text-secondary">{children}</div>
        {lien && <LienPasserEnPro />}
      </div>
    </div>
  );
}
