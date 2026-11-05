"use client";

import { useActionState } from "react";
import type { EtatAction } from "@/components/Confirmation";
import { connecterGmail } from "./parametres/integrations/actions";

/** « Reconnecter Gmail », l'action soulignée du bandeau de la relève interrompue : la page de Google, par Composio. */
export function ReconnecterGmail() {
  const [etat, envoyer, enCours] = useActionState<EtatAction, FormData>(() => connecterGmail(), {});

  return (
    <form action={envoyer} className="flex flex-wrap items-center gap-x-3">
      <button
        type="submit"
        disabled={enCours}
        className="cursor-pointer font-medium underline decoration-1 underline-offset-3 hover:decoration-2 disabled:cursor-wait"
      >
        {enCours ? "Ouverture…" : "Reconnecter Gmail"}
      </button>
      {etat.erreur && <span className="text-label">{etat.erreur}</span>}
    </form>
  );
}
