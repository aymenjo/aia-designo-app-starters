import { Plaque } from "@/components/Plaque";
import type { AffectationDetaillee } from "@/lib/flotte/affectations";
import { libelleCreneau } from "@/lib/flotte/planning";
import { nomComplet } from "@/lib/flotte/regles";
import { OuvrirAffectation } from "./FenetreAffectation";

type Props = {
  affectations: AffectationDetaillee[];
  /** Sur la fiche d'un véhicule, on nomme le conducteur ; sur celle d'un conducteur, le véhicule. */
  afficher: "conducteur" | "vehicule";
};

/** Les affectations d'une fiche, les plus récentes d'abord : chaque ligne ouvre sa fenêtre. */
export function ListeAffectations({ affectations, afficher }: Props) {
  if (!affectations.length) return <p className="text-secondary">Aucune affectation pour l&apos;instant.</p>;

  return (
    <ul className="divide-y divide-line overflow-hidden rounded-card border border-line">
      {affectations.map((affectation) => (
        <li key={affectation.id}>
          <OuvrirAffectation
            affectation={affectation}
            className="grid min-h-13 w-full cursor-pointer grid-cols-[minmax(0,180px)_minmax(0,1fr)] items-center gap-3 px-4 py-2 text-left transition-colors duration-120 ease-enter hover:bg-surface max-sm:grid-cols-1 max-sm:gap-1"
          >
            {afficher === "conducteur" ? (
              <span className="truncate font-medium">{nomComplet(affectation.conducteur)}</span>
            ) : (
              <span>
                <Plaque plaque={affectation.vehicule.plaque} />
              </span>
            )}
            <span className="text-secondary">{libelleCreneau(affectation.debut, affectation.fin)}</span>
          </OuvrirAffectation>
        </li>
      ))}
    </ul>
  );
}
