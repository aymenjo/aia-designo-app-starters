"use client";

import { useActionState } from "react";
import type { EtatAction } from "@/components/Confirmation";
import { Alerte } from "@/components/ui/Alerte";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";

/** « J'ai désigné sur l'ANTAI » : le seul geste qui passe l'avis « Désigné ». Désigno ne transmet rien à l'ANTAI. */
export function DesignationAntai({ action }: { action: () => Promise<EtatAction> }) {
  const [etat, envoyer] = useActionState<EtatAction, FormData>(() => action(), {});

  return (
    <form action={envoyer} className="grid gap-4">
      {etat.erreur && <Alerte variante="erreur">{etat.erreur}</Alerte>}
      <div>
        <BoutonEnvoi enCours="Enregistrement…">J&apos;ai désigné sur l&apos;ANTAI</BoutonEnvoi>
      </div>
    </form>
  );
}
