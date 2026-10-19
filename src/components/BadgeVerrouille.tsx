import { Lock } from "lucide-react";

/** « Verrouillé » sur gris, avec un cadenas : un avis Free au-delà du quota du mois, qui attend son déverrouillage. */
export function BadgeVerrouille() {
  return (
    <span className="inline-flex h-6 items-center gap-1 rounded-full bg-band px-2.5 text-caption font-medium whitespace-nowrap text-secondary">
      <Lock size={14} strokeWidth={1.5} aria-hidden />
      Verrouillé
    </span>
  );
}
