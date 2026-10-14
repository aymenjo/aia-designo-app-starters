import { CircleAlert, CircleCheck, Info } from "lucide-react";
import type { ReactNode } from "react";

type Variante = "info" | "succes" | "erreur";

const styles: Record<Variante, string> = {
  info: "bg-surface text-ink",
  succes: "bg-ok-tint text-ok",
  erreur: "bg-urgent-tint text-urgent",
};

const icones = { info: Info, succes: CircleCheck, erreur: CircleAlert };

export function Alerte({ variante = "info", children }: { variante?: Variante; children: ReactNode }) {
  const Icone = icones[variante];
  return (
    <div
      role={variante === "erreur" ? "alert" : "status"}
      className={`flex gap-3 rounded-card px-4 py-3 text-body ${styles[variante]}`}
    >
      <Icone size={16} strokeWidth={1.5} aria-hidden className="mt-0.5 flex-none" />
      <div className="grid gap-0.5">{children}</div>
    </div>
  );
}
