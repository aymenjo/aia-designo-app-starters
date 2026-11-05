"use client";

import { MailCheck } from "lucide-react";
import { useActionState, type ReactNode } from "react";
import { Alerte } from "@/components/ui/Alerte";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { Champ } from "@/components/ui/Champ";
import { demanderLien, type EtatDemande } from "./actions";

type Props = {
  /** Titre et explication, remplacés par « Vérifiez votre boîte mail » une fois le lien parti. */
  entete: ReactNode;
  libelleBouton: string;
  /** Page à rouvrir après connexion. */
  suivant?: string;
  /** Adresse mémorisée (masquée) : le nouveau lien part en un clic, sans ressaisie. */
  renvoiA?: string;
};

export function FormulaireLien({ entete, libelleBouton, suivant, renvoiA }: Props) {
  const [etat, envoyer] = useActionState<EtatDemande, FormData>(demanderLien, {});
  // Si l'adresse mémorisée a disparu entre-temps, on revient au champ email.
  const enUnClic = Boolean(renvoiA) && !etat.erreurEmail;

  if (etat.envoyeA) {
    return (
      <div className="grid gap-6">
        <div className="grid gap-2">
          <MailCheck size={20} strokeWidth={1.5} aria-hidden className="text-ok" />
          <h1 className="font-display text-title font-bold">Vérifiez votre boîte mail</h1>
          <p className="text-secondary">
            Un lien de connexion a été envoyé à <strong className="font-semibold text-ink">{etat.envoyeA}</strong>.
            Il est valable 15 minutes, une seule fois.
          </p>
        </div>
        {etat.erreur && <Alerte variante="erreur">{etat.erreur}</Alerte>}
        <form action={envoyer} className="flex flex-wrap items-center gap-3">
          <BoutonEnvoi variante="secondaire" enCours="Envoi…">
            Renvoyer le lien
          </BoutonEnvoi>
          {/* Rechargement complet pour repartir d'un formulaire vide. */}
          <a href="/connexion" className="text-label">
            Changer d&apos;adresse
          </a>
        </form>
      </div>
    );
  }

  return (
    <form action={envoyer} className="grid gap-6" noValidate>
      {entete}
      {etat.erreur && <Alerte variante="erreur">{etat.erreur}</Alerte>}
      {!enUnClic && (
        <Champ
          name="email"
          libelle="Adresse email"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="vous@entreprise.fr"
          defaultValue={etat.email}
          erreur={etat.erreurEmail}
          required
          autoFocus={!renvoiA}
        />
      )}
      {suivant !== undefined && <input type="hidden" name="suivant" value={suivant} />}
      <BoutonEnvoi pleineLargeur enCours="Envoi…">
        {enUnClic ? `${libelleBouton} à ${renvoiA}` : libelleBouton}
      </BoutonEnvoi>
    </form>
  );
}
