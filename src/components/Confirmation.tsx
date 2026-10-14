"use client";

import { useActionState, useState } from "react";
import { Alerte } from "@/components/ui/Alerte";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { Fenetre } from "@/components/ui/Fenetre";

/** Réponse d'une action confirmée (archiver, supprimer) ou d'une réactivation. */
export type EtatAction = { erreur?: string };

type Props = {
  /** Le bouton de la fiche : « Archiver ce véhicule ». */
  libelle: string;
  /** Le titre de la fenêtre : « Archiver AB-123-CD ? ». */
  titre: string;
  explication: string;
  /** Le bouton de la fenêtre et son texte pendant l'envoi : « Archiver », « Archivage… ». */
  confirmer: string;
  enCours: string;
  action: () => Promise<EtatAction>;
};

/** Archiver ou supprimer un véhicule ou un conducteur : confirmation dans une fenêtre, jamais par `confirm()`. */
export function Confirmation({ libelle, titre, explication, confirmer, enCours, action }: Props) {
  const [ouverte, setOuverte] = useState(false);
  const [etat, envoyer] = useActionState<EtatAction, FormData>(() => action(), {});

  return (
    <>
      <Bouton variante="secondaire" onClick={() => setOuverte(true)}>
        {libelle}
      </Bouton>
      <Fenetre titre={titre} ouverte={ouverte} onFermer={() => setOuverte(false)}>
        <p className="text-secondary">{explication}</p>
        {etat.erreur && <Alerte variante="erreur">{etat.erreur}</Alerte>}
        <form action={envoyer} className="flex flex-wrap gap-2">
          <BoutonEnvoi enCours={enCours}>{confirmer}</BoutonEnvoi>
          <Bouton variante="ghost" onClick={() => setOuverte(false)}>
            Annuler
          </Bouton>
        </form>
      </Fenetre>
    </>
  );
}
