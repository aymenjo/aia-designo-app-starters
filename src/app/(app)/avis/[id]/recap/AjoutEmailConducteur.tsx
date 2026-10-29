"use client";

import { useState } from "react";
import { Fenetre } from "@/components/ui/Fenetre";
import type { ValeursConducteur } from "@/lib/flotte/conducteurs";
import type { EtatConducteur } from "../../../flotte/conducteurs/actions";
import { FormulaireConducteur } from "../../../flotte/conducteurs/FormulaireConducteur";

type Props = {
  /** « Karim Benali » : le titre de la fenêtre. */
  nom: string;
  /** `completerConducteur`, lié au conducteur et au seul champ Email. */
  action: (etat: EtatConducteur, formData: FormData) => Promise<EtatConducteur>;
  valeurs: ValeursConducteur;
};

/**
 * « Ajouter son email » : le seul champ Email de la fiche conducteur, dans une fenêtre, sans quitter le récap. Une fois
 * l'email enregistré, la fenêtre se ferme et la case « Prévenir … par email » s'active.
 */
export function AjoutEmailConducteur({ nom, action, valeurs }: Props) {
  const [ouverte, setOuverte] = useState(false);

  async function completer(precedent: EtatConducteur, formData: FormData) {
    const suivant = await action(precedent, formData);
    if (suivant.ok) setOuverte(false);
    return suivant;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOuverte(true)}
        className="cursor-pointer text-ink underline decoration-1 underline-offset-3 hover:decoration-2"
      >
        Ajouter son email
      </button>
      <Fenetre titre={`Email de ${nom}`} ouverte={ouverte} onFermer={() => setOuverte(false)}>
        <FormulaireConducteur action={completer} valeurs={valeurs} champs={["email"]} />
      </Fenetre>
    </>
  );
}
