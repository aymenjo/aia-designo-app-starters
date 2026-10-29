import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { CadenasPro } from "@/components/CadenasPro";
import { PastillePlan } from "@/components/PastillePlan";
import { Alerte } from "@/components/ui/Alerte";
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
import { limiteImpaye, type StatutAbonnement } from "@/lib/abonnement/regles";
import { AMENDE_NON_DESIGNATION_CENTIMES } from "@/lib/avis/echeance";
import { depuisIso } from "@/lib/dates";
import { COLONNES_FICHE, versValeurs, type FicheEntreprise } from "@/lib/entreprise/fiche";
import { LIBELLES_CHAMP, champsManquants } from "@/lib/entreprise/regles";
import { formaterDate, formaterEuros, formaterMontant } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { completerEntreprise } from "../entreprise/actions";
import { FormulaireEntreprise } from "../entreprise/FormulaireEntreprise";
import { ouvrirPaiement, ouvrirPortail } from "./actions";
import { AttenteActivation } from "./AttenteActivation";
import { BoutonStripe } from "./BoutonStripe";

export const metadata: Metadata = { title: "Abonnement" };

type Entreprise = FicheEntreprise & {
  plan: Plan;
  stripe_client_id: string | null;
  fin_periode: string | null;
  annulation_programmee: boolean;
  abonnement_statut: StatutAbonnement | null;
  paiement_echoue_le: string | null;
};

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

export default async function Abonnement(props: PageProps<"/parametres/abonnement">) {
  const supabase = await createClient();
  const [entreprise, usage, { paiement }] = await Promise.all([
    supabase
      .from("entreprise")
      .select(
        `plan, stripe_client_id, fin_periode, annulation_programmee, abonnement_statut, paiement_echoue_le, ${COLONNES_FICHE}`,
      )
      .single<Entreprise>(),
    lireUsage(supabase),
    props.searchParams,
  ]);
  if (entreprise.error) throw entreprise.error;
  const { plan, stripe_client_id, fin_periode, annulation_programmee, abonnement_statut, paiement_echoue_le } =
    entreprise.data;
  // Un paiement en échec (phase 19) : le Pro tient jusqu'à la date limite, puis le compte repasse en Free.
  const impaye = abonnement_statut === "past_due";
  const free = plan === "free";
  const limite = (n: number, max: number) => (free ? `${n}/${max}` : String(n));
  // Au retour de Stripe (`success_url`) : le webhook n'est peut-être pas encore passé.
  const paiementReussi = paiement === "reussi";
  const manquants = champsManquants(entreprise.data);

  const blocUsage = (
    <Bloc titre="Votre usage">
      <dl className="-my-3 divide-y divide-line">
        <LigneUsage libelle="Véhicules actifs" valeur={limite(usage.vehicules, LIMITES_FREE.vehicules)} />
        <LigneUsage
          libelle="Avis ce mois-ci"
          valeur={limite(usage.avisCeMois, LIMITES_FREE.avisParMois)}
          precision={
            free
              ? `Remise à zéro le ${depuisIso(prochainDeverrouillage())} : les avis « Verrouillés » se débloquent alors.`
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
  );

  // La ligne de l'abonnement : le paiement en échec à régulariser, la fin programmée, ou le prochain prélèvement.
  const ligneAbonnement = impaye ? (
    <LigneUsage
      libelle="Paiement en échec"
      valeur={paiement_echoue_le ? `à régulariser d'ici le ${depuisIso(limiteImpaye(paiement_echoue_le))}` : "à régulariser"}
      precision="Sinon, votre compte repassera en Free, sans perdre aucune donnée."
    />
  ) : fin_periode && annulation_programmee ? (
    <LigneUsage
      libelle="Fin de l'abonnement"
      valeur={formaterDate(fin_periode)}
      precision="Vous repasserez alors en Free, sans perdre aucune donnée."
    />
  ) : fin_periode ? (
    <LigneUsage
      libelle="Prochain prélèvement"
      valeur={`${formaterDate(fin_periode)} · ${formaterMontant(PRIX_PRO_TTC_CENTIMES)} TTC`}
    />
  ) : null;

  // Le bouton du paiement : il attend l'activation au retour de Stripe, et une fiche complète, qui fait la facture.
  const paiementPro = () => {
    if (paiementReussi) return <AttenteActivation />;
    if (manquants.length) {
      return (
        <div className="flex flex-wrap items-center gap-3">
          <Bouton disabled aria-describedby="fiche-a-completer">
            Passer en Pro
          </Bouton>
          <p id="fiche-a-completer" className="text-label text-secondary">
            Complétez d&apos;abord la fiche entreprise, ci-dessous&nbsp;: la facture porte sa raison sociale, son SIREN
            et son n° de TVA.
          </p>
        </div>
      );
    }
    return (
      <BoutonStripe
        action={ouvrirPaiement}
        enCours="Ouverture du paiement…"
        precision={
          <>
            Paiement par carte sur la page sécurisée de Stripe. Chaque mois, la facture au nom de{" "}
            {entreprise.data.raison_sociale} arrive par email.
          </>
        }
      >
        Passer en Pro
      </BoutonStripe>
    );
  };

  return (
    <div className="grid max-w-[720px] gap-6">
      <header className="grid gap-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-title font-bold">Abonnement</h1>
          <PastillePlan plan={plan} />
        </div>
        <p className="text-secondary">
          {free
            ? "Plan Free : pour essayer Désigno sur une petite flotte."
            : "Plan Pro : véhicules et avis illimités, et toutes les fonctions de Désigno."}
        </p>
      </header>

      {free ? (
        <>
          {blocUsage}

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
            {paiementPro()}
          </Bloc>

          {!paiementReussi && manquants.length > 0 && (
            <>
              <Alerte>
                <p className="font-medium">Pour passer en Pro, complétez&nbsp;:</p>
                <ul className="list-disc pl-5">
                  {manquants.map((champ) => (
                    <li key={champ}>{LIBELLES_CHAMP[champ]}</li>
                  ))}
                </ul>
              </Alerte>

              <section aria-labelledby="fiche-entreprise" className="grid gap-4">
                <div className="grid gap-1">
                  <h2 id="fiche-entreprise" className="text-title-sm font-semibold">
                    Fiche entreprise
                  </h2>
                  <p className="text-label text-secondary">
                    Seuls les champs manquants sont demandés&nbsp;: le reste de la fiche ne change pas.{" "}
                    <Link href="/parametres/entreprise">Ouvrir la fiche entreprise</Link>
                  </p>
                </div>
                <FormulaireEntreprise
                  action={completerEntreprise.bind(null, manquants)}
                  valeurs={versValeurs(entreprise.data)}
                  champs={manquants}
                />
              </section>
            </>
          )}

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
      ) : (
        <>
          {paiementReussi && (
            <Alerte variante="succes">
              <p className="font-medium">Bienvenue en Pro&nbsp;!</p>
              <p>
                Vos véhicules et vos avis sont illimités, et les avis « Verrouillés » sont débloqués. La facture arrive
                par email.
              </p>
            </Alerte>
          )}

          {/* Un compte passé en Pro sans Stripe (les tests, la démonstration) n'a pas d'abonnement à gérer. */}
          {stripe_client_id && (
            <Bloc titre="Votre abonnement">
              {ligneAbonnement && <dl className="-my-3 divide-y divide-line">{ligneAbonnement}</dl>}
              {impaye ? (
                <BoutonStripe
                  action={ouvrirPortail}
                  enCours="Ouverture…"
                  precision="Sur la page sécurisée de Stripe : changez de carte, puis réglez la facture en attente."
                >
                  Mettre à jour ma carte
                </BoutonStripe>
              ) : (
                <BoutonStripe
                  action={ouvrirPortail}
                  enCours="Ouverture…"
                  variante="secondaire"
                  precision="Carte, factures et annulation, sur la page sécurisée de Stripe."
                >
                  Gérer mon abonnement
                </BoutonStripe>
              )}
            </Bloc>
          )}

          {blocUsage}
        </>
      )}
    </div>
  );
}
