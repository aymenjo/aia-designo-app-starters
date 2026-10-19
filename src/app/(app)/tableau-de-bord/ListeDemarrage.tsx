import { Circle, CircleCheck } from "lucide-react";
import Link from "next/link";

type Etape = { titre: string; description: string; faite: boolean; liens: { href: string; libelle: string }[] };

type Props = {
  /** La fiche entreprise a tous ses champs requis : le récap ANTAI et le passage en Pro en dépendent. */
  ficheComplete: boolean;
  /** Au moins un véhicule, archivé compris : l'étape est un jalon, elle ne revient pas après un archivage. */
  vehicule: boolean;
  /** Au moins un avis, quel que soit son statut. */
  avis: boolean;
};

/** La liste de démarrage (US-7) : 3 étapes cochées d'elles-mêmes, et masquées une fois toutes faites. */
export function ListeDemarrage({ ficheComplete, vehicule, avis }: Props) {
  const etapes: Etape[] = [
    {
      titre: "Compléter la fiche entreprise",
      description: "La raison sociale, le SIREN et le représentant légal figurent sur le récap ANTAI.",
      faite: ficheComplete,
      liens: [{ href: "/parametres/entreprise", libelle: "Compléter la fiche" }],
    },
    {
      titre: "Ajouter votre flotte",
      description: "Vos véhicules, un par un ou depuis un fichier CSV.",
      faite: vehicule,
      liens: [
        { href: "/flotte/vehicules", libelle: "Ajouter un véhicule" },
        { href: "/flotte/import", libelle: "Importer un fichier" },
      ],
    },
    {
      titre: "Déposer votre premier avis",
      description: "Le scan ou la photo d'un avis : Désigno calcule son échéance de désignation.",
      faite: avis,
      liens: [{ href: "/avis/nouveau", libelle: "Déposer un avis" }],
    },
  ];
  const faites = etapes.filter(({ faite }) => faite).length;
  if (faites === etapes.length) return null;

  return (
    <section aria-labelledby="demarrage" className="grid gap-4 rounded-card border border-line p-6 max-md:p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="demarrage" className="font-semibold">
          Bien démarrer
        </h2>
        <p className="text-label text-secondary">
          <b className="font-semibold text-ink">{faites}</b>/{etapes.length}
        </p>
      </div>
      <ol className="grid gap-4">
        {etapes.map(({ titre, description, faite, liens }) => (
          <li key={titre} className="grid grid-cols-[16px_minmax(0,1fr)] gap-x-3 gap-y-1">
            {faite ? (
              <CircleCheck size={16} strokeWidth={1.5} aria-hidden className="mt-0.5 text-ok" />
            ) : (
              <Circle size={16} strokeWidth={1.5} aria-hidden className="mt-0.5 text-gray-300" />
            )}
            <p className={faite ? "text-secondary" : "font-medium"}>
              <span className="sr-only">{faite ? "Fait : " : "À faire : "}</span>
              {titre}
            </p>
            {!faite && (
              <>
                <p className="col-start-2 text-label text-secondary">{description}</p>
                {/* Sur téléphone, chaque lien est une cible de 44 px. */}
                <div className="col-start-2 flex flex-wrap gap-x-4 text-label">
                  {liens.map(({ href, libelle }) => (
                    <Link key={href} href={href} className="max-md:inline-flex max-md:min-h-11 max-md:items-center">
                      {libelle}
                    </Link>
                  ))}
                </div>
              </>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
