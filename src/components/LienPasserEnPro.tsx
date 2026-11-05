import Link from "next/link";

/** « Passer en Pro » : l'écran Abonnement, d'où s'ouvre le paiement par Stripe. */
export function LienPasserEnPro() {
  return (
    <Link href="/parametres/abonnement" className="justify-self-start font-medium">
      Passer en Pro
    </Link>
  );
}
