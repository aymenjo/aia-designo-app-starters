"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Alerte } from "@/components/ui/Alerte";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { Champ } from "@/components/ui/Champ";
import { ChoixPilules } from "@/components/ui/ChoixPilules";
import { LIBELLES_TYPE, LONGUEUR_MAX_MODELE, TYPES_VEHICULE, normaliserPlaque } from "@/lib/flotte/regles";
import type { EtatVehicule, ValeursVehicule } from "./actions";

type Props = {
  action: (etat: EtatVehicule, formData: FormData) => Promise<EtatVehicule>;
  /** Valeurs de départ : la plaque pré-remplie depuis un avis, ou le véhicule à modifier. */
  valeurs?: Partial<ValeursVehicule>;
  libelleBouton: string;
  enCours: string;
  messageSucces?: string;
  onSucces?: () => void;
  /** Véhicule archivé : les champs sont affichés, mais pas modifiables. */
  desactive?: boolean;
};

const VIDE: ValeursVehicule = { plaque: "", modele: "", type: "attitre" };

export function FormulaireVehicule({
  action,
  valeurs: initiales,
  libelleBouton,
  enCours,
  messageSucces,
  onSucces,
  desactive = false,
}: Props) {
  const [etat, envoyer] = useActionState<EtatVehicule, FormData>(
    async (precedent, formData) => {
      const suivant = await action(precedent, formData);
      if (suivant.ok) onSucces?.();
      return suivant;
    },
    { valeurs: { ...VIDE, ...initiales } },
  );
  const valeurs = { ...VIDE, ...etat.valeurs };
  const erreurs = etat.erreurs ?? {};

  return (
    <form action={envoyer} className="grid gap-5" noValidate>
      {erreurs.general && <Alerte variante="erreur">{erreurs.general}</Alerte>}
      {etat.ok && messageSucces && <Alerte variante="succes">{messageSucces}</Alerte>}

      <fieldset disabled={desactive} className="grid min-w-0 gap-5">
        <Champ
          name="plaque"
          libelle="Plaque"
          mono
          placeholder="AB-123-CD"
          aide="AB-123-CD ou 123 ABC 45"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          defaultValue={valeurs.plaque}
          erreur={
            erreurs.plaque &&
            (etat.vehiculeArchiveId ? (
              <>
                {erreurs.plaque} <Link href={`/flotte/vehicules/${etat.vehiculeArchiveId}`}>Ouvrir sa fiche</Link>
              </>
            ) : (
              erreurs.plaque
            ))
          }
          // Montre tout de suite la plaque telle qu'elle sera enregistrée.
          onBlur={(e) => {
            const plaque = normaliserPlaque(e.currentTarget.value);
            if (plaque) e.currentTarget.value = plaque;
          }}
          required
        />
        <Champ
          name="modele"
          libelle="Modèle"
          aide="Facultatif, par exemple Renault Master."
          maxLength={LONGUEUR_MAX_MODELE}
          defaultValue={valeurs.modele}
          erreur={erreurs.modele}
        />
        <ChoixPilules
          name="type"
          legende="Type"
          options={TYPES_VEHICULE}
          libelles={LIBELLES_TYPE}
          defaultValue={valeurs.type}
          aide="Attitré : un conducteur habituel. Pool : partagé, chaque affectation a une fin."
          erreur={erreurs.type}
        />
      </fieldset>

      {!desactive && (
        <div>
          <BoutonEnvoi enCours={enCours}>{libelleBouton}</BoutonEnvoi>
        </div>
      )}
    </form>
  );
}
