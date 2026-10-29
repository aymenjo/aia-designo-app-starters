import { Download } from "lucide-react";
import type { Metadata } from "next";
import { Alerte } from "@/components/ui/Alerte";
import { Bloc } from "@/components/ui/Bloc";
import { classesBouton } from "@/components/ui/Bouton";
import { COLONNES, LIBELLES_FICHIER, TYPES_FICHIER, type TypeFichier } from "@/lib/flotte/regles-import";
import { ImportFlotte } from "./ImportFlotte";

export const metadata: Metadata = { title: "Importer la flotte" };

// Vaut aussi pour les server actions de la page : l'import écrit les lignes une à une.
export const maxDuration = 60;

const CELLULE = "px-4 py-2.5 align-baseline";

/** Les colonnes d'un modèle : en-tête, obligatoire ou non, format attendu et exemple. */
function Colonnes({ type }: { type: TypeFichier }) {
  return (
    <div className="grid gap-2">
      <h3 className="font-medium">Fichier {LIBELLES_FICHIER[type]}</h3>
      <div className="overflow-x-auto rounded-card border border-line">
        {/* Largeurs fixes : les deux tableaux s'alignent l'un sous l'autre. */}
        <table className="w-full min-w-[640px] table-fixed border-collapse text-left">
          <colgroup>
            <col className="w-52" />
            <col className="w-32" />
            <col />
            <col className="w-60" />
          </colgroup>
          <thead className="border-b border-line bg-surface font-mono text-meta font-medium text-secondary uppercase">
            <tr>
              <th scope="col" className="h-8 px-4 font-medium">
                Colonne
              </th>
              <th scope="col" className="h-8 px-4 font-medium">
                Remplissage
              </th>
              <th scope="col" className="h-8 px-4 font-medium">
                Format
              </th>
              <th scope="col" className="h-8 px-4 font-medium">
                Exemple
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {COLONNES[type].map(({ champ, entete, requise, format, exemple }) => (
              <tr key={champ}>
                <th scope="row" className={`${CELLULE} font-medium`}>
                  {entete}
                </th>
                <td className={`${CELLULE} whitespace-nowrap ${requise ? "" : "text-secondary"}`}>
                  {requise ? "Obligatoire" : "Facultative"}
                </td>
                <td className={CELLULE}>{format}</td>
                <td className={`${CELLULE} font-mono text-label font-medium break-all`}>{exemple}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ImportFlottePage() {
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid max-w-[640px] gap-1">
          <h1 className="font-display text-title font-bold">Importer la flotte</h1>
          <p className="text-secondary">
            Vos véhicules et vos conducteurs en CSV, un fichier pour chacun. Un aperçu précède l&apos;import&nbsp;: seules
            les lignes valides sont importées, et celles déjà dans votre flotte sont ignorées.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {TYPES_FICHIER.map((type) => (
            <a
              key={type}
              href={`/flotte/import/modeles/${type}`}
              download
              className={classesBouton({ variante: "secondaire" })}
            >
              <Download size={16} strokeWidth={1.5} aria-hidden />
              Modèle {LIBELLES_FICHIER[type]}
            </a>
          ))}
        </div>
      </div>

      <ImportFlotte />

      <Bloc
        titre="Colonnes des modèles"
        description="La première ligne du fichier reprend ces en-têtes. L'ordre des colonnes est libre, et une colonne facultative peut manquer."
      >
        <Alerte>
          <p>
            Dans Excel, enregistrez au format « CSV UTF-8 » pour garder les accents. Avant de saisir, mettez les
            colonnes « N° de permis » et « Code postal » au format Texte&nbsp;: sinon, Excel retire les zéros en tête et
            arrondit les longs numéros.
          </p>
        </Alerte>
        {TYPES_FICHIER.map((type) => (
          <Colonnes key={type} type={type} />
        ))}
      </Bloc>
    </div>
  );
}
