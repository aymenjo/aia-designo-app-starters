import type { Metadata } from "next";
import { Tuile } from "@/components/Tuile";
import { listerAvisAvecConducteur } from "@/lib/avis/avis";
import { prochainesEcheances, sansEcheance, syntheseTableauDeBord } from "@/lib/avis/tableau-de-bord";
import { aujourdhuiParis } from "@/lib/dates";
import { lireFiche } from "@/lib/entreprise/fiche";
import { ficheComplete } from "@/lib/entreprise/regles";
import { formaterEuros, formaterJourLong } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { ListeDemarrage } from "./ListeDemarrage";
import { ProchainesEcheances } from "./ProchainesEcheances";

export const metadata: Metadata = { title: "Tableau de bord" };

/** Un chiffre en alerte dans une sous-ligne : seul lui prend la couleur de son signal (DESIGN.md, tuile stat). */
const enAlerte = (texte: string) => (
  <>
    {" · "}
    <span className="font-medium whitespace-nowrap text-urgent">{texte}</span>
  </>
);

export default async function TableauDeBord() {
  const supabase = await createClient();
  const [avisLus, fiche, vehicules] = await Promise.all([
    listerAvisAvecConducteur(supabase),
    lireFiche(supabase),
    // Archivés compris : avoir ajouté un véhicule est un jalon de la liste de démarrage.
    supabase.from("vehicule").select("id", { count: "exact", head: true }),
  ]);
  if (avisLus.error) throw avisLus.error;
  if (vehicules.error) throw vehicules.error;
  const avis = avisLus.data ?? [];
  const aujourdhui = aujourdhuiParis();
  const { aTraiter, echeancesProches, designes, eurosEvites } = syntheseTableauDeBord(avis, aujourdhui);

  return (
    <div className="grid gap-6 max-md:gap-5">
      <div className="grid gap-0.5">
        <h1 className="font-display text-title font-bold">Tableau de bord</h1>
        <p className="text-secondary">{formaterJourLong(aujourdhui)}</p>
      </div>

      <ListeDemarrage ficheComplete={ficheComplete(fiche)} vehicule={(vehicules.count ?? 0) > 0} avis={avis.length > 0} />

      <div className="grid grid-cols-4 gap-4 max-xl:grid-cols-2 max-md:gap-3">
        <Tuile libelle="Avis à traiter" chiffre={String(aTraiter.total)}>
          {aTraiter.a_traiter} à traiter · {aTraiter.a_valider} à valider
        </Tuile>
        <Tuile libelle="Échéances proches" chiffre={String(echeancesProches.total)}>
          15 jours ou moins
          {echeancesProches.urgentes > 0 && enAlerte(`${echeancesProches.urgentes} à J-2 ou moins`)}
          {echeancesProches.depassees > 0 &&
            enAlerte(`${echeancesProches.depassees} dépassée${echeancesProches.depassees > 1 ? "s" : ""}`)}
        </Tuile>
        <Tuile libelle="Avis désignés" chiffre={String(designes.total)}>
          dont {designes.ceMois} ce mois-ci
        </Tuile>
        <Tuile libelle="Amendes de non-désignation évitées" chiffre={formaterEuros(eurosEvites.ceMois)} vert>
          ce mois-ci · <span className="whitespace-nowrap">{formaterEuros(eurosEvites.cumul)}</span> en cumul
        </Tuile>
      </div>

      <ProchainesEcheances
        avis={prochainesEcheances(avis)}
        total={avis.length}
        sansEcheance={sansEcheance(avis)}
        aujourdhui={aujourdhui}
      />
    </div>
  );
}
