import Link from "next/link";

type Pilule = { href: string; libelle: string; actif: boolean };

/** Navigation segmentée en pilules (vue du planning, filtre des avis) : l'élément actif porte `aria-current`. */
export function NavPilules({ libelle, pilules }: { libelle: string; pilules: readonly Pilule[] }) {
  return (
    <nav aria-label={libelle} className="flex h-10 w-fit items-center gap-1 rounded-full border border-line p-1">
      {pilules.map(({ href, libelle, actif }) => (
        <Link
          key={href}
          href={href}
          aria-current={actif ? "page" : undefined}
          className={[
            "flex h-8 items-center rounded-full px-3 text-label no-underline transition-colors duration-120 ease-enter",
            actif
              ? "bg-[rgb(0_0_0/0.06)] font-semibold text-ink"
              : "font-medium text-secondary hover:bg-[rgb(0_0_0/0.04)] hover:text-ink",
          ].join(" ")}
        >
          {libelle}
        </Link>
      ))}
    </nav>
  );
}
