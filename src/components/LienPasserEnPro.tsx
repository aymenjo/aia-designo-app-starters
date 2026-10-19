import Link from "next/link";

/** « Passer en Pro » : l'écran Abonnement, d'où le paiement s'ouvrira (phase 18). */
export function LienPasserEnPro() {
  return (
    <Link href="/parametres/abonnement" className="justify-self-start font-medium">
      Passer en Pro
    </Link>
  );
}
