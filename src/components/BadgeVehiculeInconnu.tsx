/** « Véhicule inconnu » en ambre : la plaque d'un avis ouvert n'est celle d'aucun véhicule de la flotte. */
export function BadgeVehiculeInconnu() {
  return (
    <span className="inline-flex h-6 items-center rounded-full bg-watch-tint px-2.5 text-caption font-medium whitespace-nowrap text-watch">
      Véhicule inconnu
    </span>
  );
}
