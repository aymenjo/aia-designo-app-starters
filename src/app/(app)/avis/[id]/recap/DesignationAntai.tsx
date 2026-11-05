"use client";

import { useActionState, useId, useState, type ReactNode } from "react";
import type { EtatAction } from "@/components/Confirmation";
import { Alerte } from "@/components/ui/Alerte";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";

/** Pro : le conducteur à prévenir. Sans email, la case est désactivée, avec de quoi l'ajouter sur place. */
export type PrevenirConducteur =
  | { disponible: true; nom: string; email: string; apercu: ReactNode }
  | { disponible: false; nom: string; ajoutEmail: ReactNode };

type Props = {
  action: (etat: EtatAction, formData: FormData) => Promise<EtatAction>;
  /** Free : le cadenas « Email au conducteur » remplace la case. */
  cadenas?: ReactNode;
  prevenir?: PrevenirConducteur;
};

/**
 * « J'ai désigné sur l'ANTAI » : le seul geste qui passe l'avis « Désigné ». Désigno ne transmet rien à l'ANTAI. En Pro,
 * la case « Prévenir … par email », cochée par défaut, envoie l'email de l'aperçu au même clic.
 */
export function DesignationAntai({ action, cadenas, prevenir }: Props) {
  const [etat, envoyer] = useActionState<EtatAction, FormData>(action, {});
  const [coche, setCoche] = useState(true);
  const idCase = useId();
  // Cochée dès que l'email est ajouté, sauf si le gestionnaire l'a décochée.
  const prevenu = prevenir?.disponible === true && coche;

  return (
    <div className="grid gap-4">
      {cadenas}
      {prevenir && (
        <div className="grid gap-3">
          <div className="flex gap-3">
            <input
              id={idCase}
              type="checkbox"
              checked={prevenu}
              disabled={!prevenir.disponible}
              onChange={(e) => setCoche(e.target.checked)}
              className="mt-1 size-4 flex-none cursor-pointer accent-ink disabled:cursor-not-allowed"
            />
            <div className="grid min-w-0 gap-0.5">
              <label
                htmlFor={idCase}
                className={prevenir.disponible ? "cursor-pointer font-medium" : "font-medium text-secondary"}
              >
                Prévenir {prevenir.nom} par email
              </label>
              {prevenir.disponible ? (
                <p className="text-label text-secondary wrap-anywhere">{prevenir.email}</p>
              ) : (
                // Une div : la fenêtre « Ajouter son email » ne peut pas vivre dans un paragraphe.
                <div className="text-label text-secondary">email manquant · {prevenir.ajoutEmail}</div>
              )}
            </div>
          </div>
          {prevenir.disponible && prevenu && prevenir.apercu}
        </div>
      )}
      {/* La case est hors du formulaire : la fenêtre « Ajouter son email » a le sien, et les formulaires ne s'imbriquent pas. */}
      <form action={envoyer} className="grid gap-4">
        {prevenu && <input type="hidden" name="prevenir" value="on" />}
        {etat.erreur && <Alerte variante="erreur">{etat.erreur}</Alerte>}
        <div>
          <BoutonEnvoi enCours={prevenu ? "Envoi de l'email…" : "Enregistrement…"}>
            J&apos;ai désigné sur l&apos;ANTAI
          </BoutonEnvoi>
        </div>
      </form>
    </div>
  );
}
