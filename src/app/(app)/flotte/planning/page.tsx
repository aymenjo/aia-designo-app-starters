import { CalendarRange, ChevronLeft, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Fragment } from "react";
import { Plaque } from "@/components/Plaque";
import { classesBouton } from "@/components/ui/Bouton";
import { NavPilules } from "@/components/ui/NavPilules";
import { aujourdhuiParis } from "@/lib/dates";
import { lireAffectations, type AffectationDetaillee } from "@/lib/flotte/affectations";
import type { Conducteur } from "@/lib/flotte/conducteurs";
import {
  VUES,
  lienPlanning,
  libelleCreneau,
  lireParametresPlanning,
  periode,
  positionner,
  type Periode,
} from "@/lib/flotte/planning";
import { nomAbrege, nomComplet } from "@/lib/flotte/regles";
import { COLONNES_VEHICULE, type Vehicule } from "@/lib/flotte/vehicules";
import { createClient } from "@/lib/supabase/server";
import { FournisseurAffectations, OuvrirAffectation } from "./FenetreAffectation";
import { FiltreConducteur } from "./FiltreConducteur";
import { NouvelleAffectation } from "./NouvelleAffectation";

export const metadata: Metadata = { title: "Planning" };

const LIBELLES_VUE = { semaine: "Semaine", mois: "Mois" } as const;

const JOUR_SEMAINE = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", timeZone: "UTC" });

/** « lun. 12 » à la semaine, « 12 » au mois. */
function enteteJour(jour: string, { vue }: Periode) {
  return vue === "semaine" ? JOUR_SEMAINE.format(Date.parse(`${jour}T00:00:00Z`)) : String(Number(jour.slice(8)));
}

const parPlaque = (a: Vehicule, b: Vehicule) => a.plaque.localeCompare(b.plaque);

export default async function Planning(props: PageProps<"/flotte/planning">) {
  const parametres = lireParametresPlanning(await props.searchParams);
  const p = periode(parametres.vue, parametres.date);

  const supabase = await createClient();
  const [reponseVehicules, reponseConducteurs, reponseAffectations] = await Promise.all([
    supabase
      .from("vehicule")
      .select(COLONNES_VEHICULE)
      .order("plaque")
      .overrideTypes<Vehicule[], { merge: false }>(),
    supabase
      .from("conducteur")
      .select("id, prenom, nom, archive_le")
      .order("nom")
      .order("prenom")
      .overrideTypes<Pick<Conducteur, "id" | "prenom" | "nom" | "archive_le">[], { merge: false }>(),
    lireAffectations(supabase, {}, p),
  ]);
  for (const { error } of [reponseVehicules, reponseConducteurs, reponseAffectations]) if (error) throw error;
  const vehicules = reponseVehicules.data ?? [];
  const conducteurs = reponseConducteurs.data ?? [];
  const affectations = reponseAffectations.data ?? [];

  const actifs = {
    vehicules: vehicules.filter((vehicule) => !vehicule.archive_le),
    conducteurs: conducteurs.filter((conducteur) => !conducteur.archive_le),
  };

  if (!vehicules.length) {
    return (
      <div className="grid gap-6">
        <h1 className="font-display text-title font-bold">Planning</h1>
        <section className="grid justify-items-start gap-4 rounded-panel border border-line p-8 max-md:p-6">
          <CalendarRange size={20} strokeWidth={1.5} aria-hidden className="text-secondary" />
          <div className="grid gap-2">
            <h2 className="text-lead font-semibold">Aucun véhicule pour l&apos;instant</h2>
            <p className="max-w-[560px] text-secondary">
              Le planning montre qui conduit chaque véhicule, et quand. Commencez par ajouter les véhicules de votre
              flotte.
            </p>
          </div>
          <Link href="/flotte/vehicules">Ajouter un véhicule</Link>
        </section>
      </div>
    );
  }

  // Un filtre qui ne vise rien de connu est ignoré.
  const vehiculeFiltre = vehicules.find((vehicule) => vehicule.id === parametres.vehicule);
  const conducteurFiltre = conducteurs.find((conducteur) => conducteur.id === parametres.conducteur);
  const visibles = affectations.filter(
    (affectation) =>
      (!vehiculeFiltre || affectation.vehicule_id === vehiculeFiltre.id) &&
      (!conducteurFiltre || affectation.conducteur_id === conducteurFiltre.id),
  );
  const parVehicule = Map.groupBy(visibles, (affectation) => affectation.vehicule_id);

  // Archivés, un véhicule ou un conducteur ne restent visibles que là où ils ont conduit.
  const touches = new Set(affectations.flatMap((affectation) => [affectation.vehicule_id, affectation.conducteur_id]));
  const lignes = vehiculeFiltre
    ? [vehiculeFiltre]
    : conducteurFiltre
      ? vehicules.filter((vehicule) => parVehicule.has(vehicule.id)).sort(parPlaque)
      : vehicules.filter((vehicule) => !vehicule.archive_le || touches.has(vehicule.id)).sort(parPlaque);
  const optionsConducteur = conducteurs
    .filter((conducteur) => !conducteur.archive_le || touches.has(conducteur.id) || conducteur === conducteurFiltre)
    .map((conducteur) => ({
      valeur: conducteur.id,
      libelle: conducteur.archive_le ? `${nomComplet(conducteur)} (archivé)` : nomComplet(conducteur),
    }));

  const aujourdhui = aujourdhuiParis();
  const colonnes = { gridTemplateColumns: `repeat(${p.jours.length}, minmax(0, 1fr))` };
  // Bouton icône, comme « Fermer » des fenêtres.
  const navigation =
    "grid size-8 place-items-center rounded-full text-ink transition-colors duration-120 ease-enter hover:bg-[rgb(0_0_0/0.05)]";

  return (
    <FournisseurAffectations {...actifs}>
      <div className="grid gap-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="grid gap-0.5">
            <h1 className="font-display text-title font-bold">Planning</h1>
            <p className="text-secondary">Qui conduit quel véhicule, et quand.</p>
          </div>
          <NouvelleAffectation
            valeurs={{
              vehicule_id: vehiculeFiltre && !vehiculeFiltre.archive_le ? vehiculeFiltre.id : "",
              conducteur_id: conducteurFiltre && !conducteurFiltre.archive_le ? conducteurFiltre.id : "",
            }}
          />
        </div>

        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <NavPilules
              libelle="Vue du planning"
              pilules={VUES.map((vue) => ({
                href: lienPlanning({ ...parametres, vue }),
                libelle: LIBELLES_VUE[vue],
                actif: vue === p.vue,
              }))}
            />
            <div className="flex items-center gap-1">
              <Link
                href={lienPlanning({ ...parametres, date: p.precedente })}
                aria-label={p.vue === "semaine" ? "Semaine précédente" : "Mois précédent"}
                className={navigation}
              >
                <ChevronLeft size={16} strokeWidth={1.5} aria-hidden />
              </Link>
              <Link
                href={lienPlanning({ ...parametres, date: undefined })}
                className={classesBouton({ variante: "secondaire", taille: "sm" })}
              >
                Aujourd&apos;hui
              </Link>
              <Link
                href={lienPlanning({ ...parametres, date: p.suivante })}
                aria-label={p.vue === "semaine" ? "Semaine suivante" : "Mois suivant"}
                className={navigation}
              >
                <ChevronRight size={16} strokeWidth={1.5} aria-hidden />
              </Link>
            </div>
            <h2 className="text-lead font-semibold">{p.libelle}</h2>
          </div>
          <FiltreConducteur parametres={parametres} options={optionsConducteur} />
        </div>

        {vehiculeFiltre && (
          <p className="flex flex-wrap items-center gap-2 text-label">
            <span className="text-secondary">Véhicule :</span>
            <Plaque plaque={vehiculeFiltre.plaque} />
            <Link href={lienPlanning({ ...parametres, vehicule: undefined })}>Tous les véhicules</Link>
          </p>
        )}

        {lignes.length > 0 && (
          <div className="overflow-x-auto rounded-card border border-line">
            <div
              className={`grid grid-cols-[136px_minmax(0,1fr)] ${p.vue === "semaine" ? "min-w-[760px]" : "min-w-[1080px]"}`}
            >
              <div className="sticky left-0 z-10 flex h-8 items-center border-r border-line bg-surface px-3 font-mono text-meta font-medium text-secondary uppercase">
                Véhicule
              </div>
              <div className="grid h-8 bg-surface" style={colonnes}>
                {p.jours.map((jour) => (
                  <div
                    key={jour}
                    className={[
                      "flex items-center justify-center border-l border-line font-mono text-meta uppercase",
                      jour === aujourdhui ? "font-semibold text-ink" : "font-medium text-secondary",
                    ].join(" ")}
                  >
                    {enteteJour(jour, p)}
                  </div>
                ))}
              </div>

              {lignes.map((vehicule) => (
                <Fragment key={vehicule.id}>
                  <div className="sticky left-0 z-10 flex h-9 items-center gap-2 border-t border-r border-line bg-white px-3">
                    <Plaque plaque={vehicule.plaque} />
                    {vehicule.archive_le && <span className="text-caption text-secondary">archivé</span>}
                  </div>
                  <div className="relative h-9 overflow-hidden border-t border-line">
                    <div aria-hidden className="absolute inset-0 grid" style={colonnes}>
                      {p.jours.map((jour) => (
                        <div key={jour} className={`border-l border-line ${jour === aujourdhui ? "bg-surface" : ""}`} />
                      ))}
                    </div>
                    {parVehicule.get(vehicule.id)?.map((affectation) => (
                      <Barre key={affectation.id} affectation={affectation} periode={p} />
                    ))}
                  </div>
                </Fragment>
              ))}
            </div>
          </div>
        )}

        {!visibles.length && <p className="text-secondary">Aucune affectation sur cette période.</p>}
      </div>
    </FournisseurAffectations>
  );
}

/** Une pilule neutre : le planning ne porte aucun signal. Bord droit du côté où elle déborde de la période. */
function Barre({ affectation, periode: p }: { affectation: AffectationDetaillee; periode: Periode }) {
  const { gauche, largeur, coupeeAGauche, coupeeADroite } = positionner(affectation, p);
  const description = `${nomComplet(affectation.conducteur)} sur ${affectation.vehicule.plaque}, ${libelleCreneau(affectation.debut, affectation.fin)}`;

  return (
    <OuvrirAffectation
      affectation={affectation}
      aria-label={description}
      title={description}
      style={{ left: `${gauche}%`, width: `${largeur}%` }}
      className={[
        "absolute inset-y-1.5 flex min-w-1.5 cursor-pointer items-center overflow-hidden border border-line-strong bg-surface px-2 text-caption font-medium whitespace-nowrap text-ink transition-colors duration-120 ease-enter hover:border-ink",
        coupeeAGauche ? "rounded-l-none" : "rounded-l-full",
        coupeeADroite ? "rounded-r-none" : "rounded-r-full",
      ].join(" ")}
    >
      <span className="truncate">{nomAbrege(affectation.conducteur)}</span>
    </OuvrirAffectation>
  );
}
