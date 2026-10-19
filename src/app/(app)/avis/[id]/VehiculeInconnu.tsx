"use client";

import { useState } from "react";
import { Plaque } from "@/components/Plaque";
import { Bloc } from "@/components/ui/Bloc";
import { Bouton } from "@/components/ui/Bouton";
import { Fenetre } from "@/components/ui/Fenetre";
import type { EtatVehicule } from "../../flotte/vehicules/actions";
import { FormulaireVehicule } from "../../flotte/vehicules/FormulaireVehicule";
import type { EtatClassement } from "../actions";
import { ClassementAvis } from "./ClassementAvis";

type Props = {
  plaque: string;
  /** Crée le véhicule avec la plaque de l'avis : seuls le modèle et le type se saisissent. */
  creer: (etat: EtatVehicule, formData: FormData) => Promise<EtatVehicule>;
  classer: (etat: EtatClassement, formData: FormData) => Promise<EtatClassement>;
};

/** Un avis « À valider » dont la plaque n'est celle d'aucun véhicule : créer le véhicule, ou classer l'avis. */
export function VehiculeInconnu({ plaque, creer, classer }: Props) {
  const [ouverte, setOuverte] = useState(false);

  return (
    <Bloc titre="Véhicule inconnu" description="Aucun véhicule de votre flotte ne porte cette plaque.">
      <div className="grid gap-2">
        <span>
          <Plaque plaque={plaque} />
        </span>
        <p className="text-secondary">
          Mal lue&nbsp;? Corrigez-la dans les champs de l&apos;avis. Sinon, créez le véhicule pour retrouver son
          conducteur, ou classez l&apos;avis s&apos;il ne donne pas lieu à désignation&nbsp;: véhicule volé, plaque
          usurpée…
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Bouton onClick={() => setOuverte(true)}>Créer le véhicule</Bouton>
        <ClassementAvis action={classer} designe={false} />
      </div>
      <Fenetre titre="Créer le véhicule" ouverte={ouverte} onFermer={() => setOuverte(false)}>
        <FormulaireVehicule
          action={creer}
          plaqueFixe={plaque}
          libelleBouton="Créer"
          enCours="Création…"
          onSucces={() => setOuverte(false)}
        />
      </Fenetre>
    </Bloc>
  );
}
