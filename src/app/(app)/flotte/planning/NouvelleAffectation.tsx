"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Alerte } from "@/components/ui/Alerte";
import { Bouton } from "@/components/ui/Bouton";
import { Fenetre } from "@/components/ui/Fenetre";
import { ajouterAffectation, type ValeursAffectation } from "./actions";
import { useChoixAffectation } from "./FenetreAffectation";
import { FormulaireAffectation } from "./FormulaireAffectation";

type Props = {
  /** Le véhicule ou le conducteur de la fiche, ou du filtre du planning. */
  valeurs?: Partial<ValeursAffectation>;
  variante?: "primaire" | "secondaire";
};

export function NouvelleAffectation({ valeurs, variante }: Props) {
  const { choix } = useChoixAffectation();
  const [ouverte, setOuverte] = useState(false);

  return (
    <>
      <Bouton variante={variante} onClick={() => setOuverte(true)}>
        <Plus size={16} strokeWidth={1.5} aria-hidden />
        Nouvelle affectation
      </Bouton>
      <Fenetre titre="Nouvelle affectation" ouverte={ouverte} onFermer={() => setOuverte(false)}>
        {!choix.vehicules.length ? (
          <Alerte>
            Ajoutez d&apos;abord un véhicule à votre flotte. <Link href="/flotte/vehicules">Véhicules</Link>
          </Alerte>
        ) : !choix.conducteurs.length ? (
          <Alerte>
            Ajoutez d&apos;abord un conducteur. <Link href="/flotte/conducteurs">Conducteurs</Link>
          </Alerte>
        ) : (
          <FormulaireAffectation
            {...choix}
            action={ajouterAffectation}
            valeurs={valeurs}
            libelleBouton="Enregistrer"
            enCours="Enregistrement…"
            onSucces={() => setOuverte(false)}
          />
        )}
      </Fenetre>
    </>
  );
}
