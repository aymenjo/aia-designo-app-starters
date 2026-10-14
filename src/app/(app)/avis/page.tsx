import { FileText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { BadgeEcheanceDepassee } from "@/components/BadgeEcheanceDepassee";
import { Echeance } from "@/components/Echeance";
import { Plaque } from "@/components/Plaque";
import { StatutAvis } from "@/components/StatutAvis";
import { classesBouton } from "@/components/ui/Bouton";
import { NavPilules } from "@/components/ui/NavPilules";
import { listerAvis } from "@/lib/avis/avis";
import { echeanceDepassee } from "@/lib/avis/echeance";
import { FILTRES_STATUT, lienAvis, lireFiltreAvis, trierPourSuivi } from "@/lib/avis/liste";
import { LIBELLES_STATUT } from "@/lib/avis/regles";
import { aujourdhuiParis } from "@/lib/dates";
import { formaterDate, formaterDateHeure } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Avis" };

// L'échéance a la place de sa pastille la plus large (« dépassée le JJ/MM · J+n ») ; le badge passe dessous,
// sur téléphone aussi. Plus étroite que 840 px, la table défile, comme le planning, plutôt que d'écraser l'infraction.
const COLONNES =
  "grid grid-cols-[112px_112px_minmax(0,1fr)_224px_88px_84px] items-center gap-3 px-4 max-md:grid-cols-[minmax(0,1fr)_fit-content(224px)] max-md:gap-y-2 max-md:py-3";

const vide = <span className="text-secondary">—</span>;

export default async function ListeAvis(props: PageProps<"/avis">) {
  const filtre = lireFiltreAvis(await props.searchParams);
  const supabase = await createClient();
  const { data, error } = await listerAvis(supabase);
  if (error) throw error;
  const avis = data ?? [];
  const visibles = trierPourSuivi(avis.filter((un) => !filtre.statut || un.statut === filtre.statut));
  const aujourdhui = aujourdhuiParis();

  const deposer = (
    <Link href="/avis/nouveau" className={classesBouton()}>
      Déposer un avis
    </Link>
  );

  if (!avis.length) {
    return (
      <div className="grid gap-6">
        <h1 className="font-display text-title font-bold">Avis</h1>
        <section className="grid justify-items-start gap-4 rounded-panel border border-line p-8 max-md:p-6">
          <FileText size={20} strokeWidth={1.5} aria-hidden className="text-secondary" />
          <div className="grid gap-2">
            <h2 className="text-lead font-semibold">Aucun avis pour l&apos;instant</h2>
            <p className="max-w-[560px] text-secondary">
              Déposez le scan ou la photo d&apos;un avis de contravention : Désigno calcule son échéance de
              désignation et le rattache au véhicule flashé.
            </p>
          </div>
          {deposer}
        </section>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-0.5">
          <h1 className="font-display text-title font-bold">Avis</h1>
          <p className="text-secondary">
            {filtre.statut ? `${visibles.length} avis sur ${avis.length}` : `${avis.length} avis`}
          </p>
        </div>
        {deposer}
      </div>

      <NavPilules
        libelle="Filtrer par statut"
        pilules={[undefined, ...FILTRES_STATUT].map((statut) => ({
          href: lienAvis({ statut }),
          libelle: statut ? LIBELLES_STATUT[statut] : "Tous",
          actif: statut === filtre.statut,
        }))}
      />

      {filtre.statut && !visibles.length ? (
        <section className="grid justify-items-start gap-2 rounded-card border border-line p-6">
          <p>Aucun avis « {LIBELLES_STATUT[filtre.statut]} ».</p>
          <Link href={lienAvis({})} className="text-label">
            Voir tous les avis
          </Link>
        </section>
      ) : (
        <div className="overflow-x-auto rounded-card border border-line">
          <div className="md:min-w-[840px]">
            <div
              aria-hidden
              className={`${COLONNES} h-8 border-b border-line bg-surface font-mono text-meta font-medium text-secondary uppercase max-md:hidden`}
            >
              <span>N° d&apos;avis</span>
              <span>Plaque</span>
              <span>Infraction</span>
              <span>Échéance</span>
              <span>Statut</span>
              <span>Déposé le</span>
            </div>
            <ul className="divide-y divide-line">
              {visibles.map((un) => (
                <li key={un.id}>
                  <Link
                    href={`/avis/${un.id}`}
                    className={`${COLONNES} min-h-13 py-2 no-underline transition-colors duration-120 ease-enter hover:bg-surface`}
                  >
                    <span className="truncate font-mono font-medium">{un.numero ?? vide}</span>
                    <span>{un.plaque ? <Plaque plaque={un.plaque} /> : vide}</span>
                    <span className="truncate">{un.infraction_le ? formaterDateHeure(un.infraction_le) : vide}</span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      {un.echeance ? <Echeance echeance={un.echeance} aujourdhui={aujourdhui} court /> : vide}
                      {echeanceDepassee(un, aujourdhui) && <BadgeEcheanceDepassee />}
                    </span>
                    <span>
                      <StatutAvis statut={un.statut} />
                    </span>
                    <span className="text-label text-secondary">{formaterDate(un.depose_le)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
