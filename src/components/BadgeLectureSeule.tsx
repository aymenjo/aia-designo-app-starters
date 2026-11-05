import { Lock } from "lucide-react";

/**
 * « Lecture seule » sur gris, avec un cadenas, comme « Verrouillé » : un véhicule au-delà des 3 véhicules actifs du plan
 * Free, au retour en Free. Il reste visible, mais ne se modifie plus et ne reçoit plus d'affectation.
 */
export function BadgeLectureSeule() {
  return (
    <span className="inline-flex h-6 items-center gap-1 rounded-full bg-band px-2.5 text-caption font-medium whitespace-nowrap text-secondary">
      <Lock size={14} strokeWidth={1.5} aria-hidden />
      Lecture seule
    </span>
  );
}
