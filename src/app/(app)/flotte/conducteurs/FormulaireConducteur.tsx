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
  LIBELLES_CHAMP_CONDUCTEUR,
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
  /** Les champs affichés, par exemple les champs manquants dans le récap ANTAI : tous par défaut. */
  champs?: readonly ChampConducteur[];
};

export function FormulaireConducteur({
  action,
  valeurs: initiales,
  desactive = false,
  champs = CHAMPS_CONDUCTEUR,
}: Props) {
  const [etat, envoyer] = useActionState(action, { valeurs: initiales });
  const { erreur, verifierALaSortie, effacerSiCorrige, nonEnregistree } = useVerificationALaSortie({
    champs,
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
  const affiche = (...noms: ChampConducteur[]) => noms.some((nom) => champs.includes(nom));
  // Une règle croisée peut refuser un champ que le formulaire n'affiche pas : la délivrance, quand on corrige la naissance.
  const horsFormulaire = CHAMPS_CONDUCTEUR.filter((nom) => !champs.includes(nom) && etat.erreurs?.[nom]);

  return (
    <form action={envoyer} onBlur={verifierALaSortie} onChange={effacerSiCorrige} className="grid gap-6" noValidate>
      <fieldset disabled={desactive} className="grid min-w-0 gap-6">
        {affiche("civilite", "prenom", "nom", "date_naissance", "lieu_naissance") && (
          <Bloc titre="Identité" description="Telle qu'elle figure sur le permis de conduire.">
            {affiche("civilite") && (
              <ChoixPilules
                name="civilite"
                legende="Civilité"
                options={CIVILITES}
                libelles={LIBELLES_CIVILITE}
                defaultValue={valeurs.civilite}
                erreur={erreur("civilite")}
              />
            )}
            {affiche("prenom", "nom", "date_naissance", "lieu_naissance") && (
              <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
                {affiche("prenom") && (
                  <Champ
                    {...champ("prenom")}
                    libelle="Prénom"
                    autoComplete="off"
                    maxLength={LONGUEURS_MAX_CONDUCTEUR.prenom}
                  />
                )}
                {affiche("nom") && (
                  <Champ {...champ("nom")} libelle="Nom" autoComplete="off" maxLength={LONGUEURS_MAX_CONDUCTEUR.nom} />
                )}
                {affiche("date_naissance") && <ChampDate {...champ("date_naissance")} libelle="Date de naissance" />}
                {affiche("lieu_naissance") && (
                  <Champ
                    {...champ("lieu_naissance")}
                    libelle="Lieu de naissance"
                    aide="Facultatif."
                    autoComplete="off"
                    maxLength={LONGUEURS_MAX_CONDUCTEUR.lieu_naissance}
                  />
                )}
              </div>
            )}
          </Bloc>
        )}

        {affiche("adresse", "adresse_complement", "code_postal", "ville") && (
          <Bloc titre="Adresse" description="L'adresse postale du conducteur, où l'ANTAI lui enverra le nouvel avis.">
            {affiche("adresse") && (
              <Champ
                {...champ("adresse")}
                libelle="Adresse"
                placeholder="12 rue des Lilas"
                autoComplete="off"
                maxLength={LONGUEURS_MAX_CONDUCTEUR.adresse}
              />
            )}
            {affiche("adresse_complement") && (
              <Champ
                {...champ("adresse_complement")}
                libelle="Complément d'adresse"
                aide="Facultatif : bâtiment, étage, lieu-dit…"
                autoComplete="off"
                maxLength={LONGUEURS_MAX_CONDUCTEUR.adresse_complement}
              />
            )}
            {affiche("code_postal", "ville") && (
              <div className="grid grid-cols-[200px_minmax(0,1fr)] gap-4 max-sm:grid-cols-1">
                {affiche("code_postal") && (
                  <Champ {...champ("code_postal")} libelle="Code postal" inputMode="numeric" autoComplete="off" />
                )}
                {affiche("ville") && (
                  <Champ
                    {...champ("ville")}
                    libelle="Ville"
                    autoComplete="off"
                    maxLength={LONGUEURS_MAX_CONDUCTEUR.ville}
                    className={affiche("code_postal") ? undefined : "col-span-full"}
                  />
                )}
              </div>
            )}
          </Bloc>
        )}

        {affiche("permis_numero", "permis_delivre_le", "permis_categories") && (
          <Bloc titre="Permis de conduire">
            {affiche("permis_numero", "permis_delivre_le") && (
              <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
                {affiche("permis_numero") && (
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
                )}
                {affiche("permis_delivre_le") && (
                  <ChampDate {...champ("permis_delivre_le")} libelle="Date de délivrance" />
                )}
              </div>
            )}
            {affiche("permis_categories") && (
              <Champ
                {...champ("permis_categories")}
                libelle="Catégories"
                placeholder="B, C1"
                aide="Facultatif. Séparées par des virgules."
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
              />
            )}
          </Bloc>
        )}

        {affiche("email") && (
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
        )}
      </fieldset>

      {etat.erreurs?.general && <Alerte variante="erreur">{etat.erreurs.general}</Alerte>}
      {horsFormulaire.map((nom) => (
        <Alerte key={nom} variante="erreur">
          {LIBELLES_CHAMP_CONDUCTEUR[nom]}&nbsp;: {etat.erreurs?.[nom]}
        </Alerte>
      ))}
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
