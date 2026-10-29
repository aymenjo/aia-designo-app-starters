"use client";

import Link from "next/link";
import { useActionState, useState, type FormEvent, type MouseEvent } from "react";
import { CadreConfiance, MotConfiance, PastilleConfiance } from "@/components/Confiance";
import { Echeance } from "@/components/Echeance";
import { Plaque } from "@/components/Plaque";
import { Alerte } from "@/components/ui/Alerte";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { Champ } from "@/components/ui/Champ";
import { ChampDate } from "@/components/ui/ChampDate";
import { ChampHeure } from "@/components/ui/ChampHeure";
import { useVerificationALaSortie } from "@/components/ui/useVerificationALaSortie";
import type { AvisDetaille, ValeursAvis } from "@/lib/avis/avis";
import { calculerEcheance } from "@/lib/avis/echeance";
import {
  CHAMPS_AVIS,
  CHAMP_REQUIS_DE,
  LIBELLES_CHAMP_AVIS,
  LONGUEUR_MAX_TEXTE_AVIS,
  lireMontant,
  normaliserNumeroAvis,
  verifierSaisieAvis,
  type ChampAvis,
  type ChampRequisAvis,
  type Confiances,
  type ValeursRefusees,
} from "@/lib/avis/regles";
import { normaliserDate, versIso } from "@/lib/dates";
import { normaliserPlaque } from "@/lib/flotte/regles";
import { formaterMontantSaisie } from "@/lib/format";
import type { EtatAvis } from "../actions";

/** Réécrits à la sortie du champ : le gestionnaire voit aussitôt la valeur telle qu'elle sera enregistrée. */
const NORMALISATIONS: Partial<Record<ChampAvis, (brut: string) => string | null>> = {
  numero: normaliserNumeroAvis,
  plaque: normaliserPlaque,
  montant: (brut) => {
    const centimes = lireMontant(brut);
    return centimes ? formaterMontantSaisie(centimes) : null;
  },
};

/** La date d'envoi se compare au jour de l'infraction : elle se revérifie quand l'infraction change. */
const DEPENDANCES: Partial<Record<ChampAvis, readonly ChampAvis[]>> = {
  infraction_date: ["date_envoi"],
  infraction_heure: ["date_envoi"],
};

const estChampAvis = (nom: string): nom is ChampAvis => (CHAMPS_AVIS as readonly string[]).includes(nom);

const enListe = (champs: readonly ChampRequisAvis[]) => champs.map((champ) => LIBELLES_CHAMP_AVIS[champ]).join(", ");

/**
 * Champs modifiés ou confirmés depuis le dernier enregistrement réussi : leur niveau ne s'affiche plus, comme le
 * serveur l'effacera. Un refus les garde : ces retouches ne sont pas encore enregistrées.
 */
type Retouches = { etat: EtatAvis; modifies: readonly ChampRequisAvis[]; confirmes: readonly ChampRequisAvis[] };

/** L'échéance d'une date d'envoi saisie, ou `null` tant qu'elle n'est pas une date. */
function echeanceSaisie(dateEnvoi: string) {
  const jjmmaaaa = normaliserDate(dateEnvoi);
  const iso = jjmmaaaa && versIso(jjmmaaaa);
  return iso ? calculerEcheance(iso) : null;
}

type Props = {
  action: (etat: EtatAvis, formData: FormData) => Promise<EtatAvis>;
  valeurs: ValeursAvis;
  /** La plaque enregistrée et le véhicule qui la porte, archivé compris. */
  plaque: string | null;
  vehicule: AvisDetaille["vehicule"];
  /** Les champs requis encore vides à l'enregistrement : l'avis reste « À traiter » tant qu'il en manque. */
  manquants: readonly ChampRequisAvis[];
  /** Le niveau de chaque champ lu par l'IA, tel qu'enregistré. */
  confiances: Confiances;
  /** Les champs rouges remplis : l'avis reste « À traiter » tant qu'ils ne sont pas confirmés. */
  aConfirmer: readonly ChampRequisAvis[];
  /** Les valeurs lues mais refusées par les règles : leur champ est resté vide. */
  refusees: ValeursRefusees;
  /** Le clic sur « J'ai désigné sur l'ANTAI » : l'échéance devient « Désigné le … ». */
  designeLe: string | null;
  /** Le clic sur « Classer » : l'échéance devient « Classé le … ». */
  classeLe: string | null;
};

export function FormulaireAvis({
  action,
  valeurs: initiales,
  plaque,
  vehicule,
  manquants,
  confiances,
  aConfirmer,
  refusees,
  designeLe,
  classeLe,
}: Props) {
  const [etat, envoyer] = useActionState(action, { valeurs: initiales });
  const { erreur, verifierALaSortie, effacerSiCorrige, nonEnregistree } = useVerificationALaSortie({
    champs: CHAMPS_AVIS,
    etat,
    verifier: verifierSaisieAvis,
    normalisations: NORMALISATIONS,
    dependances: DEPENDANCES,
  });
  const valeurs = etat.valeurs ?? initiales;

  // L'échéance suit la date d'envoi à chaque frappe, et le véhicule rattaché la plaque saisie.
  // Un nouvel envoi repart des valeurs renvoyées par le serveur.
  const [suivi, setSuivi] = useState({ etat, date_envoi: valeurs.date_envoi, plaque: valeurs.plaque });
  const saisie = suivi.etat === etat ? suivi : { etat, date_envoi: valeurs.date_envoi, plaque: valeurs.plaque };
  const echeance = echeanceSaisie(saisie.date_envoi);
  const plaqueEnregistree = Boolean(plaque) && normaliserPlaque(saisie.plaque) === plaque;

  const [retouches, setRetouches] = useState<Retouches>({ etat, modifies: [], confirmes: [] });
  const enCours = retouches.etat === etat || !etat.ok ? retouches : { etat, modifies: [], confirmes: [] };
  const niveau = (champ: ChampRequisAvis) =>
    enCours.modifies.includes(champ) || enCours.confirmes.includes(champ) ? null : (confiances[champ] ?? null);

  function retoucher(cle: "modifies" | "confirmes", champ: ChampRequisAvis) {
    if (!enCours[cle].includes(champ)) setRetouches({ ...enCours, etat, [cle]: [...enCours[cle], champ] });
  }

  /** Le bouton disparaît : le focus passe au champ confirmé. */
  function confirmer(champ: ChampRequisAvis, e: MouseEvent<HTMLButtonElement>) {
    retoucher("confirmes", champ);
    const nom = CHAMPS_AVIS.find((c) => CHAMP_REQUIS_DE[c] === champ);
    const element = nom && e.currentTarget.form?.elements.namedItem(nom);
    if (element instanceof HTMLInputElement) element.focus();
  }

  function suivre(e: FormEvent<HTMLFormElement>) {
    effacerSiCorrige(e);
    const { name, value } = e.target as HTMLInputElement;
    if (name === "date_envoi" || name === "plaque") setSuivi({ ...saisie, [name]: value });
    if (estChampAvis(name)) retoucher("modifies", CHAMP_REQUIS_DE[name]);
  }

  /** La valeur refusée d'un champ encore rouge : elle disparaît dès que le gestionnaire le remplit. */
  const refusee = (champ: ChampRequisAvis) => (niveau(champ) === "non_lu" ? refusees[champ] : undefined);

  /** Le point et le mot du niveau, sur la ligne du libellé. La date et l'heure se les partagent. */
  function confiance(champ: ChampRequisAvis, { pastille = true, mot = true } = {}) {
    const affiche = niveau(champ);
    if (!affiche) return {};
    return {
      pastille: pastille ? <PastilleConfiance niveau={affiche} /> : undefined,
      indication: mot ? <MotConfiance niveau={affiche} refusee={Boolean(refusee(champ))} /> : undefined,
    };
  }

  const cadre = (champ: ChampRequisAvis) => ({
    niveau: confiances[champ],
    masque: !niveau(champ),
    libelle: LIBELLES_CHAMP_AVIS[champ],
    refusee: refusee(champ),
    onConfirmer:
      aConfirmer.includes(champ) && niveau(champ)
        ? (e: MouseEvent<HTMLButtonElement>) => confirmer(champ, e)
        : undefined,
  });

  const conditions = [
    manquants.length > 0 && `remplis : ${enListe(manquants)}`,
    aConfirmer.length > 0 && `confirmés : ${enListe(aConfirmer)}`,
  ].filter(Boolean);

  /** Le n° d'un avis déjà enregistré : le refus du serveur mène à cet avis. */
  function erreurNumero() {
    const message = erreur("numero");
    if (!message || !etat.avisExistantId || message !== etat.erreurs?.numero) return message;
    return (
      <>
        {message} <Link href={`/avis/${etat.avisExistantId}`}>Ouvrir l&apos;avis existant</Link>
      </>
    );
  }

  const champ = (name: ChampAvis) => ({ name, defaultValue: valeurs[name], erreur: erreur(name) });

  return (
    <form action={envoyer} onBlur={verifierALaSortie} onChange={suivre} className="grid gap-5" noValidate>
      {enCours.confirmes.map((champ) => (
        <input key={champ} type="hidden" name="confirme" value={champ} />
      ))}
      <section className="grid gap-4 rounded-card border border-line p-6 max-md:p-5">
        <CadreConfiance {...cadre("numero")}>
          <Champ
            {...champ("numero")}
            {...confiance("numero")}
            erreur={erreurNumero()}
            libelle="N° d'avis"
            mono
            placeholder="1234567890"
            aide="10 chiffres, en haut de l'avis."
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
          />
        </CadreConfiance>
        <div className="grid gap-2">
          <CadreConfiance {...cadre("plaque")}>
            <Champ
              {...champ("plaque")}
              {...confiance("plaque")}
              libelle="Plaque"
              mono
              placeholder="AB-123-CD"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
            />
          </CadreConfiance>
          {plaqueEnregistree &&
            (vehicule ? (
              <p className="flex flex-wrap items-center gap-2 text-label">
                <span className="text-secondary">Véhicule de votre flotte :</span>
                <Plaque plaque={vehicule.plaque} />
                {vehicule.modele && <span className="text-secondary">{vehicule.modele}</span>}
                {vehicule.archive_le ? (
                  <span className="text-secondary">(archivé)</span>
                ) : (
                  vehicule.lecture_seule_le && <span className="text-secondary">(lecture seule)</span>
                )}
                <Link href={`/flotte/vehicules/${vehicule.id}`}>Ouvrir sa fiche</Link>
              </p>
            ) : (
              <p className="text-label text-secondary">Aucun véhicule de votre flotte ne porte cette plaque.</p>
            ))}
        </div>
        <CadreConfiance {...cadre("infraction_le")}>
          <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-4">
            <ChampDate
              {...champ("infraction_date")}
              {...confiance("infraction_le", { mot: false })}
              libelle="Date de l'infraction"
              calendrier
            />
            <ChampHeure
              {...champ("infraction_heure")}
              {...confiance("infraction_le", { pastille: false })}
              libelle="Heure"
            />
          </div>
        </CadreConfiance>
        <CadreConfiance {...cadre("lieu")}>
          <Champ
            {...champ("lieu")}
            {...confiance("lieu")}
            libelle="Lieu"
            placeholder="A6, Auxerre, sens Paris-Province"
            autoComplete="off"
            maxLength={LONGUEUR_MAX_TEXTE_AVIS}
          />
        </CadreConfiance>
        <CadreConfiance {...cadre("infraction")}>
          <Champ
            {...champ("infraction")}
            {...confiance("infraction")}
            libelle="Infraction"
            placeholder="Excès de vitesse inférieur à 20 km/h"
            autoComplete="off"
            maxLength={LONGUEUR_MAX_TEXTE_AVIS}
          />
        </CadreConfiance>
        <CadreConfiance {...cadre("montant_centimes")}>
          <Champ
            {...champ("montant")}
            {...confiance("montant_centimes")}
            libelle="Montant (amende forfaitaire)"
            placeholder="135,00"
            inputMode="decimal"
            autoComplete="off"
            suffixe={
              <span
                aria-hidden
                className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-secondary"
              >
                €
              </span>
            }
          />
        </CadreConfiance>
        <CadreConfiance {...cadre("date_envoi")}>
          <ChampDate
            {...champ("date_envoi")}
            {...confiance("date_envoi")}
            libelle="Date d'envoi"
            aide="Imprimée sur l'avis : le délai de 45 jours part d'elle."
            calendrier
          />
        </CadreConfiance>
        <div className="grid gap-1.5">
          <span className="text-label font-medium">Échéance</span>
          {echeance ? (
            <span>
              <Echeance echeance={echeance} designeLe={designeLe} classeLe={classeLe} />
            </span>
          ) : (
            <p className="text-label text-secondary">Calculée dès la date d&apos;envoi saisie : 45 jours après.</p>
          )}
        </div>
      </section>

      {conditions.length > 0 && (
        <p className="text-label text-secondary">
          L&apos;avis passera « À valider » une fois {conditions.join(", et ")}.
        </p>
      )}
      {etat.erreurs?.general && <Alerte variante="erreur">{etat.erreurs.general}</Alerte>}
      {nonEnregistree && <Alerte variante="erreur">Avis non enregistré : corrigez les champs signalés.</Alerte>}
      {etat.ok && <Alerte variante="succes">Avis enregistré.</Alerte>}

      <div>
        <BoutonEnvoi enCours="Enregistrement…">Enregistrer</BoutonEnvoi>
      </div>
    </form>
  );
}
