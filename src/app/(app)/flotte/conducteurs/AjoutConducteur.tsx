"use client";

import { Plus } from "lucide-react";
import { useActionState, useState } from "react";
import { Alerte } from "@/components/ui/Alerte";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { Champ } from "@/components/ui/Champ";
import { ChoixPilules } from "@/components/ui/ChoixPilules";
import { Fenetre } from "@/components/ui/Fenetre";
import { CIVILITES, LIBELLES_CIVILITE, LONGUEURS_MAX_CONDUCTEUR } from "@/lib/flotte/regles";
import { ajouterConducteur, type EtatConducteur } from "./actions";

/** Monté à l'ouverture de la fenêtre : il repart vide à chaque fois. */
function FormulaireAjout() {
  const [etat, envoyer] = useActionState<EtatConducteur, FormData>(ajouterConducteur, {});
  const erreurs = etat.erreurs ?? {};

  return (
    <form action={envoyer} className="grid gap-5" noValidate>
      {erreurs.general && <Alerte variante="erreur">{erreurs.general}</Alerte>}
      <ChoixPilules
        name="civilite"
        legende="Civilité"
        options={CIVILITES}
        libelles={LIBELLES_CIVILITE}
        defaultValue={etat.valeurs?.civilite}
        erreur={erreurs.civilite}
      />
      <Champ
        name="prenom"
        libelle="Prénom"
        autoComplete="off"
        maxLength={LONGUEURS_MAX_CONDUCTEUR.prenom}
        defaultValue={etat.valeurs?.prenom}
        erreur={erreurs.prenom}
        required
      />
      <Champ
        name="nom"
        libelle="Nom"
        aide="Vous compléterez sa fiche à l'étape suivante."
        autoComplete="off"
        maxLength={LONGUEURS_MAX_CONDUCTEUR.nom}
        defaultValue={etat.valeurs?.nom}
        erreur={erreurs.nom}
        required
      />
      <div>
        <BoutonEnvoi enCours="Ajout…">Ajouter</BoutonEnvoi>
      </div>
    </form>
  );
}

export function AjoutConducteur() {
  const [ouverte, setOuverte] = useState(false);

  return (
    <>
      <Bouton onClick={() => setOuverte(true)}>
        <Plus size={16} strokeWidth={1.5} aria-hidden />
        Ajouter un conducteur
      </Bouton>
      <Fenetre titre="Ajouter un conducteur" ouverte={ouverte} onFermer={() => setOuverte(false)}>
        <FormulaireAjout />
      </Fenetre>
    </>
  );
}
