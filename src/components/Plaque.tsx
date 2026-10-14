/** La plaque : la seule forme rectangulaire de l'interface (rayon 4 px), à ne jamais arrondir. */
export function Plaque({ plaque, grand = false }: { plaque: string; grand?: boolean }) {
  return (
    <span
      className={[
        "inline-flex items-center rounded-plate border border-ink bg-white font-mono font-medium tracking-[0.02em] whitespace-nowrap text-ink",
        grand ? "h-9 px-3 text-title-sm" : "h-6 px-[7px] text-label",
      ].join(" ")}
    >
      {plaque}
    </span>
  );
}
