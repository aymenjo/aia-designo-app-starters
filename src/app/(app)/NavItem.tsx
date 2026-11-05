"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { ReactNode } from "react";

type Props = {
  href: string;
  /** Préfixe des routes où l'élément est actif, quand il couvre plusieurs écrans (`/parametres`). */
  section?: string;
  icone: ReactNode;
  children: string;
};

/** `icone` est déjà rendue : un composant ne traverse pas la frontière serveur → client. */
export function NavItem({ href, section = href, icone, children }: Props) {
  const actif = usePathname().startsWith(section);
  return (
    <Link
      href={href}
      aria-current={actif ? "page" : undefined}
      className={[
        "flex h-9 items-center gap-2.5 rounded-full px-3 no-underline transition-colors duration-120 ease-enter",
        actif
          ? "bg-[rgb(0_0_0/0.06)] font-semibold text-ink"
          : "font-medium text-secondary hover:bg-[rgb(0_0_0/0.04)] hover:text-ink",
      ].join(" ")}
    >
      {icone}
      {children}
    </Link>
  );
}
