import { ChevronDown } from "lucide-react";
import type { ReactNode, SelectHTMLAttributes } from "react";
import { MessageChamp, classesChamp } from "./Champ";

type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> & {
  name: string;
  libelle: string;
  options: readonly { valeur: string; libelle: string }[];
  /** L'option vide, en tête : « Choisir un véhicule ». */
  vide?: string;
  aide?: string;
  erreur?: ReactNode;
};

/** Liste déroulante native, habillée comme `Champ` : le clavier et le mobile restent ceux du navigateur. */
export function ChampListe({
  libelle,
  options,
  vide,
  aide,
  erreur,
  name,
  id = name,
  className,
  defaultValue,
  ...props
}: Props) {
  const idMessage = `${id}-message`;
  const message = erreur ?? aide;

  return (
    <div className={["grid min-w-0 content-start gap-1.5", className].filter(Boolean).join(" ")}>
      <label htmlFor={id} className="text-label font-medium">
        {libelle}
      </label>
      <div className="relative">
        <select
          // React ne reporte pas un nouveau `defaultValue` sur une liste déjà affichée : la clé la recrée. La remise
          // à zéro du formulaire après l'envoi retombe ainsi sur la valeur renvoyée, et non sur l'option vide.
          key={String(defaultValue ?? "")}
          defaultValue={defaultValue}
          id={id}
          name={name}
          aria-invalid={erreur ? true : undefined}
          aria-describedby={message ? idMessage : undefined}
          className={`${classesChamp(Boolean(erreur))} cursor-pointer appearance-none truncate pr-9`}
          {...props}
        >
          {vide !== undefined && <option value="">{vide}</option>}
          {options.map((option) => (
            <option key={option.valeur} value={option.valeur}>
              {option.libelle}
            </option>
          ))}
        </select>
        <ChevronDown
          size={16}
          strokeWidth={1.5}
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-secondary"
        />
      </div>
      <MessageChamp id={idMessage} erreur={erreur} aide={aide} />
    </div>
  );
}
