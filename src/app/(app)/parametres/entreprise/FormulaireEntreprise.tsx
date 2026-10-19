"use client";

import { useActionState, useId } from "react";
import { Alerte } from "@/components/ui/Alerte";
import { Bloc } from "@/components/ui/Bloc";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { Champ } from "@/components/ui/Champ";
import { useVerificationALaSortie } from "@/components/ui/useVerificationALaSortie";
import type { ValeursEntreprise } from "@/lib/entreprise/fiche";
import {
  CHAMPS_ENTREPRISE,
  FONCTIONS_SUGGEREES,
  LIBELLES_CHAMP,
  LONGUEURS_MAX,
  normaliserSiren,
  normaliserTva,
  sirenValide,
  tvaDepuisSiren,
  verifierSaisie,
  type ChampEntreprise,
} from "@/lib/entreprise/regles";
import { normaliserCodePostal } from "@/lib/saisie";
import type { EtatEntreprise } from "./actions";

/** Réécrits à la sortie du champ : le gestionnaire voit tout de suite la valeur telle qu'elle sera enregistrée. */
const NORMALISATIONS: Partial<Record<ChampEntreprise, (brut: string) => string | null>> = {
  siren: normaliserSiren,
  tva: normaliserTva,
  siege_code_postal: normaliserCodePostal,
};

/** La TVA dépend du SIREN : elle se revérifie quand le SIREN change. */
const DEPENDANCES: Partial<Record<ChampEntreprise, readonly ChampEntreprise[]>> = { siren: ["tva"] };

/** Un SIREN valide propose la TVA, si elle n'est pas déjà saisie (et si le formulaire l'affiche). */
function proposerTva(champ: ChampEntreprise, normalisee: string | null, form: HTMLFormElement) {
  if (champ !== "siren" || !normalisee || !sirenValide(normalisee)) return;
  const tva = form.elements.namedItem("tva");
  if (tva instanceof HTMLInputElement && !tva.value.trim()) tva.value = tvaDepuisSiren(normalisee);
}

type Props = {
  action: (etat: EtatEntreprise, formData: FormData) => Promise<EtatEntreprise>;
  valeurs: ValeursEntreprise;
  /** Les champs affichés, par exemple les champs manquants dans le récap ANTAI : tous par défaut. */
  champs?: readonly ChampEntreprise[];
};

export function FormulaireEntreprise({ action, valeurs: initiales, champs = CHAMPS_ENTREPRISE }: Props) {
  const [etat, envoyer] = useActionState(action, { valeurs: initiales });
  const { erreur, verifierALaSortie, effacerSiCorrige, nonEnregistree } = useVerificationALaSortie({
    champs,
    etat,
    verifier: verifierSaisie,
    normalisations: NORMALISATIONS,
    dependances: DEPENDANCES,
    apresNormalisation: proposerTva,
  });
  const idFonctions = useId();
  const valeurs = etat.valeurs ?? initiales;

  const champ = (name: ChampEntreprise) => ({ name, defaultValue: valeurs[name], erreur: erreur(name) });
  const affiche = (...noms: ChampEntreprise[]) => noms.some((nom) => champs.includes(nom));
  // Une règle croisée peut refuser un champ que le formulaire n'affiche pas : la TVA, quand on corrige le SIREN.
  const horsFormulaire = CHAMPS_ENTREPRISE.filter((nom) => !champs.includes(nom) && etat.erreurs?.[nom]);

  return (
    <form action={envoyer} onBlur={verifierALaSortie} onChange={effacerSiCorrige} className="grid gap-6" noValidate>
      {affiche("raison_sociale", "siren", "tva") && (
        <Bloc titre="Entreprise">
          {affiche("raison_sociale") && (
            <Champ
              {...champ("raison_sociale")}
              libelle="Raison sociale"
              aide="Telle qu'elle figure sur votre extrait Kbis."
              autoComplete="organization"
              maxLength={LONGUEURS_MAX.raison_sociale}
            />
          )}
          {affiche("siren", "tva") && (
            <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
              {affiche("siren") && (
                <Champ
                  {...champ("siren")}
                  libelle="SIREN"
                  mono
                  placeholder="123456789"
                  aide="9 chiffres, sur votre extrait Kbis."
                  inputMode="numeric"
                  autoComplete="off"
                  spellCheck={false}
                />
              )}
              {affiche("tva") && (
                <Champ
                  {...champ("tva")}
                  libelle="N° de TVA intracommunautaire"
                  mono
                  placeholder="FR32123456789"
                  aide="Proposé d'après le SIREN."
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                />
              )}
            </div>
          )}
        </Bloc>
      )}

      {affiche("representant_prenom", "representant_nom", "representant_fonction") && (
        <Bloc titre="Représentant légal" description="La personne qui représente légalement l'entreprise, nommée sur le récap ANTAI.">
          <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
            {affiche("representant_prenom") && (
              <Champ {...champ("representant_prenom")} libelle="Prénom" maxLength={LONGUEURS_MAX.representant_prenom} />
            )}
            {affiche("representant_nom") && (
              <Champ {...champ("representant_nom")} libelle="Nom" maxLength={LONGUEURS_MAX.representant_nom} />
            )}
            {affiche("representant_fonction") && (
              <Champ
                {...champ("representant_fonction")}
                libelle="Fonction"
                placeholder="Gérant, Président…"
                list={idFonctions}
                autoComplete="off"
                maxLength={LONGUEURS_MAX.representant_fonction}
              />
            )}
          </div>
          <datalist id={idFonctions}>
            {FONCTIONS_SUGGEREES.map((fonction) => (
              <option key={fonction} value={fonction} />
            ))}
          </datalist>
        </Bloc>
      )}

      {affiche("siege_adresse", "siege_complement", "siege_code_postal", "siege_ville") && (
        <Bloc titre="Siège" description="L'adresse du siège social, reprise sur vos factures.">
          {affiche("siege_adresse") && (
            <Champ
              {...champ("siege_adresse")}
              libelle="Adresse"
              placeholder="12 rue des Lilas"
              autoComplete="address-line1"
              maxLength={LONGUEURS_MAX.siege_adresse}
            />
          )}
          {affiche("siege_complement") && (
            <Champ
              {...champ("siege_complement")}
              libelle="Complément d'adresse"
              aide="Facultatif : bâtiment, étage, BP…"
              autoComplete="address-line2"
              maxLength={LONGUEURS_MAX.siege_complement}
            />
          )}
          {affiche("siege_code_postal", "siege_ville") && (
            <div className="grid grid-cols-[200px_minmax(0,1fr)] gap-4 max-sm:grid-cols-1">
              {affiche("siege_code_postal") && (
                <Champ
                  {...champ("siege_code_postal")}
                  libelle="Code postal"
                  inputMode="numeric"
                  autoComplete="postal-code"
                />
              )}
              {affiche("siege_ville") && (
                <Champ
                  {...champ("siege_ville")}
                  libelle="Ville"
                  autoComplete="address-level2"
                  maxLength={LONGUEURS_MAX.siege_ville}
                  className={affiche("siege_code_postal") ? undefined : "col-span-full"}
                />
              )}
            </div>
          )}
        </Bloc>
      )}

      {etat.erreurs?.general && <Alerte variante="erreur">{etat.erreurs.general}</Alerte>}
      {horsFormulaire.map((nom) => (
        <Alerte key={nom} variante="erreur">
          {LIBELLES_CHAMP[nom]}&nbsp;: {etat.erreurs?.[nom]}
        </Alerte>
      ))}
      {nonEnregistree && <Alerte variante="erreur">Fiche non enregistrée : corrigez les champs signalés.</Alerte>}
      {etat.ok && <Alerte variante="succes">Fiche enregistrée.</Alerte>}

      <div>
        <BoutonEnvoi enCours="Enregistrement…">Enregistrer</BoutonEnvoi>
      </div>
    </form>
  );
}
