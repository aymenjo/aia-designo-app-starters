import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LIMITES_FREE, type Plan } from "@/lib/abonnement/plans";
import { choixVehiculesRequis, lireUsage } from "@/lib/abonnement/quotas";
import type { Conducteur } from "@/lib/flotte/conducteurs";
import { nomComplet } from "@/lib/flotte/regles";
import { COLONNES_VEHICULE, type Vehicule } from "@/lib/flotte/vehicules";
import { createClient } from "@/lib/supabase/server";
import { ChoixVehicules, type VehiculeAChoisir } from "./ChoixVehicules";

export const metadata: Metadata = { title: "Véhicules actifs" };

/**
 * Au retour en Free avec plus de 3 véhicules, tous sont passés en lecture seule : le gestionnaire en garde 3. Une fois le
 * choix fait, ou en Pro, l'écran mène au tableau de bord.
 */
export default async function VehiculesActifs() {
  const supabase = await createClient();
  const [entreprise, usage, vehicules] = await Promise.all([
    supabase.from("entreprise").select("plan").single<{ plan: Plan }>(),
    lireUsage(supabase),
    supabase
      .from("vehicule")
      .select(COLONNES_VEHICULE)
      .is("archive_le", null)
      .not("lecture_seule_le", "is", null)
      .order("plaque")
      .overrideTypes<Vehicule[], { merge: false }>(),
  ]);
  if (entreprise.error) throw entreprise.error;
  if (vehicules.error) throw vehicules.error;
  if (!choixVehiculesRequis({ plan: entreprise.data.plan, ...usage })) redirect("/tableau-de-bord");

  // Pour choisir en connaissance de cause : qui conduit chaque véhicule, et ce qu'il reste à traiter dessus.
  const ids = vehicules.data.map(({ id }) => id);
  const [affectations, avis] = await Promise.all([
    supabase
      .from("affectation")
      .select("vehicule_id, conducteur:conducteur!affectation_conducteur_fk(prenom, nom)")
      .in("vehicule_id", ids)
      .is("fin", null)
      .overrideTypes<{ vehicule_id: string; conducteur: Pick<Conducteur, "prenom" | "nom"> }[], { merge: false }>(),
    supabase
      .from("avis")
      .select("vehicule_id")
      .in("vehicule_id", ids)
      .in("statut", ["a_traiter", "a_valider"])
      .overrideTypes<{ vehicule_id: string }[], { merge: false }>(),
  ]);
  if (affectations.error) throw affectations.error;
  if (avis.error) throw avis.error;

  const conducteurs = new Map(affectations.data.map(({ vehicule_id, conducteur }) => [vehicule_id, nomComplet(conducteur)]));
  const avisParVehicule = Map.groupBy(avis.data, ({ vehicule_id }) => vehicule_id);
  const lignes: VehiculeAChoisir[] = vehicules.data.map(({ id, plaque, modele, type }) => ({
    id,
    plaque,
    modele,
    type,
    conducteur: conducteurs.get(id) ?? null,
    avisOuverts: avisParVehicule.get(id)?.length ?? 0,
  }));

  return (
    <div className="grid gap-6">
      <header className="grid gap-2">
        <h1 className="font-display text-title font-bold">Choisissez vos {LIMITES_FREE.vehicules} véhicules actifs</h1>
        <p className="text-secondary">
          Votre compte est repassé en Free&nbsp;: {LIMITES_FREE.vehicules} véhicules actifs au plus. Aucune donnée
          n&apos;est supprimée. Les véhicules que vous ne gardez pas passent en lecture seule&nbsp;: ils restent visibles,
          avec leur historique, et vous pourrez les rendre actifs plus tard, dans la limite du plan Free.
        </p>
      </header>
      <ChoixVehicules vehicules={lignes} />
      <p className="text-label text-secondary">
        Pour garder tous vos véhicules actifs&nbsp;: <Link href="/parametres/abonnement">Repasser en Pro</Link>
      </p>
    </div>
  );
}
