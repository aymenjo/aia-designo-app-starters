import Link from "next/link";
import { LIMITES_FREE, type Plan } from "@/lib/abonnement/plans";
import type { Usage } from "@/lib/abonnement/quotas";

/**
 * Le compteur d'usage (DESIGN.md) : « 2/3 véhicules | 4/5 avis ce mois-ci » en Free, « Plan Pro » en Pro. Toujours
 * visible, il mène à l'écran Abonnement.
 */
export function CompteurUsage({ plan, usage }: { plan: Plan; usage: Usage }) {
  return (
    <Link
      href="/parametres/abonnement"
      className="inline-flex h-8 flex-none items-center gap-2.5 rounded-full border border-line bg-surface px-3 text-label whitespace-nowrap text-secondary no-underline transition-colors duration-120 ease-enter hover:border-line-strong"
    >
      {plan === "pro" ? (
        <span className="font-medium text-ink">Plan Pro</span>
      ) : (
        <>
          <span>
            <strong className="font-semibold text-ink">
              {usage.vehicules}/{LIMITES_FREE.vehicules}
            </strong>{" "}
            véhicules
          </span>
          <span aria-hidden className="h-3.5 w-px bg-line-strong" />
          <span>
            <strong className="font-semibold text-ink">
              {usage.avisCeMois}/{LIMITES_FREE.avisParMois}
            </strong>{" "}
            avis ce mois-ci
          </span>
        </>
      )}
    </Link>
  );
}
