import { DELAI_DESIGNATION_JOURS, joursRestants, niveauEcheance, type NiveauEcheance } from "@/lib/avis/echeance";
import { depuisIso } from "@/lib/dates";

const styles: Record<NiveauEcheance, { pastille: string; fort: string; piste: string; jauge: string }> = {
  calme: { pastille: "border-line bg-white text-secondary", fort: "text-ink", piste: "bg-line", jauge: "bg-gray-300" },
  a_regarder: {
    pastille: "border-transparent bg-watch-tint text-watch",
    fort: "text-watch",
    piste: "bg-watch-fill/20",
    jauge: "bg-watch-fill",
  },
  urgent: {
    pastille: "border-transparent bg-urgent-tint text-urgent",
    fort: "text-urgent",
    piste: "bg-urgent-fill/15",
    jauge: "bg-urgent-fill",
  },
  depassee: {
    pastille: "border-transparent bg-urgent-tint text-urgent",
    fort: "text-urgent",
    piste: "bg-urgent-fill/15",
    jauge: "bg-urgent-fill",
  },
};

type Props = {
  /** L'échéance, en ISO. */
  echeance: string;
  /** Dans une liste : « avant le JJ/MM », jauge de 32 px. Sinon « avant le JJ/MM/AAAA », jauge de 40 px. */
  court?: boolean;
  aujourdhui?: string;
};

/**
 * Le compte à rebours des 45 jours : une pilule et une jauge qui se vide à l'approche de l'échéance.
 * Ses couleurs suivent les seuils des alertes (J-15, J-7, J-2). Le statut de l'avis ne change pas.
 */
export function Echeance({ echeance, court = false, aujourdhui }: Props) {
  const jours = joursRestants(echeance, aujourdhui);
  const niveau = niveauEcheance(jours);
  const style = styles[niveau];
  const date = court ? depuisIso(echeance).slice(0, 5) : depuisIso(echeance);
  const reste = Math.min(Math.max(jours / DELAI_DESIGNATION_JOURS, 0), 1);

  return (
    <span
      className={[
        "inline-flex h-7 items-center rounded-full border text-label font-medium whitespace-nowrap",
        court ? "gap-2 px-2.5" : "gap-2.5 px-3",
        style.pastille,
      ].join(" ")}
    >
      <span>
        {niveau === "depassee" ? `dépassée le ${date}` : `avant le ${date}`} ·{" "}
        <b className={`font-semibold ${style.fort}`}>{jours < 0 ? `J+${-jours}` : `J-${jours}`}</b>
      </span>
      <span aria-hidden className={`relative h-1 flex-none overflow-hidden rounded-full ${court ? "w-8" : "w-10"} ${style.piste}`}>
        <i
          className={`absolute inset-y-0 left-0 origin-left animate-gauge-fill rounded-full ${style.jauge}`}
          style={{ width: `${reste * 100}%` }}
        />
      </span>
    </span>
  );
}
