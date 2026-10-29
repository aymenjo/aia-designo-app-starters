import { FileText, MailWarning } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { BadgeEcheanceDepassee } from "@/components/BadgeEcheanceDepassee";
import { BadgeVehiculeInconnu } from "@/components/BadgeVehiculeInconnu";
import { BadgeVerrouille } from "@/components/BadgeVerrouille";
import { CadenasPro } from "@/components/CadenasPro";
import { Echeance } from "@/components/Echeance";
import { Plaque } from "@/components/Plaque";
import { StatutAvis } from "@/components/StatutAvis";
import { classesBouton } from "@/components/ui/Bouton";
import { NavPilules } from "@/components/ui/NavPilules";
import { LIMITES_FREE, type Plan } from "@/lib/abonnement/plans";
import { debutHistorique } from "@/lib/abonnement/quotas";
import { compterAvisMasques, listerAvis } from "@/lib/avis/avis";
import { echeanceDepassee } from "@/lib/avis/echeance";
import { FILTRES_STATUT, lienAvis, lireFiltreAvis, trierPourSuivi } from "@/lib/avis/liste";
import { LIBELLES_STATUT, estOuvert, vehiculeInconnu } from "@/lib/avis/regles";
import { aujourdhuiParis } from "@/lib/dates";
import { compterNonExploitables } from "@/lib/gmail/emails";
import { formaterDate, formaterDateHeure } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { ExportAvis } from "./ExportAvis";

export const metadata: Metadata = { title: "Avis" };

// L'échéance a la place de sa pastille la plus large (« dépassée le JJ/MM · J+n ») ; le badge passe dessous,
// sur téléphone aussi, comme « Véhicule inconnu » sous la plaque. Plus étroite que 856 px, la table défile,
// comme le planning, plutôt que d'écraser l'infraction.
const COLONNES =
  "grid grid-cols-[112px_128px_minmax(0,1fr)_224px_88px_84px] items-center gap-3 px-4 max-md:grid-cols-[minmax(0,1fr)_fit-content(224px)] max-md:gap-y-2 max-md:py-3";

const vide = <span className="text-secondary">—</span>;

/** En Free, les avis désignés ou classés depuis plus de 3 mois : masqués, jamais supprimés. */
function HistoriqueMasque({ nombre }: { nombre: number }) {
  return (
    <CadenasPro fonction={`Historique complet · ${nombre} avis masqué${nombre > 1 ? "s" : ""}`}>
      <p>
        En Free, les avis désignés ou classés depuis plus de {LIMITES_FREE.historiqueMois} mois sont masqués. Ils ne
        sont pas supprimés, et réapparaissent dès le passage en Pro.
      </p>
    </CadenasPro>
  );
}

export default async function ListeAvis(props: PageProps<"/avis">) {
  const filtre = lireFiltreAvis(await props.searchParams);
  const supabase = await createClient();
  const entreprise = await supabase.from("entreprise").select("plan").single<{ plan: Plan }>();
  if (entreprise.error) throw entreprise.error;
  const debut = debutHistorique(entreprise.data.plan);
  const [{ data, error }, masques, nonExploitables] = await Promise.all([
    listerAvis(supabase, debut),
    debut ? compterAvisMasques(supabase, debut) : { count: 0, error: null },
    compterNonExploitables(supabase),
  ]);
  if (error) throw error;
  if (masques.error) throw masques.error;
  if (nonExploitables.error) throw nonExploitables.error;
  const avis = data ?? [];
  const nombreMasques = masques.count ?? 0;
  const visibles = trierPourSuivi(avis.filter((un) => !filtre.statut || un.statut === filtre.statut));
  const aujourdhui = aujourdhuiParis();

  const deposer = (
    <Link href="/avis/nouveau" className={classesBouton()}>
      Déposer un avis
    </Link>
  );
  // L'export (phase 24) reprend tous les avis, quel que soit le filtre ; sans avis, il n'y a rien à exporter.
  const actions = (
    <div className="flex flex-wrap gap-2">
      <ExportAvis plan={entreprise.data.plan} />
      {deposer}
    </div>
  );
  // La relève Gmail (phase 23) : les emails dont une pièce jointe n'a pas donné d'avis attendent le gestionnaire.
  const emails = nonExploitables.count ? (
    <Link href="/avis/emails-non-exploitables" className="inline-flex items-center gap-1.5 justify-self-start">
      <MailWarning size={16} strokeWidth={1.5} aria-hidden className="flex-none" />
      Emails non exploitables · {nonExploitables.count}
    </Link>
  ) : null;

  if (!avis.length && nombreMasques) {
    return (
      <div className="grid gap-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h1 className="font-display text-title font-bold">Avis</h1>
          {actions}
        </div>
        {emails}
        <HistoriqueMasque nombre={nombreMasques} />
      </div>
    );
  }

  if (!avis.length) {
    return (
      <div className="grid gap-6">
        <h1 className="font-display text-title font-bold">Avis</h1>
        {emails}
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
        {actions}
      </div>

      {emails}

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
          <div className="md:min-w-[856px]">
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
                    <span className="flex flex-wrap items-center gap-1.5">
                      {un.plaque ? <Plaque plaque={un.plaque} /> : vide}
                      {vehiculeInconnu(un) && <BadgeVehiculeInconnu />}
                    </span>
                    <span className="truncate">{un.infraction_le ? formaterDateHeure(un.infraction_le) : vide}</span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      {un.echeance ? (
                        <Echeance
                          echeance={un.echeance}
                          aujourdhui={aujourdhui}
                          designeLe={un.designe_le}
                          classeLe={un.classe_le}
                          court
                        />
                      ) : vide}
                      {echeanceDepassee(un, aujourdhui) && <BadgeEcheanceDepassee />}
                      {(un.verrouille || un.vehicule_lecture_seule) && estOuvert(un.statut) && <BadgeVerrouille />}
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

      {nombreMasques > 0 && <HistoriqueMasque nombre={nombreMasques} />}
    </div>
  );
}
