"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Alerte } from "@/components/ui/Alerte";
import { Bloc } from "@/components/ui/Bloc";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { Champ } from "@/components/ui/Champ";
import { ChampDate } from "@/components/ui/ChampDate";
import { ChoixPilules } from "@/components/ui/ChoixPilules";
import { useVerificationALaSortie } from "@/components/ui/useVerificationALaSortie";
import type { ValeursConducteur } from "@/lib/flotte/conducteurs";
import {
  CHAMPS_CONDUCTEUR,
  CIVILITES,
  LIBELLES_CIVILITE,
  LONGUEURS_MAX_CONDUCTEUR,
  normaliserCategories,
  normaliserEmail,
  normaliserPermis,
  verifierSaisieConducteur,
  type ChampConducteur,
} from "@/lib/flotte/regles";
import { normaliserCodePostal } from "@/lib/saisie";
import type { EtatConducteur } from "./actions";

/** Réécrits à la sortie du champ : le gestionnaire voit aussitôt la valeur telle qu'elle sera enregistrée. */
const NORMALISATIONS: Partial<Record<ChampConducteur, (brut: string) => string | null>> = {
  code_postal: normaliserCodePostal,
  permis_numero: normaliserPermis,
  permis_categories: (brut) => {
    const resultat = normaliserCategories(brut);
    return resultat.ok ? resultat.categories.join(", ") : null;
  },
  email: normaliserEmail,
};

/** La délivrance dépend de la naissance : elle se revérifie quand la naissance change. */
const DEPENDANCES: Partial<Record<ChampConducteur, readonly ChampConducteur[]>> = {
  date_naissance: ["permis_delivre_le"],
};

type Props = {
  action: (etat: EtatConducteur, formData: FormData) => Promise<EtatConducteur>;
  valeurs: ValeursConducteur;
  /** Conducteur archivé : les champs sont affichés, mais pas modifiables. */
  desactive?: boolean;
};

export function FormulaireConducteur({ action, valeurs: initiales, desactive = false }: Props) {
  const [etat, envoyer] = useActionState(action, { valeurs: initiales });
  const { erreur, verifierALaSortie, effacerSiCorrige, nonEnregistree } = useVerificationALaSortie({
    champs: CHAMPS_CONDUCTEUR,
    etat,
    verifier: verifierSaisieConducteur,
    normalisations: NORMALISATIONS,
    dependances: DEPENDANCES,
  });
  const valeurs = etat.valeurs ?? initiales;

  /** Le permis ou l'email d'un conducteur archivé : le refus du serveur mène à sa fiche. */
  function erreurAvecLien(name: "permis_numero" | "email") {
    const message = erreur(name);
    if (!message || !etat.conducteurArchiveId || message !== etat.erreurs?.[name]) return message;
    return (
      <>
        {message} <Link href={`/flotte/conducteurs/${etat.conducteurArchiveId}`}>Ouvrir sa fiche</Link>
      </>
    );
  }

  const champ = (name: ChampConducteur) => ({ name, defaultValue: valeurs[name], erreur: erreur(name) });

  return (
    <form action={envoyer} onBlur={verifierALaSortie} onChange={effacerSiCorrige} className="grid gap-6" noValidate>
      <fieldset disabled={desactive} className="grid min-w-0 gap-6">
        <Bloc titre="Identité" description="Telle qu'elle figure sur le permis de conduire.">
          <ChoixPilules
            name="civilite"
            legende="Civilité"
            options={CIVILITES}
            libelles={LIBELLES_CIVILITE}
            defaultValue={valeurs.civilite}
            erreur={erreur("civilite")}
          />
          <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
            <Champ
              {...champ("prenom")}
              libelle="Prénom"
              autoComplete="off"
              maxLength={LONGUEURS_MAX_CONDUCTEUR.prenom}
            />
            <Champ {...champ("nom")} libelle="Nom" autoComplete="off" maxLength={LONGUEURS_MAX_CONDUCTEUR.nom} />
            <ChampDate {...champ("date_naissance")} libelle="Date de naissance" />
            <Champ
              {...champ("lieu_naissance")}
              libelle="Lieu de naissance"
              aide="Facultatif."
              autoComplete="off"
              maxLength={LONGUEURS_MAX_CONDUCTEUR.lieu_naissance}
            />
          </div>
        </Bloc>

        <Bloc titre="Adresse" description="L'adresse postale du conducteur, où l'ANTAI lui enverra le nouvel avis.">
          <Champ
            {...champ("adresse")}
            libelle="Adresse"
            placeholder="12 rue des Lilas"
            autoComplete="off"
            maxLength={LONGUEURS_MAX_CONDUCTEUR.adresse}
          />
          <Champ
            {...champ("adresse_complement")}
            libelle="Complément d'adresse"
            aide="Facultatif : bâtiment, étage, lieu-dit…"
            autoComplete="off"
            maxLength={LONGUEURS_MAX_CONDUCTEUR.adresse_complement}
          />
          <div className="grid grid-cols-[200px_minmax(0,1fr)] gap-4 max-sm:grid-cols-1">
            <Champ {...champ("code_postal")} libelle="Code postal" inputMode="numeric" autoComplete="off" />
            <Champ
              {...champ("ville")}
              libelle="Ville"
              autoComplete="off"
              maxLength={LONGUEURS_MAX_CONDUCTEUR.ville}
            />
          </div>
        </Bloc>

        <Bloc titre="Permis de conduire">
          <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
            <Champ
              {...champ("permis_numero")}
              erreur={erreurAvecLien("permis_numero")}
              libelle="N° de permis"
              mono
              aide="12 chiffres au dos du permis, en haut à gauche."
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
            />
            <ChampDate {...champ("permis_delivre_le")} libelle="Date de délivrance" />
          </div>
          <Champ
            {...champ("permis_categories")}
            libelle="Catégories"
            placeholder="B, C1"
            aide="Facultatif. Séparées par des virgules."
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
          />
        </Bloc>

        <Bloc titre="Contact">
          <Champ
            {...champ("email")}
            erreur={erreurAvecLien("email")}
            libelle="Email"
            type="email"
            aide="Facultatif. Pour le prévenir quand il est désigné."
            autoComplete="off"
            spellCheck={false}
          />
        </Bloc>
      </fieldset>

      {etat.erreurs?.general && <Alerte variante="erreur">{etat.erreurs.general}</Alerte>}
      {nonEnregistree && <Alerte variante="erreur">Fiche non enregistrée : corrigez les champs signalés.</Alerte>}
      {etat.ok && <Alerte variante="succes">Fiche enregistrée.</Alerte>}

      {!desactive && (
        <div>
          <BoutonEnvoi enCours="Enregistrement…">Enregistrer</BoutonEnvoi>
        </div>
      )}
    </form>
  );
}
