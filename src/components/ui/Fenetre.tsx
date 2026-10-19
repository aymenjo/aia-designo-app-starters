"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";

type Props = {
  titre: string;
  ouverte: boolean;
  onFermer: () => void;
  children: ReactNode;
};

/**
 * Fenêtre modale sur `<dialog>` natif : `showModal()` apporte le piège du focus et la touche Échap.
 * Le contenu n'est monté que fenêtre ouverte : un formulaire repart vide à chaque ouverture. Pas de `relative` : il
 * remplacerait le `position: fixed` de la fenêtre modale, qui se placerait alors en haut de la page, et non de l'écran.
 */
export function Fenetre({ titre, ouverte, onFermer, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const idTitre = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (ouverte && !dialog.open) dialog.showModal();
    if (!ouverte && dialog.open) dialog.close();
  }, [ouverte]);

  return (
    <dialog
      ref={ref}
      onClose={onFermer}
      aria-labelledby={idTitre}
      className="m-auto w-[calc(100%-32px)] max-w-[480px] rounded-panel border border-line bg-white p-6 text-ink shadow-popover backdrop:bg-ink/25"
    >
      {ouverte && (
        <div className="grid gap-5">
          <h2 id={idTitre} className="pr-10 font-display text-title-sm font-bold">
            {titre}
          </h2>
          {children}
          {/* Placé après le contenu : à l'ouverture, le focus va au premier champ, pas à « Fermer ». */}
          <button
            type="button"
            aria-label="Fermer"
            onClick={onFermer}
            className="absolute top-5 right-5 grid size-8 cursor-pointer place-items-center rounded-full text-secondary transition-colors duration-120 ease-enter hover:bg-[rgb(0_0_0/0.05)] hover:text-ink"
          >
            <X size={16} strokeWidth={1.5} aria-hidden />
          </button>
        </div>
      )}
    </dialog>
  );
}
