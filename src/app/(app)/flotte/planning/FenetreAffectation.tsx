"use client";

import Link from "next/link";
import { createContext, use, useActionState, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Plaque } from "@/components/Plaque";
import { Alerte } from "@/components/ui/Alerte";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { ChampDate } from "@/components/ui/ChampDate";
import { ChampHeure } from "@/components/ui/ChampHeure";
import { Fenetre } from "@/components/ui/Fenetre";
import { useVerificationALaSortie } from "@/components/ui/useVerificationALaSortie";
import { aujourdhuiParis, depuisIso, partiesParis } from "@/lib/dates";
import type { AffectationDetaillee, ChoixAffectation } from "@/lib/flotte/affectations";
import { formaterDateHeure } from "@/lib/format";
import { libelleCreneau } from "@/lib/flotte/planning";
import { MESSAGES, nomComplet, verifierSaisieCloture } from "@/lib/flotte/regles";
import { cloturerAffectation, modifierAffectation, type EtatCloture, type ValeursAffectation } from "./actions";
import { FormulaireAffectation } from "./FormulaireAffectation";

type Mode = "detail" | "modifier" | "cloturer";
type Ouverte = { affectation: AffectationDetaillee; mode: Mode };

const TITRES: Record<Mode, string> = {
  detail: "Affectation",
  modifier: "Modifier l'affectation",
  cloturer: "Clôturer l'affectation",
};

const Contexte = createContext<{ choix: ChoixAffectation; ouvrir: (affectation: AffectationDetaillee) => void } | null>(
  null,
);

export function useChoixAffectation() {
  const contexte = use(Contexte);
  if (!contexte) throw new Error("À placer dans un <FournisseurAffectations>");
  return contexte;
}

/**
 * Une seule fenêtre d'affectation par écran (planning, fiche), ouverte par chaque barre ou ligne.
 * Elle reçoit une fois la liste des véhicules et conducteurs actifs.
 */
export function FournisseurAffectations({ children, ...choix }: ChoixAffectation & { children: ReactNode }) {
  const [ouverte, setOuverte] = useState<Ouverte | null>(null);
  const fermer = () => setOuverte(null);

  return (
    <Contexte value={{ choix, ouvrir: (affectation) => setOuverte({ affectation, mode: "detail" }) }}>
      {children}
      <Fenetre titre={TITRES[ouverte?.mode ?? "detail"]} ouverte={ouverte !== null} onFermer={fermer}>
        {ouverte?.mode === "detail" && (
          <Detail affectation={ouverte.affectation} changerMode={(mode) => setOuverte({ ...ouverte, mode })} />
        )}
        {ouverte?.mode === "modifier" && (
          <FormulaireAffectation
            {...choix}
            action={modifierAffectation.bind(null, ouverte.affectation.id)}
            valeurs={versValeurs(ouverte.affectation)}
            libelleBouton="Enregistrer"
            enCours="Enregistrement…"
            onSucces={fermer}
            onAnnuler={() => setOuverte({ ...ouverte, mode: "detail" })}
          />
        )}
        {ouverte?.mode === "cloturer" && (
          <Cloture
            affectation={ouverte.affectation}
            onSucces={fermer}
            onAnnuler={() => setOuverte({ ...ouverte, mode: "detail" })}
          />
        )}
      </Fenetre>
    </Contexte>
  );
}

/** Ouvre la fenêtre d'une affectation : une barre du planning, une ligne d'une fiche. */
export function OuvrirAffectation({
  affectation,
  ...props
}: { affectation: AffectationDetaillee } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "type">) {
  const { ouvrir } = useChoixAffectation();
  return <button type="button" onClick={() => ouvrir(affectation)} {...props} />;
}

function versValeurs({ vehicule_id, conducteur_id, debut, fin }: AffectationDetaillee): ValeursAffectation {
  const debutParis = partiesParis(debut);
  const finParis = fin ? partiesParis(fin) : null;
  return {
    vehicule_id,
    conducteur_id,
    debut_date: depuisIso(debutParis.date),
    debut_heure: debutParis.heure,
    fin_date: finParis ? depuisIso(finParis.date) : "",
    fin_heure: finParis?.heure ?? "",
  };
}

function Ligne({ terme, children }: { terme: string; children: ReactNode }) {
  return (
    <div className="grid gap-1">
      <dt className="font-mono text-meta font-medium text-secondary uppercase">{terme}</dt>
      <dd className="flex flex-wrap items-center gap-x-2 gap-y-1">{children}</dd>
    </div>
  );
}

function Detail({ affectation, changerMode }: { affectation: AffectationDetaillee; changerMode: (mode: Mode) => void }) {
  const { vehicule, conducteur, debut, fin } = affectation;
  const archivee = Boolean(vehicule.archive_le || conducteur.archive_le);
  // Sur un véhicule en lecture seule (retour en Free), une affectation en cours se clôture encore : rien d'autre.
  const lectureSeule = Boolean(vehicule.lecture_seule_le);

  return (
    <>
      <dl className="grid gap-4">
        <Ligne terme="Conducteur">
          <Link href={`/flotte/conducteurs/${conducteur.id}`}>{nomComplet(conducteur)}</Link>
          {conducteur.archive_le && <span className="text-label text-secondary">archivé</span>}
        </Ligne>
        <Ligne terme="Véhicule">
          <Plaque plaque={vehicule.plaque} />
          {vehicule.modele && <span className="text-secondary">{vehicule.modele}</span>}
          <Link href={`/flotte/vehicules/${vehicule.id}`} className="text-label">
            Voir sa fiche
          </Link>
          {vehicule.archive_le ? (
            <span className="text-label text-secondary">archivé</span>
          ) : (
            lectureSeule && <span className="text-label text-secondary">lecture seule</span>
          )}
        </Ligne>
        <Ligne terme="Créneau">{libelleCreneau(debut, fin)}</Ligne>
      </dl>
      {archivee ? (
        <Alerte>{MESSAGES.affectationArchivee}</Alerte>
      ) : lectureSeule ? (
        <>
          <Alerte>{MESSAGES.affectationLectureSeule(vehicule.plaque)}</Alerte>
          {!fin && (
            <div className="flex flex-wrap gap-2">
              <Bouton onClick={() => changerMode("cloturer")}>Clôturer</Bouton>
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-wrap gap-2">
          {!fin && <Bouton onClick={() => changerMode("cloturer")}>Clôturer</Bouton>}
          <Bouton variante={fin ? "primaire" : "secondaire"} onClick={() => changerMode("modifier")}>
            Modifier
          </Bouton>
        </div>
      )}
    </>
  );
}

const CHAMPS_CLOTURE = ["fin_date", "fin_heure"] as const;

/** Fixe la fin d'une affectation ouverte : la date du jour est proposée, l'heure est à saisir. */
function Cloture({
  affectation,
  onSucces,
  onAnnuler,
}: {
  affectation: AffectationDetaillee;
  onSucces: () => void;
  onAnnuler: () => void;
}) {
  const [etat, envoyer] = useActionState<EtatCloture, FormData>(
    async (precedent, formData) => {
      const suivant = await cloturerAffectation(affectation.id, precedent, formData);
      if (suivant.ok) onSucces();
      return suivant;
    },
    { valeurs: { fin_date: depuisIso(aujourdhuiParis()), fin_heure: "" } },
  );
  const { erreur, verifierALaSortie, effacerSiCorrige } = useVerificationALaSortie({
    champs: CHAMPS_CLOTURE,
    etat,
    verifier: (saisie) => verifierSaisieCloture(saisie, affectation.debut),
    dependances: { fin_date: ["fin_heure"], fin_heure: ["fin_date"] },
  });

  return (
    <form action={envoyer} onBlur={verifierALaSortie} onChange={effacerSiCorrige} className="grid gap-5" noValidate>
      <p className="text-secondary">
        {nomComplet(affectation.conducteur)} conduit {affectation.vehicule.plaque} depuis le{" "}
        {formaterDateHeure(affectation.debut)}. Jusqu&apos;à quand&nbsp;?
      </p>
      {etat.erreurs?.general && <Alerte variante="erreur">{etat.erreurs.general}</Alerte>}
      <div className="grid grid-cols-2 gap-4">
        <ChampDate
          name="fin_date"
          libelle="Date de fin"
          calendrier
          defaultValue={etat.valeurs?.fin_date}
          erreur={erreur("fin_date")}
        />
        <ChampHeure
          name="fin_heure"
          libelle="Heure de fin"
          defaultValue={etat.valeurs?.fin_heure}
          erreur={erreur("fin_heure")}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <BoutonEnvoi enCours="Clôture…">Clôturer</BoutonEnvoi>
        <Bouton variante="ghost" onClick={onAnnuler}>
          Annuler
        </Bouton>
      </div>
    </form>
  );
}
