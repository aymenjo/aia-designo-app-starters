"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const INTERVALLE_MS = 2_000;
const ATTENTE_MAX_MS = 30_000;

/**
 * Au retour de Stripe, le paiement est fait, mais seul le webhook passe le compte en Pro : l'écran se relit toutes les
 * 2 secondes, 30 secondes au plus. Une fois le compte en Pro, la page n'affiche plus ce message.
 */
export function AttenteActivation() {
  const router = useRouter();
  const [tropLong, setTropLong] = useState(false);

  useEffect(() => {
    const debut = Date.now();
    const minuterie = setInterval(() => {
      if (Date.now() - debut >= ATTENTE_MAX_MS) {
        clearInterval(minuterie);
        setTropLong(true);
        return;
      }
      router.refresh();
    }, INTERVALLE_MS);
    return () => clearInterval(minuterie);
  }, [router]);

  return (
    <section role="status" className="grid gap-1">
      <p className="font-semibold">Activation du Pro…</p>
      <p className="text-label text-secondary">
        {tropLong
          ? "L'activation prend plus de temps que prévu. Rechargez la page dans quelques minutes."
          : "Le paiement est fait : Stripe le confirme à Désigno, en général en quelques secondes."}
      </p>
    </section>
  );
}
