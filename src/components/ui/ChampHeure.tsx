"use client";

import type { ComponentProps } from "react";
import { normaliserHeure } from "@/lib/dates";
import { Champ } from "./Champ";

type Props = Omit<ComponentProps<typeof Champ>, "type" | "placeholder" | "inputMode">;

/**
 * Heure saisie au clavier, sur 24 h, réécrite à la sortie du champ (« 8h30 », « 0830 » → « 08:30 »).
 * Pas de champ natif : son format (12 h ou 24 h) dépend du navigateur et de la langue du système.
 */
export function ChampHeure({ onBlur, ...props }: Props) {
  return (
    <Champ
      placeholder="HH:MM"
      inputMode="numeric"
      autoComplete="off"
      {...props}
      onBlur={(e) => {
        const heure = normaliserHeure(e.currentTarget.value);
        if (heure) e.currentTarget.value = heure;
        onBlur?.(e);
      }}
    />
  );
}
