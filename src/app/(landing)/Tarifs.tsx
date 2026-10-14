import { Check } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { classesBouton } from "@/components/ui/Bouton";
import {
  DEMANDES_AGENT_PAR_MOIS,
  LIMITES_FREE,
  PRIX_PRO_HT_CENTIMES,
  PRIX_PRO_TTC_CENTIMES,
} from "@/lib/abonnement/plans";
import { formaterEuros, formaterMontant } from "@/lib/format";

const FREE: ReactNode[] = [
  `${LIMITES_FREE.vehicules} véhicules actifs`,
  `${LIMITES_FREE.avisParMois} avis par mois`,
  `Historique sur ${LIMITES_FREE.historiqueMois} mois`,
  "Lecture des avis par l'IA",
  "Conducteur proposé et récap ANTAI",
  <>
    Alertes par email à <span className="whitespace-nowrap">J-15, J-7 et J-2</span>
  </>,
];

const PRO = [
  "Véhicules et avis illimités",
  "Historique complet",
  "Relève automatique d'un libellé Gmail",
  "Rappels dans Google Calendar",
  "Email au conducteur désigné",
  `Demande à Désigno, ${DEMANDES_AGENT_PAR_MOIS} demandes par mois`,
  "Export CSV et rapport mensuel PDF",
];

function Avantages({ titre, avantages }: { titre: string; avantages: readonly ReactNode[] }) {
  return (
    <div className="grid gap-3">
      <p className="text-label font-medium text-secondary">{titre}</p>
      <ul className="grid gap-2.5">
        {avantages.map((avantage, i) => (
          <li key={i} className="flex gap-2.5">
            <Check size={16} strokeWidth={1.5} aria-hidden className="mt-0.5 flex-none" />
            <span>{avantage}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Les plans Free et Pro : les chiffres viennent de `@/lib/abonnement/plans`. */
export function Tarifs() {
  return (
    <div className="grid gap-6">
      <div className="grid gap-6 md:grid-cols-2">
        <article className="grid content-start gap-6 rounded-panel border border-line p-8 max-md:p-6">
          <div className="grid gap-3">
            <h3 className="inline-flex h-6 w-fit items-center rounded-full border border-line bg-surface px-2.5 font-mono text-meta font-medium uppercase">
              Free
            </h3>
            <p className="text-secondary">Pour essayer sur une petite flotte.</p>
          </div>
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-display text-display font-extrabold">{formaterEuros(0)}</span>{" "}
            <span className="text-secondary">sans carte bancaire</span>
          </p>
          <Link href="/connexion" className={classesBouton({ variante: "secondaire", pleineLargeur: true })}>
            Commencer gratuitement
          </Link>
          <Avantages titre="Inclus" avantages={FREE} />
        </article>

        <article className="grid content-start gap-6 rounded-panel border border-ink p-8 max-md:p-6">
          <div className="grid gap-3">
            <h3 className="inline-flex h-6 w-fit items-center rounded-full bg-ink px-2.5 font-mono text-meta font-medium text-white uppercase">
              Pro
            </h3>
            <p className="text-secondary">Pour toute la flotte, sans limite.</p>
          </div>
          <div className="grid gap-1">
            <p className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-display text-display font-extrabold">{formaterEuros(PRIX_PRO_HT_CENTIMES)}</span>{" "}
              <span className="text-lead font-medium">HT/mois</span>
            </p>
            <p className="text-label text-secondary">soit {formaterMontant(PRIX_PRO_TTC_CENTIMES)} TTC</p>
          </div>
          <Link href="/connexion" className={classesBouton({ pleineLargeur: true })}>
            Créer mon compte
          </Link>
          <Avantages titre="Tout le Free, plus&nbsp;:" avantages={PRO} />
        </article>
      </div>
      <p className="text-label text-secondary">
        Le passage en Pro se fait depuis votre espace, par carte bancaire. La facture mensuelle est établie à la
        raison sociale de votre entreprise, avec SIREN et n° de TVA. L&apos;annulation prend effet à la fin de la
        période payée.
      </p>
    </div>
  );
}
