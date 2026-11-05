import { Check } from "lucide-react";

/** « Fiche complète » en vert, ou « Incomplète · n champs » en ambre : fiche entreprise et fiche conducteur. */
export function BadgeFiche({ manquants }: { manquants: number }) {
  const classes = "inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-caption font-medium whitespace-nowrap";
  if (manquants === 0) {
    return (
      <span className={`${classes} bg-ok-tint text-ok`}>
        <Check size={14} strokeWidth={2} aria-hidden />
        Fiche complète
      </span>
    );
  }
  return (
    <span className={`${classes} bg-watch-tint text-watch`}>
      Incomplète · {manquants} champ{manquants > 1 ? "s" : ""}
    </span>
  );
}
