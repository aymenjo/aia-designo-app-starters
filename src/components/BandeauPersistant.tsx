import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Le bandeau persistant (DESIGN.md) : un paiement en échec (phase 19), et la relève Gmail interrompue (phase 23). Teinte
 * rouge, filet rouge en bas, et une action soulignée. Il reste affiché jusqu'à la résolution, et ne se ferme pas.
 */
export function BandeauPersistant({ children, action }: { children: ReactNode; action: ReactNode }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-urgent-fill bg-urgent-tint py-2.5 pr-6 pl-8 text-urgent max-md:px-4"
    >
      <CircleAlert size={16} strokeWidth={1.5} aria-hidden className="flex-none" />
      <p className="min-w-0">{children}</p>
      {action}
    </div>
  );
}
