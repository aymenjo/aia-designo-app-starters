import { CircleAlert } from "lucide-react";
import { useId } from "react";

type Props<Valeur extends string> = {
  name: string;
  legende: string;
  options: readonly Valeur[];
  libelles: Record<Valeur, string>;
  defaultValue?: string;
  aide?: string;
  erreur?: string;
};

/** Choix exclusif en pilules (type de véhicule, civilité) : de vrais boutons radio, habillés. */
export function ChoixPilules<Valeur extends string>({
  name,
  legende,
  options,
  libelles,
  defaultValue,
  aide,
  erreur,
}: Props<Valeur>) {
  const idMessage = useId();
  const message = erreur ?? aide;

  return (
    <fieldset className="min-w-0" aria-describedby={message ? idMessage : undefined}>
      <legend className="text-label font-medium">{legende}</legend>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {options.map((option) => (
          <label
            key={option}
            className="relative inline-flex h-10 cursor-pointer items-center rounded-full border border-line-strong bg-white px-[18px] font-medium transition-colors duration-120 ease-enter hover:border-ink has-checked:border-ink has-checked:bg-[rgb(0_0_0/0.06)] has-checked:font-semibold has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ink has-disabled:cursor-not-allowed has-disabled:text-secondary has-disabled:hover:border-line-strong"
          >
            <input
              type="radio"
              name={name}
              value={option}
              defaultChecked={defaultValue === option}
              // Transparent, il couvre toute la pilule : le clic et le focus restent sur le vrai bouton radio.
              className="absolute inset-0 cursor-pointer appearance-none rounded-full opacity-0 disabled:cursor-not-allowed"
            />
            {libelles[option]}
          </label>
        ))}
      </div>
      {erreur ? (
        <p id={idMessage} className="mt-1.5 flex items-center gap-1.5 text-label text-urgent">
          <CircleAlert size={16} strokeWidth={1.5} aria-hidden className="flex-none" />
          <span>{erreur}</span>
        </p>
      ) : aide ? (
        <p id={idMessage} className="mt-1.5 text-label text-secondary">
          {aide}
        </p>
      ) : null}
    </fieldset>
  );
}
