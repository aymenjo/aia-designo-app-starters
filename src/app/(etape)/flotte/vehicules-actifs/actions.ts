"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import type { EtatAction } from "@/components/Confirmation";
import { MESSAGES } from "@/lib/flotte/regles";
import { rendreActifs } from "@/lib/flotte/vehicules";
import { createClient } from "@/lib/supabase/server";

/**
 * « Garder ces 3 véhicules » : les véhicules cochés redeviennent actifs, les autres restent en lecture seule. Une
 * sélection périmée (rien n'a changé : véhicules archivés ou déjà choisis ailleurs) recharge l'écran, qui montre l'état
 * du moment ; sinon, direction le tableau de bord.
 */
export async function garderVehicules(_etat: EtatAction, formData: FormData): Promise<EtatAction> {
  const ids = formData.getAll("vehicule").filter((id): id is string => typeof id === "string");
  const resultat = await rendreActifs(await createClient(), ids);
  if (!resultat.ok) return { erreur: resultat.erreur, invitationPro: resultat.invitationPro };
  if (!resultat.rendus) {
    refresh();
    return { erreur: MESSAGES.selectionPerimee };
  }
  redirect("/tableau-de-bord");
}
