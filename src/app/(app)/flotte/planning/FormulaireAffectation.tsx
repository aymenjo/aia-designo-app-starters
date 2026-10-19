"use client";

import { useActionState, useState } from "react";
import { Alerte } from "@/components/ui/Alerte";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { ChampDate } from "@/components/ui/ChampDate";
import { ChampHeure } from "@/components/ui/ChampHeure";
import { ChampListe } from "@/components/ui/ChampListe";
import { useVerificationALaSortie } from "@/components/ui/useVerificationALaSortie";
import type { ChoixAffectation } from "@/lib/flotte/affectations";
import {
  CHAMPS_AFFECTATION,
  nomComplet,
  verifierSaisieAffectation,
  type ChampAffectation,
} from "@/lib/flotte/regles";
import type { EtatAffectation, ValeursAffectation } from "./actions";

/** La fin se revérifie quand le début ou le véhicule change, et sa date et son heure vont ensemble. */
const DEPENDANCES: Partial<Record<ChampAffectation, readonly ChampAffectation[]>> = {
  vehicule_id: ["fin_date", "fin_heure"],
  debut_date: ["fin_date", "fin_heure"],
  debut_heure: ["fin_date", "fin_heure"],
  fin_date: ["fin_heure"],
  fin_heure: ["fin_date"],
};

const VIDE: ValeursAffectation = {
  vehicule_id: "",
  conducteur_id: "",
  debut_date: "",
  debut_heure: "",
  fin_date: "",
  fin_heure: "",
};

type Props = ChoixAffectation & {
  action: (etat: EtatAffectation, formData: FormData) => Promise<EtatAffectation>;
  /** Valeurs de départ : un véhicule ou un conducteur pré-choisi depuis sa fiche, ou l'affectation à modifier. */
  valeurs?: Partial<ValeursAffectation>;
  libelleBouton: string;
  enCours: string;
  onSucces?: () => void;
  onAnnuler?: () => void;
};

export function FormulaireAffectation({
  action,
  vehicules,
  conducteurs,
  valeurs: initiales,
  libelleBouton,
  enCours,
  onSucces,
  onAnnuler,
}: Props) {
  const [etat, envoyer] = useActionState<EtatAffectation, FormData>(
    async (precedent, formData) => {
      const suivant = await action(precedent, formData);
      if (suivant.ok) onSucces?.();
      return suivant;
    },
    { valeurs: { ...VIDE, ...initiales } },
  );
  const valeurs = { ...VIDE, ...etat.valeurs };
  const types = new Map(vehicules.map((vehicule) => [vehicule.id, vehicule.type]));
  // Le type du véhicule choisi décide si la fin est obligatoire.
  const [vehiculeId, setVehiculeId] = useState(valeurs.vehicule_id);
  const { erreur, verifierALaSortie, effacerSiCorrige } = useVerificationALaSortie({
    champs: CHAMPS_AFFECTATION,
    etat,
    verifier: (saisie) => verifierSaisieAffectation(saisie, types.get(saisie.vehicule_id)),
    dependances: DEPENDANCES,
  });

  const champ = (name: ChampAffectation) => ({ name, defaultValue: valeurs[name], erreur: erreur(name) });

  return (
    <form action={envoyer} onBlur={verifierALaSortie} onChange={effacerSiCorrige} className="grid gap-5" noValidate>
      {etat.erreurs?.general && <Alerte variante="erreur">{etat.erreurs.general}</Alerte>}

      <ChampListe
        {...champ("vehicule_id")}
        libelle="Véhicule"
        vide="Choisir un véhicule"
        options={vehicules.map(({ id, plaque, modele }) => ({
          valeur: id,
          libelle: modele ? `${plaque} · ${modele}` : plaque,
        }))}
        onChange={(e) => setVehiculeId(e.currentTarget.value)}
      />
      <ChampListe
        {...champ("conducteur_id")}
        libelle="Conducteur"
        vide="Choisir un conducteur"
        options={conducteurs.map((conducteur) => ({ valeur: conducteur.id, libelle: nomComplet(conducteur) }))}
      />

      <div className="grid grid-cols-2 gap-4">
        <ChampDate {...champ("debut_date")} libelle="Date de début" calendrier />
        <ChampHeure {...champ("debut_heure")} libelle="Heure de début" aide="Facultative : 00:00 si vide." />
        <ChampDate
          {...champ("fin_date")}
          libelle="Date de fin"
          calendrier
          aide={
            types.get(vehiculeId) === "pool"
              ? "Obligatoire pour un véhicule de pool."
              : "Laissez vide tant que le conducteur garde le véhicule."
          }
        />
        <ChampHeure {...champ("fin_heure")} libelle="Heure de fin" />
      </div>

      <div className="flex flex-wrap gap-2">
        <BoutonEnvoi enCours={enCours}>{libelleBouton}</BoutonEnvoi>
        {onAnnuler && (
          <Bouton variante="ghost" onClick={onAnnuler}>
            Annuler
          </Bouton>
        )}
      </div>
    </form>
  );
}
