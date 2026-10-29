import { CircleAlert } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

/** Le cadre d'un champ (saisie, liste) : filet, survol, focus, erreur. */
export function classesChamp(erreur: boolean) {
  return [
    "h-10 w-full rounded-field border bg-white px-3 text-ink transition-[border-color,box-shadow] duration-120 ease-enter placeholder:text-disabled hover:border-gray-300 focus:border-ink focus:shadow-[0_0_0_3px_rgb(32_32_32/0.10)] focus:outline-none disabled:cursor-not-allowed disabled:bg-surface disabled:text-secondary disabled:hover:border-line-strong",
    erreur ? "border-urgent-fill" : "border-line-strong",
  ].join(" ");
}

/** Le message sous un champ : l'erreur, sinon l'aide. */
export function MessageChamp({ id, erreur, aide }: { id: string; erreur?: ReactNode; aide?: string }) {
  if (erreur) {
    return (
      <p id={id} className="flex items-center gap-1.5 text-label text-urgent">
        <CircleAlert size={16} strokeWidth={1.5} aria-hidden className="flex-none" />
        <span>{erreur}</span>
      </p>
    );
  }
  return aide ? (
    <p id={id} className="text-label text-secondary">
      {aide}
    </p>
  ) : null;
}

type Props = ComponentProps<"input"> & {
  name: string;
  libelle: string;
  aide?: string;
  erreur?: ReactNode;
  /** Données copiables (plaque, SIREN, permis) : JetBrains Mono, en majuscules. */
  mono?: boolean;
  /** Placé dans le champ, à droite : le bouton calendrier d'une date. */
  suffixe?: ReactNode;
  /** Devant le libellé : le point de confiance d'un champ lu par l'IA. */
  pastille?: ReactNode;
  /** Sur la ligne du libellé, à droite : le niveau de confiance en toutes lettres. */
  indication?: ReactNode;
};

export function Champ({
  libelle,
  aide,
  erreur,
  mono = false,
  suffixe,
  pastille,
  indication,
  name,
  id = name,
  className,
  ...props
}: Props) {
  const idMessage = `${id}-message`;
  const message = erreur ?? aide;
  const etiquette = (
    <label
      htmlFor={id}
      className={["text-label font-medium", pastille && "flex items-center gap-1.5"].filter(Boolean).join(" ")}
    >
      {pastille}
      {libelle}
    </label>
  );

  return (
    // content-start : côte à côte, un voisin au message sur deux lignes ne décale pas ce champ.
    <div className={["grid min-w-0 content-start gap-1.5", className].filter(Boolean).join(" ")}>
      {indication ? (
        <div className="flex items-center justify-between gap-3">
          {etiquette}
          {indication}
        </div>
      ) : (
        etiquette
      )}
      <div className="relative">
        <input
          id={id}
          name={name}
          aria-invalid={erreur ? true : undefined}
          aria-describedby={message ? idMessage : undefined}
          className={[classesChamp(Boolean(erreur)), mono && "font-mono font-medium uppercase", suffixe && "pr-10"]
            .filter(Boolean)
            .join(" ")}
          {...props}
        />
        {suffixe}
      </div>
      <MessageChamp id={idMessage} erreur={erreur} aide={aide} />
    </div>
  );
}
