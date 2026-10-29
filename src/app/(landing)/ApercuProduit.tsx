import { Echeance } from "@/components/Echeance";
import { Plaque } from "@/components/Plaque";
import { StatutAvis } from "@/components/StatutAvis";
import { Tuile } from "@/components/Tuile";
import { AMENDE_NON_DESIGNATION_CENTIMES } from "@/lib/avis/echeance";
import type { StatutAvis as Statut } from "@/lib/avis/regles";
import { formaterEuros } from "@/lib/format";

// La vraie interface, avec les vrais composants. La date du jour est fixée : la page reste statique,
// et les pastilles JJ/MM ne datent pas.
export const AUJOURDHUI_APERCU = "2026-10-05";

const AVIS: { echeance: string; statut: Statut; plaque: string; infraction: string; conducteur?: string }[] = [
  {
    echeance: "2026-10-07",
    statut: "a_valider",
    plaque: "FG-456-HJ",
    infraction: "Excès de vitesse < 20 km/h",
    conducteur: "Karim B.",
  },
  {
    echeance: "2026-10-13",
    statut: "a_valider",
    plaque: "PR-482-TZ",
    infraction: "Franchissement de feu rouge",
    conducteur: "Léa M.",
  },
  { echeance: "2026-10-17", statut: "a_traiter", plaque: "BT-907-KL", infraction: "Excès de vitesse < 20 km/h" },
  { echeance: "2026-11-12", statut: "a_traiter", plaque: "AB-123-CD", infraction: "Usage du téléphone au volant" },
];

/** Le hero de la landing : un tableau de bord où l'urgent se voit d'un coup d'œil. */
export function ApercuProduit() {
  return (
    <figure className="grid gap-3 rounded-panel bg-surface p-8 max-md:p-4">
      <figcaption className="sr-only">
        Aperçu du tableau de bord de Désigno : les échéances proches, les amendes évitées et les prochains avis à
        désigner.
      </figcaption>
      <div className="grid grid-cols-2 gap-3">
        <Tuile libelle="Échéances proches" chiffre="3" serree>
          dont <span className="font-medium whitespace-nowrap text-urgent">1 à J-2</span>
        </Tuile>
        <Tuile libelle="Amendes de non-désignation évitées" chiffre={formaterEuros(2 * AMENDE_NON_DESIGNATION_CENTIMES)} vert serree>
          2 avis désignés à temps
        </Tuile>
      </div>
      <div className="rounded-card border border-line bg-white">
        <p className="border-b border-line px-4 py-3 font-semibold">Prochaines échéances</p>
        <ul className="divide-y divide-line">
          {AVIS.map((avis) => (
            <li key={avis.plaque} className="grid gap-2 px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <Echeance echeance={avis.echeance} aujourdhui={AUJOURDHUI_APERCU} court />
                <StatutAvis statut={avis.statut} />
              </div>
              <div className="flex min-w-0 items-center gap-2 text-label">
                <Plaque plaque={avis.plaque} />
                <span className="truncate text-secondary">{avis.infraction}</span>
                {avis.conducteur && <span className="ml-auto flex-none font-medium">{avis.conducteur}</span>}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </figure>
  );
}
