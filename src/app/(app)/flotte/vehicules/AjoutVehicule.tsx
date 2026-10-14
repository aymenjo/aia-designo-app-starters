"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { Bouton } from "@/components/ui/Bouton";
import { Fenetre } from "@/components/ui/Fenetre";
import { ajouterVehicule } from "./actions";
import { FormulaireVehicule } from "./FormulaireVehicule";

export function AjoutVehicule() {
  const [ouverte, setOuverte] = useState(false);

  return (
    <>
      <Bouton onClick={() => setOuverte(true)}>
        <Plus size={16} strokeWidth={1.5} aria-hidden />
        Ajouter un véhicule
      </Bouton>
      <Fenetre titre="Ajouter un véhicule" ouverte={ouverte} onFermer={() => setOuverte(false)}>
        <FormulaireVehicule
          action={ajouterVehicule}
          libelleBouton="Ajouter"
          enCours="Ajout…"
          onSucces={() => setOuverte(false)}
        />
      </Fenetre>
    </>
  );
}
