"use client";

import { useRouter } from "next/navigation";
import { ChampListe } from "@/components/ui/ChampListe";
import { lienPlanning, type ParametresPlanning } from "@/lib/flotte/planning";

type Props = {
  parametres: ParametresPlanning;
  options: { valeur: string; libelle: string }[];
};

/**
 * Filtre par conducteur : il change l'adresse, le serveur relit le planning. Sa valeur suit l'adresse,
 * y compris avec Précédent et Suivant du navigateur.
 */
export function FiltreConducteur({ parametres, options }: Props) {
  const router = useRouter();

  return (
    <ChampListe
      name="conducteur"
      libelle="Conducteur"
      vide="Tous les conducteurs"
      options={options}
      defaultValue={parametres.conducteur ?? ""}
      onChange={(e) => router.push(lienPlanning({ ...parametres, conducteur: e.currentTarget.value || undefined }))}
      className="w-60 max-sm:w-full"
    />
  );
}
