import { Check } from "lucide-react";
import { LIBELLES_STATUT, type StatutAvis as Statut } from "@/lib/avis/regles";

// Les statuts restent neutres : l'urgence vient de la pastille d'échéance, jamais du statut.
const styles: Record<Statut, string> = {
  a_traiter: "border-line bg-surface text-ink",
  a_valider: "border-transparent bg-ink text-white",
  designe: "border-transparent bg-ok-tint text-ok",
  classe: "border-dashed border-gray-300 bg-transparent text-secondary",
};

export function StatutAvis({ statut }: { statut: Statut }) {
  return (
    <span
      className={`inline-flex h-6 items-center gap-1 rounded-full border px-2.5 text-caption font-medium whitespace-nowrap ${styles[statut]}`}
    >
      {statut === "designe" && <Check size={14} strokeWidth={2} aria-hidden />}
      {LIBELLES_STATUT[statut]}
    </span>
  );
}
