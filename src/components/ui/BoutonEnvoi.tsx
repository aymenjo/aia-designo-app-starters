"use client";

import { useFormStatus } from "react-dom";
import { Bouton } from "./Bouton";

type Props = Omit<React.ComponentProps<typeof Bouton>, "type"> & { enCours?: string };

/** Bouton de soumission désactivé pendant l'envoi du formulaire. */
export function BoutonEnvoi({ children, enCours, disabled, ...props }: Props) {
  const { pending } = useFormStatus();
  return (
    <Bouton type="submit" disabled={disabled || pending} aria-busy={pending || undefined} {...props}>
      {pending && enCours ? enCours : children}
    </Bouton>
  );
}
