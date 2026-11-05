"use client";

import { useActionState, type ReactNode } from "react";
import type { EtatAction } from "@/components/Confirmation";
import { Alerte } from "@/components/ui/Alerte";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";

type Props = {
  /** `ouvrirPaiement` ou `ouvrirPortail` : redirige vers Stripe, ou renvoie le refus. */
  action: () => Promise<EtatAction>;
  /** Le texte du bouton pendant l'ouverture : « Ouverture du paiement… ». */
  enCours: string;
  variante?: "primaire" | "secondaire";
  /** La précision à côté du bouton : où mène le clic. */
  precision: ReactNode;
  children: ReactNode;
};

/** « Passer en Pro », « Gérer mon abonnement » : le bouton qui ouvre une page sécurisée de Stripe. */
export function BoutonStripe({ action, enCours, variante, precision, children }: Props) {
  const [etat, envoyer] = useActionState<EtatAction, FormData>(() => action(), {});

  return (
    <form action={envoyer} className="grid gap-3">
      {etat.erreur && <Alerte variante="erreur">{etat.erreur}</Alerte>}
      <div className="flex flex-wrap items-center gap-3">
        <BoutonEnvoi variante={variante} enCours={enCours}>
          {children}
        </BoutonEnvoi>
        <p className="text-label text-secondary">{precision}</p>
      </div>
    </form>
  );
}
