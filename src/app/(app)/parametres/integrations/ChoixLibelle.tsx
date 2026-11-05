"use client";

import { useActionState } from "react";
import type { EtatAction } from "@/components/Confirmation";
import { Alerte } from "@/components/ui/Alerte";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { ChampListe } from "@/components/ui/ChampListe";
import type { LibelleGmail } from "@/lib/gmail/composio";
import { MESSAGES_GMAIL } from "@/lib/gmail/regles";
import { choisirLibelleGmail } from "./actions";

/** Le libellé à relever, parmi ceux que le gestionnaire a créés dans Gmail. */
export function ChoixLibelle({ libelles, actuel }: { libelles: LibelleGmail[]; actuel: string | null }) {
  const [etat, envoyer] = useActionState<EtatAction, FormData>(choisirLibelleGmail, {});

  if (!libelles.length) return <Alerte>{MESSAGES_GMAIL.sansLibelle}</Alerte>;
  return (
    <form action={envoyer} className="grid gap-3">
      {etat.erreur && <Alerte variante="erreur">{etat.erreur}</Alerte>}
      <div className="flex flex-wrap items-end gap-3">
        <ChampListe
          name="libelle"
          libelle="Libellé à relever"
          vide="Choisir un libellé"
          options={libelles.map(({ id, nom }) => ({ valeur: id, libelle: nom }))}
          defaultValue={actuel ?? ""}
          className="w-full max-w-[320px]"
          required
        />
        <BoutonEnvoi enCours="Enregistrement…">{actuel ? "Changer de libellé" : "Relever ce libellé"}</BoutonEnvoi>
      </div>
      <p className="text-label text-secondary">{MESSAGES_GMAIL.nouveauxSeulement}</p>
    </form>
  );
}
