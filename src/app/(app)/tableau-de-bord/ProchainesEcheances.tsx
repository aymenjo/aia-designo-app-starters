import Link from "next/link";
import { BadgeEcheanceDepassee } from "@/components/BadgeEcheanceDepassee";
import { BadgeVehiculeInconnu } from "@/components/BadgeVehiculeInconnu";
import { BadgeVerrouille } from "@/components/BadgeVerrouille";
import { Echeance } from "@/components/Echeance";
import { Plaque } from "@/components/Plaque";
import { StatutAvis } from "@/components/StatutAvis";
import type { AvisAvecConducteur } from "@/lib/avis/avis";
import { echeanceDepassee } from "@/lib/avis/echeance";
import { lienAvis } from "@/lib/avis/liste";
import { vehiculeInconnu } from "@/lib/avis/regles";
import { nomAbrege } from "@/lib/flotte/regles";
import { formaterMontant } from "@/lib/format";

// Sur ordinateur, une ligne par avis, aux largeurs de `/avis`. Plus étroite que `lg`, chaque ligne s'empile sur
// 3 rangées (échéance et statut, plaque et conducteur, puis l'avis) : rien ne défile à l'horizontale.
const COLONNES =
  "grid grid-cols-[minmax(0,1fr)_auto] [grid-template-areas:'due_status'_'plate_who'_'what_what'] items-center gap-x-3 gap-y-2 px-4 lg:grid-cols-[224px_128px_minmax(0,1fr)_104px_88px] lg:[grid-template-areas:'due_plate_what_who_status']";

const vide = <span className="text-secondary">—</span>;

type Props = {
  /** Les prochaines échéances, déjà triées (`prochainesEcheances`). */
  avis: AvisAvecConducteur[];
  /** Tous les avis de l'entreprise, pour l'état vide. */
  total: number;
  /** Les avis ouverts sans échéance, signalés sous la liste. */
  sansEcheance: number;
  aujourdhui: string;
};

/** Le conducteur validé seulement : la proposition n'est jamais affichée ici, rien n'est automatique. */
function conducteur(un: AvisAvecConducteur) {
  if (un.conducteur) return <span className="truncate font-medium">{nomAbrege(un.conducteur)}</span>;
  return un.statut === "a_valider" ? <span className="text-watch">À choisir</span> : vide;
}

/** L'infraction, et dessous le lieu et le montant : une partie absente est omise. */
function resume(un: AvisAvecConducteur) {
  const detail = [un.lieu, un.montant_centimes && formaterMontant(un.montant_centimes)].filter(Boolean).join(" · ");
  if (!un.infraction && !detail) return vide;
  return (
    <>
      {un.infraction && <span className="truncate">{un.infraction}</span>}
      {detail && <span className="truncate text-caption text-secondary">{detail}</span>}
    </>
  );
}

/** Les prochaines échéances du tableau de bord : l'urgent d'abord, chaque ligne mène à son avis. */
export function ProchainesEcheances({ avis, total, sansEcheance, aujourdhui }: Props) {
  return (
    <section aria-labelledby="prochaines-echeances" className="rounded-card border border-line">
      <div className="flex items-baseline justify-between gap-3 px-4 py-3">
        <h2 id="prochaines-echeances" className="font-semibold">
          Prochaines échéances
        </h2>
        <Link href={lienAvis({})} className="text-label">
          Voir tous les avis
        </Link>
      </div>

      {avis.length > 0 && (
        <>
          <div
            aria-hidden
            className={`${COLONNES} h-8 border-y border-line bg-surface font-mono text-meta font-medium text-secondary uppercase max-lg:hidden`}
          >
            <span>Échéance</span>
            <span>Plaque</span>
            <span>Avis</span>
            <span>Conducteur</span>
            <span>Statut</span>
          </div>
          <ul className="divide-y divide-line max-lg:border-t max-lg:border-line">
            {avis.map((un) => (
              <li key={un.id}>
                <Link
                  href={`/avis/${un.id}`}
                  className={`${COLONNES} min-h-13 py-3 no-underline transition-colors duration-120 ease-enter hover:bg-surface lg:py-2`}
                >
                  <span className="flex flex-wrap items-center gap-1.5 [grid-area:due]">
                    {un.echeance && <Echeance echeance={un.echeance} aujourdhui={aujourdhui} court />}
                    {echeanceDepassee(un, aujourdhui) && <BadgeEcheanceDepassee />}
                    {(un.verrouille || un.vehicule_lecture_seule) && <BadgeVerrouille />}
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5 [grid-area:plate]">
                    {un.plaque ? <Plaque plaque={un.plaque} /> : vide}
                    {vehiculeInconnu(un) && <BadgeVehiculeInconnu />}
                  </span>
                  <span className="grid min-w-0 [grid-area:what]">{resume(un)}</span>
                  <span className="flex min-w-0 justify-end [grid-area:who] lg:justify-start">{conducteur(un)}</span>
                  <span className="flex justify-end [grid-area:status] lg:justify-start">
                    <StatutAvis statut={un.statut} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      {!avis.length && !sansEcheance && (
        <p className="border-t border-line px-4 py-4 text-secondary">
          {total ? "Aucune échéance à suivre : vos avis sont désignés ou classés." : "Aucun avis pour l'instant."}
        </p>
      )}

      {sansEcheance > 0 && (
        <p className="border-t border-line px-4 py-3 text-label text-secondary">
          <Link href={lienAvis({ statut: "a_traiter" })}>{sansEcheance} avis sans échéance</Link> : saisissez{" "}
          {sansEcheance > 1 ? "leur" : "sa"} date d&apos;envoi pour suivre {sansEcheance > 1 ? "leur" : "son"} délai.
        </p>
      )}
    </section>
  );
}
