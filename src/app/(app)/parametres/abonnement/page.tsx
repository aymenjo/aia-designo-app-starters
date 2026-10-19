import type { Metadata } from "next";
import type { ReactNode } from "react";
import { CadenasPro } from "@/components/CadenasPro";
import { PastillePlan } from "@/components/PastillePlan";
import { Bloc } from "@/components/ui/Bloc";
import { Bouton } from "@/components/ui/Bouton";
import {
  FONCTIONS_PRO,
  LIMITES_FREE,
  PRIX_PRO_HT_CENTIMES,
  PRIX_PRO_TTC_CENTIMES,
  type Plan,
} from "@/lib/abonnement/plans";
import { lireUsage, prochainDeverrouillage } from "@/lib/abonnement/quotas";
import { AMENDE_NON_DESIGNATION_CENTIMES } from "@/lib/avis/echeance";
import { depuisIso } from "@/lib/dates";
import { formaterEuros, formaterMontant } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Abonnement" };

/** Une ligne de l'usage : le libellé, puis le chiffre et sa limite, et une précision. */
function LigneUsage({ libelle, valeur, precision }: { libelle: string; valeur: ReactNode; precision?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-3">
      <dt className="text-secondary">{libelle}</dt>
      <dd className="grid justify-items-end text-right max-md:justify-items-start max-md:text-left">
        <span className="font-semibold">{valeur}</span>
        {precision && <span className="text-label text-secondary">{precision}</span>}
      </dd>
    </div>
  );
}

export default async function Abonnement() {
  const supabase = await createClient();
  const [entreprise, usage] = await Promise.all([
    supabase.from("entreprise").select("plan").single<{ plan: Plan }>(),
    lireUsage(supabase),
  ]);
  if (entreprise.error) throw entreprise.error;
  const { plan } = entreprise.data;
  const free = plan === "free";
  const limite = (n: number, max: number) => (free ? `${n}/${max}` : String(n));

  return (
    <div className="grid max-w-[720px] gap-6">
      <header className="grid gap-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-title font-bold">Abonnement</h1>
          <PastillePlan plan={plan} />
        </div>
        <p className="text-secondary">
          {free
            ? "Plan Free : pour essayer Désigno sur une petite flotte."
            : "Plan Pro : véhicules et avis illimités, et toutes les fonctions de Désigno."}
        </p>
      </header>

      <Bloc titre="Votre usage">
        <dl className="-my-3 divide-y divide-line">
          <LigneUsage libelle="Véhicules actifs" valeur={limite(usage.vehicules, LIMITES_FREE.vehicules)} />
          <LigneUsage
            libelle="Avis ce mois-ci"
            valeur={limite(usage.avisCeMois, LIMITES_FREE.avisParMois)}
            precision={
              free
                ? `Remise à zéro le ${depuisIso(prochainDeverrouillage())} : les avis « Verrouillés » se débloquent alors.`
                : undefined
            }
          />
          <LigneUsage
            libelle="Historique"
            valeur={free ? `${LIMITES_FREE.historiqueMois} mois` : "Complet"}
            precision={free ? "Les avis désignés ou classés avant sont masqués, jamais supprimés." : undefined}
          />
        </dl>
      </Bloc>

      {free && (
        <>
          <Bloc titre="Passer en Pro">
            <div className="grid gap-1">
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-display text-stat font-extrabold">{formaterEuros(PRIX_PRO_HT_CENTIMES)}</span>
                <span className="font-medium">HT/mois</span>
                <span className="text-label text-secondary">soit {formaterMontant(PRIX_PRO_TTC_CENTIMES)} TTC</span>
              </p>
              <p className="text-secondary">
                Une seule amende de non-désignation évitée ({formaterEuros(AMENDE_NON_DESIGNATION_CENTIMES)}) paie plus
                d&apos;un an d&apos;abonnement ({formaterEuros(12 * PRIX_PRO_HT_CENTIMES)}&nbsp;HT).
              </p>
            </div>
            {/* Stripe Checkout le branchera (phase 18). */}
            <div className="flex flex-wrap items-center gap-3">
              <Bouton disabled aria-describedby="paiement-bientot">
                Passer en Pro
              </Bouton>
              <p id="paiement-bientot" className="text-label text-secondary">
                Le paiement en ligne arrive bientôt.
              </p>
            </div>
          </Bloc>

          <section aria-labelledby="fonctions-pro" className="grid gap-4">
            <h2 id="fonctions-pro" className="text-title-sm font-semibold">
              Fonctions Pro
            </h2>
            <div className="grid gap-3 md:grid-cols-2">
              {FONCTIONS_PRO.map(({ nom, explication }) => (
                <CadenasPro key={nom} fonction={nom} lien={false}>
                  <p>{explication}</p>
                </CadenasPro>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
