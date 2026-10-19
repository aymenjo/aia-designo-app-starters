"use client";

import { useActionState } from "react";
import { Alerte } from "@/components/ui/Alerte";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import type { EtatAction } from "./Confirmation";
import { LienPasserEnPro } from "./LienPasserEnPro";

/** Remet un véhicule ou un conducteur archivé dans la liste, depuis sa fiche. */
export function Reactivation({ reactiver }: { reactiver: () => Promise<EtatAction> }) {
  const [etat, envoyer] = useActionState<EtatAction, FormData>(() => reactiver(), {});

  return (
    <form action={envoyer} className="grid justify-items-start gap-3">
      {etat.erreur && (
        <Alerte variante="erreur">
          <p>{etat.erreur}</p>
          {etat.invitationPro && <LienPasserEnPro />}
        </Alerte>
      )}
      <BoutonEnvoi enCours="Réactivation…">Réactiver</BoutonEnvoi>
    </form>
  );
}
