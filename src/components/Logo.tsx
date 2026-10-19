import Link from "next/link";

// La jauge des 45 jours, bouclée (docs/design-preview.html, symbole logo-mark).
export function LogoSymbole({ className = "size-[22px]" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={`flex-none ${className}`}>
      <circle cx="12" cy="12" r="10" fill="none" stroke="#0E7A4E" strokeWidth="2.5" />
      <path
        d="m7.5 12.2 3 3 6-6.2"
        fill="none"
        stroke="#0E7A4E"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Logo({ href = "/tableau-de-bord" }: { href?: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 font-display text-[18px] font-extrabold tracking-[-0.02em] text-ink no-underline"
    >
      <LogoSymbole />
      Désigno
    </Link>
  );
}
