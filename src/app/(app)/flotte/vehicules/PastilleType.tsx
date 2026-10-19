import { LIBELLES_TYPE, type TypeVehicule } from "@/lib/flotte/regles";

/** Pastille neutre : le type n'est pas un signal, il ne prend aucune couleur. */
export function PastilleType({ type }: { type: TypeVehicule }) {
  return (
    <span className="inline-flex h-6 items-center rounded-full border border-line bg-surface px-2.5 text-caption font-medium whitespace-nowrap">
      {LIBELLES_TYPE[type]}
    </span>
  );
}
