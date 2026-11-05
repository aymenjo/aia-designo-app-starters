"use client";

import Link from "next/link";
import { Fragment, useState, useTransition } from "react";
import { Plaque } from "@/components/Plaque";
import { Alerte } from "@/components/ui/Alerte";
import { Bouton } from "@/components/ui/Bouton";
import { lienElement, type TypeElement } from "@/lib/agent/citations";
import {
  decrireLigne,
  lignesImpossibles,
  texteStatut,
  type Detail,
  type RecapitulatifConversation,
  type Ref,
  type Segment,
} from "@/lib/flotte/regles-recapitulatif";
import { annulerRecapitulatifAction, confirmerRecapitulatifAction } from "./actions";

// Le récapitulatif de modifications sous la réponse de l'agent (phase 29, DESIGN.md, Demande à Désigno) : une ligne
// numérotée par modification, l'avant barré puis l'après. Rien ne change avant « Confirmer », qui applique tout ou rien ;
// « Annuler » l'abandonne. Une fois appliqué : « Appliqué le JJ/MM/AAAA à HH:MM », et les éléments créés deviennent des
// liens.
//
// Phase 30 : une ligne que les règles des écrans refusent est rouge, avec leur motif à la place des détails, sans lien ;
// « Confirmer » reste désactivé tant qu'il en reste une. « Modifier » fait préciser la correction dans la saisie du
// panneau : l'agent refait le récapitulatif, et celui-ci ne s'applique plus.
//
// Phase 32 : dans une conversation terminée, rouverte en lecture seule, le récapitulatif n'a jamais de boutons ; il
// garde ses liens, pour vérifier d'un clic ce que l'agent a modifié.

type Props = { recapitulatif: RecapitulatifConversation } & (
  | { lectureSeule: true; surChangement?: never; surModifier?: never }
  | {
      lectureSeule?: false;
      /** Le nouvel état du récapitulatif, appliqué, annulé ou devenu inapplicable : le panneau le garde. */
      surChangement: (recapitulatif: RecapitulatifConversation) => void;
      /** « Modifier » : la saisie du panneau passe en correction. `null` : la saisie est désactivée (limite atteinte). */
      surModifier: (() => void) | null;
    }
);

export function Recapitulatif({ recapitulatif, lectureSeule, surChangement, surModifier }: Props) {
  const [erreur, setErreur] = useState<string | null>(null);
  const [action, setAction] = useState<"confirmer" | "annuler" | null>(null);
  const [enCours, demarrer] = useTransition();

  function agir(quoi: "confirmer" | "annuler") {
    if (lectureSeule) return;
    setErreur(null);
    setAction(quoi);
    demarrer(async () => {
      const resultat =
        quoi === "confirmer"
          ? await confirmerRecapitulatifAction(recapitulatif.id)
          : await annulerRecapitulatifAction(recapitulatif.id);
      if (resultat.recapitulatif) surChangement?.(resultat.recapitulatif);
      if (!resultat.ok) setErreur(resultat.erreur);
    });
  }

  /** Le lien d'un élément : existant, ou créé par une ligne une fois le récapitulatif appliqué. */
  function lien(type: TypeElement, ref: Ref): string | null {
    if ("id" in ref) return lienElement(type, ref.id);
    const cree = recapitulatif.crees[String(ref.ligne)];
    return cree ? lienElement(type, cree) : null;
  }

  function segment(morceau: Segment, rang: number) {
    if ("texte" in morceau) return <Fragment key={rang}>{morceau.texte}</Fragment>;
    if ("plaque" in morceau) {
      const href = lien("vehicule", morceau.ref);
      const plaque = <Plaque plaque={morceau.plaque} />;
      return href ? (
        <Link key={rang} href={href} className="no-underline">
          {plaque}
        </Link>
      ) : (
        <Fragment key={rang}>{plaque}</Fragment>
      );
    }
    const href = lien("conducteur", morceau.ref);
    return href ? (
      <Link key={rang} href={href}>
        {morceau.conducteur}
      </Link>
    ) : (
      <Fragment key={rang}>{morceau.conducteur}</Fragment>
    );
  }

  /** Sur une ligne rouge : la plaque en mono, sans cadre, et aucun lien. */
  function segmentRouge(morceau: Segment, rang: number) {
    if ("texte" in morceau) return <Fragment key={rang}>{morceau.texte}</Fragment>;
    if ("plaque" in morceau) {
      return (
        <span key={rang} className="font-mono font-medium">
          {morceau.plaque}
        </span>
      );
    }
    return <Fragment key={rang}>{morceau.conducteur}</Fragment>;
  }

  function detail(element: Detail, rang: number) {
    return (
      <Fragment key={rang}>
        {rang > 0 && " · "}
        {"texte" in element ? (
          element.texte
        ) : (
          <>
            {element.libelle && <>{element.libelle}&nbsp;: </>}
            {element.avant !== undefined && (
              <>
                <s className="text-disabled">{element.avant}</s> →{" "}
              </>
            )}
            <span className="font-medium text-ink">{element.apres}</span>
          </>
        )}
      </Fragment>
    );
  }

  const statut = texteStatut(recapitulatif);
  const rouges = lignesImpossibles(recapitulatif.lignes).length > 0;

  return (
    <section aria-label="Récapitulatif des modifications" className="grid gap-3">
      <ol className="overflow-hidden rounded-card border border-line">
        {recapitulatif.lignes.map((ligne, rang) => {
          const { quoi, details, refus } = decrireLigne(ligne);
          return (
            <li
              key={rang}
              className={`grid grid-cols-[22px_minmax(0,1fr)] gap-x-2 gap-y-0.5 border-line p-3 text-label not-first:border-t ${refus ? "bg-urgent-tint" : ""}`}
            >
              <span
                aria-hidden
                className={`row-span-2 pt-px font-mono text-caption font-medium ${refus ? "text-urgent" : "text-secondary"}`}
              >
                {rang + 1}
              </span>
              <span className={`leading-6 font-medium ${refus ? "text-urgent" : ""}`}>{quoi.map(refus ? segmentRouge : segment)}</span>
              {refus ? (
                <span className="text-urgent">
                  <span className="sr-only">Impossible&nbsp;: </span>
                  {refus}
                </span>
              ) : (
                details.length > 0 && <span className="text-secondary">{details.map(detail)}</span>
              )}
            </li>
          );
        })}
      </ol>
      {statut ? (
        <p className={recapitulatif.statut === "applique" ? "text-label font-medium" : "text-label text-secondary"}>{statut}</p>
      ) : lectureSeule ? null : (
        <div className="flex flex-wrap gap-2">
          {/* Une ligne rouge bloque « Confirmer » : « Modifier » la fait corriger ou retirer. */}
          <Bouton taille="sm" onClick={() => agir("confirmer")} disabled={enCours || rouges}>
            {enCours && action === "confirmer" ? "Application…" : "Confirmer"}
          </Bouton>
          <Bouton taille="sm" variante="ghost" onClick={surModifier ?? undefined} disabled={enCours || !surModifier}>
            Modifier
          </Bouton>
          <Bouton taille="sm" variante="ghost" onClick={() => agir("annuler")} disabled={enCours}>
            Annuler
          </Bouton>
        </div>
      )}
      {erreur && <Alerte variante="erreur">{erreur}</Alerte>}
    </section>
  );
}
