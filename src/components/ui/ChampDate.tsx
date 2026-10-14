"use client";

import { CalendarDays } from "lucide-react";
import { useRef, type ComponentProps } from "react";
import { depuisIso, normaliserDate, versIso } from "@/lib/dates";
import { Champ } from "./Champ";

type Props = Omit<ComponentProps<typeof Champ>, "type" | "placeholder" | "inputMode" | "suffixe" | "ref"> & {
  /** Un bouton ouvre le calendrier : utile pour une date proche (affectation), pas pour une date de naissance. */
  calendrier?: boolean;
};

/** Écrit la valeur comme une frappe : la vérification « dès la saisie » du formulaire la voit passer. */
function ecrire(champ: HTMLInputElement, valeur: string) {
  // Le setter natif contourne le suivi de valeur de React, qui ignorerait sinon l'événement.
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(champ, valeur);
  champ.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * Date saisie au clavier, JJ/MM/AAAA, réécrite à la sortie du champ (« 12031985 » → « 12/03/1985 »).
 * Le champ reste un texte : le format d'un champ date natif dépend de la langue du navigateur. Avec `calendrier`,
 * un bouton ouvre le calendrier du navigateur, et le jour choisi s'écrit en JJ/MM/AAAA dans le champ texte.
 */
export function ChampDate({ onBlur, calendrier = false, ...props }: Props) {
  const texte = useRef<HTMLInputElement>(null);
  const natif = useRef<HTMLInputElement>(null);

  function ouvrirCalendrier() {
    if (!texte.current || !natif.current) return;
    // Le calendrier s'ouvre sur la date déjà saisie, sinon sur aujourd'hui.
    const jjmmaaaa = normaliserDate(texte.current.value);
    natif.current.value = (jjmmaaaa && versIso(jjmmaaaa)) || "";
    try {
      natif.current.showPicker();
    } catch {
      texte.current.focus();
    }
  }

  return (
    <Champ
      ref={texte}
      placeholder="JJ/MM/AAAA"
      inputMode="numeric"
      autoComplete="off"
      {...props}
      onBlur={(e) => {
        const date = normaliserDate(e.currentTarget.value);
        if (date) e.currentTarget.value = date;
        onBlur?.(e);
      }}
      suffixe={
        calendrier && (
          <>
            <button
              type="button"
              aria-label="Choisir dans le calendrier"
              title="Calendrier"
              onClick={ouvrirCalendrier}
              className="absolute top-1/2 right-1 grid size-8 -translate-y-1/2 cursor-pointer place-items-center rounded-full text-secondary transition-colors duration-120 ease-enter hover:bg-[rgb(0_0_0/0.05)] hover:text-ink disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-secondary"
            >
              <CalendarDays size={16} strokeWidth={1.5} aria-hidden />
            </button>
            {/* Sans nom, il n'est pas envoyé. Collé sous le champ, son calendrier s'ouvre juste en dessous. */}
            <input
              ref={natif}
              type="date"
              tabIndex={-1}
              aria-hidden
              className="pointer-events-none absolute bottom-0 left-0 h-px w-full opacity-0"
              onChange={(e) => {
                if (!e.currentTarget.value || !texte.current) return;
                texte.current.focus();
                ecrire(texte.current, depuisIso(e.currentTarget.value));
              }}
            />
          </>
        )
      }
    />
  );
}
