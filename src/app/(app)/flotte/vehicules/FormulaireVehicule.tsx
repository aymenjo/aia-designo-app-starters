"use client";

import Link from "next/link";
import { useActionState } from "react";
import { LienPasserEnPro } from "@/components/LienPasserEnPro";
import { Plaque } from "@/components/Plaque";
import { Alerte } from "@/components/ui/Alerte";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { Champ, MessageChamp } from "@/components/ui/Champ";
import { ChoixPilules } from "@/components/ui/ChoixPilules";
import { LIBELLES_TYPE, LONGUEUR_MAX_MODELE, TYPES_VEHICULE, normaliserPlaque } from "@/lib/flotte/regles";
import type { EtatVehicule, ValeursVehicule } from "./actions";

type Props = {
  action: (etat: EtatVehicule, formData: FormData) => Promise<EtatVehicule>;
  /** Valeurs de départ : le véhicule à modifier. */
  valeurs?: Partial<ValeursVehicule>;
  /**
   * La plaque d'un avis, qui ne se saisit pas : elle se corrige dans les champs de l'avis. Sans champ, la page de l'avis
   * ne porte pas deux fois l'id « plaque ».
   */
  plaqueFixe?: string;
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
  plaqueFixe,
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
  const erreurPlaque =
    erreurs.plaque &&
    (etat.vehiculeArchiveId ? (
      <>
        {erreurs.plaque} <Link href={`/flotte/vehicules/${etat.vehiculeArchiveId}`}>Ouvrir sa fiche</Link>
      </>
    ) : (
      erreurs.plaque
    ));

  return (
    <form action={envoyer} className="grid gap-5" noValidate>
      {erreurs.general && (
        <Alerte variante="erreur">
          <p>{erreurs.general}</p>
          {etat.invitationPro && <LienPasserEnPro />}
        </Alerte>
      )}
      {etat.ok && messageSucces && <Alerte variante="succes">{messageSucces}</Alerte>}

      <fieldset disabled={desactive} className="grid min-w-0 gap-5">
        {plaqueFixe ? (
          <div className="grid gap-1.5">
            <span className="text-label font-medium">Plaque</span>
            <span>
              <Plaque plaque={plaqueFixe} />
            </span>
            <MessageChamp
              id="plaque-fixe-message"
              erreur={erreurPlaque}
              aide="Celle de l'avis. Mal lue ? Corrigez-la dans les champs de l'avis."
            />
          </div>
        ) : (
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
            erreur={erreurPlaque}
            // Montre tout de suite la plaque telle qu'elle sera enregistrée.
            onBlur={(e) => {
              const plaque = normaliserPlaque(e.currentTarget.value);
              if (plaque) e.currentTarget.value = plaque;
            }}
            required
          />
        )}
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
