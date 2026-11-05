"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Alerte } from "@/components/ui/Alerte";
import { Bloc } from "@/components/ui/Bloc";
import { Bouton } from "@/components/ui/Bouton";
import type { BlocRecap, ChampRecap } from "@/lib/avis/recap";

/** « ✓ Copié » reste 1,5 s, puis le bouton revient à « Copier ». */
const DUREE_COPIE = 1_500;

/** Les 3 blocs du récap, un bouton « Copier » par champ : un seul champ copié à la fois. */
export function RecapAntai({ blocs }: { blocs: BlocRecap[] }) {
  const [copie, setCopie] = useState<ChampRecap | null>(null);
  const [echec, setEchec] = useState(false);
  const minuteur = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(minuteur.current), []);

  async function copier(champ: ChampRecap) {
    clearTimeout(minuteur.current);
    try {
      await navigator.clipboard.writeText(champ.valeur);
    } catch {
      setCopie(null);
      setEchec(true);
      return;
    }
    setEchec(false);
    setCopie(champ);
    minuteur.current = setTimeout(() => setCopie(null), DUREE_COPIE);
  }

  return (
    <div className="grid gap-6">
      {/* Le bouton change de nom sans prendre le focus : l'annonce passe par cette zone. */}
      <p role="status" className="sr-only">
        {copie ? `${copie.libelle} copié` : ""}
      </p>
      {echec && (
        <Alerte variante="erreur">La copie a échoué&nbsp;: sélectionnez la valeur à la main, puis copiez-la.</Alerte>
      )}
      {blocs.map((bloc) => (
        <Bloc key={bloc.titre} titre={bloc.titre}>
          <dl className="-my-3 divide-y divide-line">
            {bloc.champs.map((champ) => {
              const copiee = copie?.cle === champ.cle;
              return (
                <div key={champ.cle} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-3">
                  <dt className="font-mono text-meta font-medium text-secondary uppercase">{champ.libelle}</dt>
                  {/* Jamais tronquée : une valeur longue passe à la ligne. */}
                  <dd className="col-start-1 font-mono text-[15px] font-medium wrap-anywhere">{champ.valeur}</dd>
                  <dd className="col-start-2 row-span-2 row-start-1">
                    <Bouton
                      variante="ghost"
                      taille="sm"
                      aria-label={`${copiee ? "Copié" : "Copier"} ${champ.libelle}`}
                      onClick={() => copier(champ)}
                      className={[
                        "min-w-24 duration-200! motion-reduce:transition-none",
                        copiee && "bg-ok-tint! text-ok!",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      {copiee ? (
                        <Check size={16} strokeWidth={1.5} aria-hidden />
                      ) : (
                        <Copy size={16} strokeWidth={1.5} aria-hidden />
                      )}
                      {copiee ? "Copié" : "Copier"}
                    </Bouton>
                  </dd>
                </div>
              );
            })}
          </dl>
        </Bloc>
      ))}
    </div>
  );
}
