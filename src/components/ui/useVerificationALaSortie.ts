"use client";

import { useState, type FormEvent } from "react";

type Options<Champ extends string> = {
  /** Les champs du formulaire, nommés comme les règles. */
  champs: readonly Champ[];
  /** Le dernier état renvoyé par l'action du formulaire. */
  etat: { erreurs?: Partial<Record<Champ | "general", string>> };
  /** Les règles de l'enregistrement : les mêmes contrôles et les mêmes messages, dès la saisie. */
  verifier: (saisie: Record<Champ, string>) => Partial<Record<Champ, string>>;
  /** Réécrits à la sortie du champ : le gestionnaire voit aussitôt la valeur telle qu'elle sera enregistrée. */
  normalisations?: Partial<Record<Champ, (brut: string) => string | null>>;
  /** Champs à revérifier quand un autre change, s'ils sont remplis : la TVA dépend du SIREN. */
  dependances?: Partial<Record<Champ, readonly Champ[]>>;
  /** Appelé après la réécriture d'un champ : par exemple, proposer la TVA d'après le SIREN. */
  apresNormalisation?: (champ: Champ, normalisee: string | null, form: HTMLFormElement) => void;
};

/** Contrôles par champ : `null` = champ vérifié, sans erreur. */
type Controles<Champ extends string> = Partial<Record<Champ, string | null>>;

/** Contrôles faits dans le navigateur depuis le dernier envoi. */
type Verification<Champ extends string> = { etat: unknown; erreurs: Controles<Champ> };

/**
 * Contrôle « dès la saisie » d'une fiche : une erreur apparaît à la sortie du champ, et s'efface
 * pendant la frappe dès que le champ est juste. Un nouvel envoi remplace ces contrôles par la réponse du serveur.
 * À brancher sur le formulaire : `onBlur={verifierALaSortie} onChange={effacerSiCorrige}`.
 */
export function useVerificationALaSortie<Champ extends string>({
  champs,
  etat,
  verifier,
  normalisations,
  dependances,
  apresNormalisation,
}: Options<Champ>) {
  const [verification, setVerification] = useState<Verification<Champ>>({ etat, erreurs: {} });

  const locales: Controles<Champ> = verification.etat === etat ? verification.erreurs : {};
  const erreur = (champ: Champ) => (champ in locales ? locales[champ] : etat.erreurs?.[champ]) ?? undefined;

  const estChamp = (nom: string): nom is Champ => (champs as readonly string[]).includes(nom);

  function lireFormulaire(form: HTMLFormElement) {
    const donnees = new FormData(form);
    return Object.fromEntries(champs.map((champ) => [champ, String(donnees.get(champ) ?? "")])) as Record<
      Champ,
      string
    >;
  }

  function retenir(verifies: Controles<Champ>) {
    setVerification((precedente) => ({
      etat,
      erreurs: { ...(precedente.etat === etat ? precedente.erreurs : {}), ...verifies },
    }));
  }

  function verifierALaSortie(e: FormEvent<HTMLFormElement>) {
    const input = e.target as HTMLInputElement;
    if (!estChamp(input.name)) return;
    const form = e.currentTarget;
    const normalisee = normalisations?.[input.name]?.(input.value) ?? null;
    if (normalisee) input.value = normalisee;
    apresNormalisation?.(input.name, normalisee, form);

    const dependants = (dependances?.[input.name] ?? []).filter((champ) => {
      const element = form.elements.namedItem(champ);
      return element instanceof HTMLInputElement && element.value.trim();
    });
    const erreurs = verifier(lireFormulaire(form));
    const verifies = [input.name, ...dependants].map((champ) => [champ, erreurs[champ] ?? null]);
    retenir(Object.fromEntries(verifies) as Controles<Champ>);
  }

  function effacerSiCorrige(e: FormEvent<HTMLFormElement>) {
    const { name } = e.target as HTMLInputElement;
    if (!estChamp(name) || !erreur(name)) return;
    if (!verifier(lireFormulaire(e.currentTarget))[name]) retenir({ [name]: null } as Controles<Champ>);
  }

  // Refusée par le serveur, et pas encore corrigée.
  const nonEnregistree = champs.some((champ) => etat.erreurs?.[champ]) && champs.some((champ) => erreur(champ));

  return { erreur, verifierALaSortie, effacerSiCorrige, nonEnregistree };
}
