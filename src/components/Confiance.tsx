import type { MouseEvent, ReactNode } from "react";
import { Bouton } from "@/components/ui/Bouton";
import { LIBELLES_CONFIANCE, type Confiance, type ValeurRefusee } from "@/lib/avis/regles";

// Confiance par champ d'un avis lu par l'IA (DESIGN.md) : un point devant le libellé, un mot à droite et un filet
// gauche, dans la couleur du niveau. Un champ rouge a un fond teinté et se confirme à la main. Un champ lu mais
// refusé par les règles est rouge et vide : il montre ce que l'IA a relevé, et pourquoi ce n'est pas repris.

const REMPLISSAGE: Record<Confiance, string> = { sur: "bg-ok", a_verifier: "bg-watch-fill", non_lu: "bg-urgent-fill" };
const TEXTE: Record<Confiance, string> = { sur: "text-ok", a_verifier: "text-watch", non_lu: "text-urgent" };
const FILET: Record<Confiance, string> = {
  sur: "border-ok",
  a_verifier: "border-watch-fill",
  non_lu: "border-urgent-fill bg-urgent-tint",
};

/** Point de 8 px, devant le libellé. */
export function PastilleConfiance({ niveau }: { niveau: Confiance }) {
  return <span aria-hidden className={`size-2 flex-none rounded-full ${REMPLISSAGE[niveau]}`} />;
}

/** « Sûr », « À vérifier » ou « Non lu », à droite du libellé ; « Refusé » pour une valeur lue mais refusée. */
export function MotConfiance({ niveau, refusee = false }: { niveau: Confiance; refusee?: boolean }) {
  return <span className={`text-caption ${TEXTE[niveau]}`}>{refusee ? "Refusé" : LIBELLES_CONFIANCE[niveau]}</span>;
}

/**
 * Le filet gauche autour d'un champ lu, et le bouton « Confirmer ce champ » d'un champ rouge rempli. Débordant
 * d'autant que son retrait, il laisse le champ aligné sur ses voisins. L'enveloppe est toujours là, seules ses
 * classes changent : le champ n'est jamais remonté, ce qui viderait sa saisie.
 */
export function CadreConfiance({
  niveau,
  masque = false,
  libelle,
  refusee,
  onConfirmer,
  children,
}: {
  /** Le niveau enregistré ; aucun pour un champ jamais lu, ou déjà saisi ou confirmé. */
  niveau?: Confiance;
  /** Le gestionnaire vient de modifier ou de confirmer le champ : le cadre reste en place, sans couleur. */
  masque?: boolean;
  /** Le champ, nommé dans le bouton : plusieurs champs peuvent attendre leur confirmation. */
  libelle: string;
  /** La valeur lue sur l'avis mais refusée par les règles, montrée sous le champ vide avec son motif. */
  refusee?: ValeurRefusee;
  onConfirmer?: (e: MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
}) {
  const classes = [
    "grid min-w-0 gap-2",
    niveau &&
      "-mr-3 -ml-4 rounded-r-field border-l-2 py-2 pr-3 pl-3.5 transition-colors duration-200 ease-enter",
    niveau && (masque ? "border-transparent" : FILET[niveau]),
  ];
  return (
    <div className={classes.filter(Boolean).join(" ")}>
      {children}
      {refusee && (
        <p className="text-label text-urgent">
          Relevé sur l&apos;avis&nbsp;: <span className="font-mono font-medium break-all">{refusee.valeur}</span>.{" "}
          {refusee.motif}
        </p>
      )}
      {onConfirmer && (
        <Bouton
          variante="secondaire"
          taille="sm"
          className="justify-self-start"
          aria-label={`Confirmer ce champ : ${libelle}`}
          onClick={onConfirmer}
        >
          Confirmer ce champ
        </Bouton>
      )}
    </div>
  );
}
