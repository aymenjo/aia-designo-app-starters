"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { CadenasPro } from "@/components/CadenasPro";
import { Bouton } from "@/components/ui/Bouton";
import { Fenetre } from "@/components/ui/Fenetre";
import { MESSAGES } from "@/lib/flotte/regles";
import { ajouterVehicule } from "./actions";
import { FormulaireVehicule } from "./FormulaireVehicule";

/** `limiteAtteinte` : en Free, la flotte a déjà ses 3 véhicules actifs ; la fenêtre invite à passer en Pro. */
export function AjoutVehicule({ limiteAtteinte = false }: { limiteAtteinte?: boolean }) {
  const [ouverte, setOuverte] = useState(false);

  return (
    <>
      <Bouton onClick={() => setOuverte(true)}>
        <Plus size={16} strokeWidth={1.5} aria-hidden />
        Ajouter un véhicule
      </Bouton>
      <Fenetre titre="Ajouter un véhicule" ouverte={ouverte} onFermer={() => setOuverte(false)}>
        {limiteAtteinte ? (
          <CadenasPro fonction="Véhicules illimités">
            <p>{MESSAGES.limiteVehicules}</p>
          </CadenasPro>
        ) : (
          <FormulaireVehicule
            action={ajouterVehicule}
            libelleBouton="Ajouter"
            enCours="Ajout…"
            onSucces={() => setOuverte(false)}
          />
        )}
      </Fenetre>
    </>
  );
}
