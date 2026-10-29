import { FileUp } from "lucide-react";
import type { ReactNode } from "react";
import { MotConfiance, PastilleConfiance } from "@/components/Confiance";
import { Echeance } from "@/components/Echeance";
import { Plaque } from "@/components/Plaque";
import type { Confiance } from "@/lib/avis/regles";
import { AUJOURDHUI_APERCU } from "./ApercuProduit";

const CHAMPS_LUS: { libelle: string; niveau: Confiance }[] = [
  { libelle: "N° d'avis", niveau: "sur" },
  { libelle: "Plaque", niveau: "sur" },
  { libelle: "Lieu", niveau: "a_verifier" },
];

// Les libellés des 4 étapes sont ceux du PRD (« Format et support »).
const ETAPES: { titre: string; texte: ReactNode; apercu: ReactNode }[] = [
  {
    titre: "Transférez vos avis",
    texte:
      "Déposez le scan ou la photo d'un avis, depuis votre ordinateur ou votre téléphone. En Pro, Désigno relève aussi un libellé Gmail.",
    apercu: (
      <div className="flex items-center gap-2 rounded-field border border-dashed border-gray-300 bg-white px-3 py-2.5 text-label text-secondary">
        <FileUp size={16} strokeWidth={1.5} className="flex-none" />
        PDF, JPG, PNG ou HEIC · 10&nbsp;Mo
      </div>
    ),
  },
  {
    titre: "L'IA les lit",
    texte:
      "Le n° d'avis, la plaque, la date et l'heure, le lieu, l'infraction, le montant et la date d'envoi sont pré-remplis. Un niveau de confiance par champ guide votre vérification.",
    apercu: (
      <ul className="grid gap-1.5 rounded-field border border-line bg-white px-3 py-2.5">
        {CHAMPS_LUS.map(({ libelle, niveau }) => (
          <li key={libelle} className="flex items-center gap-2 text-label">
            <PastilleConfiance niveau={niveau} />
            {libelle}
            <span className="ml-auto">
              <MotConfiance niveau={niveau} />
            </span>
          </li>
        ))}
      </ul>
    ),
  },
  {
    titre: "Désigno retrouve le conducteur",
    texte:
      "D'après vos affectations, Désigno propose la personne qui avait le véhicule à la date et à l'heure de l'infraction. Vous validez vous-même.",
    apercu: (
      <div className="grid gap-2 rounded-field border border-line bg-white px-3 py-2.5 text-label">
        <span className="flex items-center gap-2">
          <Plaque plaque="FG-456-HJ" />
          <span className="text-secondary">le 12/09 à 08:14</span>
        </span>
        <span>
          <span className="text-secondary">Conducteur proposé&nbsp;:</span> <b className="font-medium">Karim B.</b>
        </span>
      </div>
    ),
  },
  {
    titre: "Vous désignez sur l'ANTAI, sans oubli",
    texte: (
      <>
        Un récap prêt à copier champ par champ, et des alertes à{" "}
        <span className="whitespace-nowrap">J-15, J-7 et J-2</span> jusqu&apos;à ce que l&apos;avis soit désigné.
      </>
    ),
    apercu: (
      <div className="rounded-field border border-line bg-white px-3 py-2.5">
        <Echeance echeance="2026-10-12" aujourdhui={AUJOURDHUI_APERCU} court />
      </div>
    ),
  },
];

/** Le fonctionnement en 4 étapes, chacune avec un aperçu fait des vrais composants. */
export function Etapes() {
  return (
    <ol className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {ETAPES.map(({ titre, texte, apercu }, i) => (
        <li key={titre} className="row-span-4 grid grid-rows-subgrid gap-3 rounded-card border border-line bg-white p-5">
          <p className="font-mono text-meta font-medium text-secondary uppercase">Étape {i + 1}</p>
          <h3 className="text-lead font-semibold">{titre}</h3>
          <p className="text-secondary">{texte}</p>
          <div aria-hidden className="mt-2 self-end">
            {apercu}
          </div>
        </li>
      ))}
    </ol>
  );
}
