"use client";

import { useActionState } from "react";
import type { EtatAction } from "@/components/Confirmation";
import { ouvrirPortail } from "./parametres/abonnement/actions";

/** « Mettre à jour ma carte », l'action soulignée du bandeau d'impayé : le portail client de Stripe. */
export function MettreAJourCarte() {
  const [etat, envoyer, enCours] = useActionState<EtatAction, FormData>(() => ouvrirPortail(), {});

  return (
    <form action={envoyer} className="flex flex-wrap items-center gap-x-3">
      <button
        type="submit"
        disabled={enCours}
        className="cursor-pointer font-medium underline decoration-1 underline-offset-3 hover:decoration-2 disabled:cursor-wait"
      >
        {enCours ? "Ouverture…" : "Mettre à jour ma carte"}
      </button>
      {etat.erreur && <span className="text-label">{etat.erreur}</span>}
    </form>
  );
}
