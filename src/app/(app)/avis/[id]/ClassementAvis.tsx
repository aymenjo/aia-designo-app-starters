"use client";

import { useActionState, useState, type FormEvent } from "react";
import { Alerte } from "@/components/ui/Alerte";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { Champ } from "@/components/ui/Champ";
import { ChoixPilules } from "@/components/ui/ChoixPilules";
import { Fenetre } from "@/components/ui/Fenetre";
import { LIBELLES_MOTIF_CLASSEMENT, LONGUEUR_MAX_TEXTE_AVIS, MOTIFS_CLASSEMENT } from "@/lib/avis/regles";
import type { EtatClassement } from "../actions";

type Props = {
  action: (etat: EtatClassement, formData: FormData) => Promise<EtatClassement>;
  /** Un avis désigné perd sa date de désignation : la fenêtre le dit. */
  designe: boolean;
};

/** « Classer l'avis » : le motif se choisit dans une fenêtre. Repris par le bloc « Véhicule inconnu ». */
export function ClassementAvis({ action, designe }: Props) {
  const [ouverte, setOuverte] = useState(false);

  return (
    <>
      <Bouton variante="secondaire" onClick={() => setOuverte(true)}>
        Classer l&apos;avis
      </Bouton>
      <Fenetre titre="Classer cet avis" ouverte={ouverte} onFermer={() => setOuverte(false)}>
        <FormulaireClassement action={action} designe={designe} onFermer={() => setOuverte(false)} />
      </Fenetre>
    </>
  );
}

/** Monté à chaque ouverture de la fenêtre : il repart vide. */
function FormulaireClassement({ action, designe, onFermer }: Props & { onFermer: () => void }) {
  const [etat, envoyer] = useActionState<EtatClassement, FormData>(async (precedent, formData) => {
    const suivant = await action(precedent, formData);
    if (suivant.ok) onFermer();
    return suivant;
  }, {});
  const valeurs = etat.valeurs ?? { motif: "", motif_libre: "" };

  // Le motif coché, pour n'afficher le texte libre que sous « Autre ». Un nouvel envoi repart des valeurs renvoyées.
  const [suivi, setSuivi] = useState({ etat, motif: valeurs.motif });
  const motif = suivi.etat === etat ? suivi.motif : valeurs.motif;

  function suivre(e: FormEvent<HTMLFormElement>) {
    const { name, value } = e.target as HTMLInputElement;
    if (name === "motif") setSuivi({ etat, motif: value });
  }

  return (
    <form action={envoyer} onChange={suivre} className="grid gap-5" noValidate>
      <p className="text-secondary">
        Il sort du suivi&nbsp;: plus d&apos;échéance ni d&apos;alerte. Vous pourrez le rouvrir.
        {designe && " La date de désignation sera effacée."}
      </p>
      {etat.erreurs?.general && <Alerte variante="erreur">{etat.erreurs.general}</Alerte>}
      <ChoixPilules
        name="motif"
        legende="Motif"
        options={MOTIFS_CLASSEMENT}
        libelles={LIBELLES_MOTIF_CLASSEMENT}
        defaultValue={valeurs.motif}
        erreur={etat.erreurs?.motif}
      />
      {motif === "autre" && (
        <Champ
          name="motif_libre"
          libelle="Précisez le motif"
          defaultValue={valeurs.motif_libre}
          erreur={etat.erreurs?.motif_libre}
          maxLength={LONGUEUR_MAX_TEXTE_AVIS}
          autoComplete="off"
        />
      )}
      <div className="flex flex-wrap gap-2">
        <BoutonEnvoi enCours="Classement…">Classer</BoutonEnvoi>
        <Bouton variante="ghost" onClick={onFermer}>
          Annuler
        </Bouton>
      </div>
    </form>
  );
}
