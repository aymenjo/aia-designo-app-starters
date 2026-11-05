"use client";

import { useActionState, useState } from "react";
import type { EtatAction } from "@/components/Confirmation";
import { LienPasserEnPro } from "@/components/LienPasserEnPro";
import { Plaque } from "@/components/Plaque";
import { Alerte } from "@/components/ui/Alerte";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { PastilleType } from "@/app/(app)/flotte/vehicules/PastilleType";
import { LIMITES_FREE } from "@/lib/abonnement/plans";
import type { TypeVehicule } from "@/lib/flotte/regles";
import { garderVehicules } from "./actions";

export type VehiculeAChoisir = {
  id: string;
  plaque: string;
  modele: string | null;
  type: TypeVehicule;
  /** Le conducteur de l'affectation ouverte, s'il y en a une. */
  conducteur: string | null;
  avisOuverts: number;
};

/**
 * Les véhicules en lecture seule, à cocher : 3 au plus, le plan Free. Le bouton n'est actif qu'une fois le compte bon ;
 * avec moins de 3 véhicules, tous. La base refuse de toute façon un 4e véhicule actif.
 */
export function ChoixVehicules({ vehicules }: { vehicules: VehiculeAChoisir[] }) {
  const [choisis, setChoisis] = useState<string[]>([]);
  const [etat, envoyer] = useActionState<EtatAction, FormData>(garderVehicules, {});
  const attendus = Math.min(LIMITES_FREE.vehicules, vehicules.length);
  const complet = choisis.length === attendus;
  const basculer = (id: string) =>
    setChoisis((avant) => (avant.includes(id) ? avant.filter((un) => un !== id) : [...avant, id]));

  return (
    <form action={envoyer} className="grid gap-5">
      {etat.erreur && (
        <Alerte variante="erreur">
          <p>{etat.erreur}</p>
          {etat.invitationPro && <LienPasserEnPro />}
        </Alerte>
      )}
      <fieldset className="grid gap-2">
        <legend className="mb-2 font-semibold">Véhicules à garder actifs</legend>
        <ul className="divide-y divide-line overflow-hidden rounded-card border border-line">
          {vehicules.map((vehicule) => {
            const coche = choisis.includes(vehicule.id);
            return (
              <li key={vehicule.id}>
                <label
                  className={[
                    "flex min-h-13 items-center gap-3 px-4 py-2 transition-colors duration-120 ease-enter",
                    !coche && complet ? "cursor-not-allowed text-secondary" : "cursor-pointer hover:bg-surface",
                  ].join(" ")}
                >
                  <input
                    type="checkbox"
                    name="vehicule"
                    value={vehicule.id}
                    checked={coche}
                    disabled={!coche && complet}
                    onChange={() => basculer(vehicule.id)}
                    className="size-4 flex-none accent-ink"
                  />
                  <Plaque plaque={vehicule.plaque} />
                  <span className="grid min-w-0 flex-1">
                    <span className={`truncate ${vehicule.modele ? "" : "text-secondary"}`}>{vehicule.modele ?? "—"}</span>
                    <span className="truncate text-label text-secondary">
                      {vehicule.conducteur ?? "Aucune affectation en cours"}
                      {vehicule.avisOuverts > 0 &&
                        ` · ${vehicule.avisOuverts} avis ouvert${vehicule.avisOuverts > 1 ? "s" : ""}`}
                    </span>
                  </span>
                  <PastilleType type={vehicule.type} />
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <BoutonEnvoi disabled={!complet} enCours="Enregistrement…">
          {attendus === 1 ? "Garder ce véhicule" : `Garder ces ${attendus} véhicules`}
        </BoutonEnvoi>
        <span aria-live="polite" className="font-mono text-label text-secondary">
          {choisis.length}/{attendus} choisis
        </span>
      </div>
    </form>
  );
}
