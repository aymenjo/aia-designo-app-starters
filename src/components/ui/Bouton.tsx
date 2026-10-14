import type { ButtonHTMLAttributes } from "react";

type Variante = "primaire" | "secondaire" | "ghost";
type Taille = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 rounded-full border font-medium whitespace-nowrap no-underline cursor-pointer transition-colors duration-120 ease-enter disabled:cursor-not-allowed disabled:border-transparent disabled:bg-line disabled:text-disabled";

const variantes: Record<Variante, string> = {
  primaire: "border-transparent bg-ink text-white hover:bg-ink-hover",
  secondaire: "bg-white border-line-strong text-ink hover:border-ink",
  ghost: "border-transparent bg-transparent text-ink hover:bg-[rgb(0_0_0/0.05)]",
};

const tailles: Record<Taille, string> = {
  sm: "h-8 px-3 text-label",
  md: "h-10 px-[18px] text-body",
  lg: "h-14 px-6 text-lead font-semibold",
};

export function classesBouton({
  variante = "primaire",
  taille = "md",
  pleineLargeur = false,
}: { variante?: Variante; taille?: Taille; pleineLargeur?: boolean } = {}) {
  return [base, variantes[variante], tailles[taille], pleineLargeur && "w-full"]
    .filter(Boolean)
    .join(" ");
}

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: Variante;
  taille?: Taille;
  pleineLargeur?: boolean;
};

export function Bouton({
  variante,
  taille,
  pleineLargeur,
  className,
  type = "button",
  ...props
}: Props) {
  return (
    <button
      type={type}
      className={[classesBouton({ variante, taille, pleineLargeur }), className]
        .filter(Boolean)
        .join(" ")}
      {...props}
    />
  );
}
