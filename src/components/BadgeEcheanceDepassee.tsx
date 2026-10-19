/** Badge plein « Échéance dépassée » sur un avis ouvert : l'urgent se voit, sans changer le statut. */
export function BadgeEcheanceDepassee() {
  return (
    <span className="inline-flex h-6 items-center rounded-full bg-urgent-fill px-2.5 text-caption font-semibold whitespace-nowrap text-white">
      Échéance dépassée
    </span>
  );
}
