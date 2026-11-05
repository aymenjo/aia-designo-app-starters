"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import type { EtatAction } from "@/components/Confirmation";
import { Alerte } from "@/components/ui/Alerte";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { Champ } from "@/components/ui/Champ";
import { Fenetre } from "@/components/ui/Fenetre";
import { confirmationCorrecte, type TexteConfirmation } from "@/lib/compte/regles";
import { supprimerMonCompte } from "./actions";

type Props = {
  /** La raison sociale à recopier, ou l'email si la fiche n'en a pas. */
  attendu: TexteConfirmation;
  /** Un abonnement en cours, annulé sur-le-champ. */
  abonnement: boolean;
  /** Une boîte Gmail connectée, déconnectée avec le compte. */
  gmail: boolean;
};

/**
 * « Supprimer le compte » : une fenêtre explique ce qui sera effacé, puis le gestionnaire recopie la raison sociale (ou
 * son email). Comme `Confirmation`, mais la saisie part avec le formulaire, et le bouton n'est actif qu'une fois la
 * saisie correcte. Le serveur la revérifie.
 */
export function SuppressionCompte({ attendu, abonnement, gmail }: Props) {
  const [ouverte, setOuverte] = useState(false);
  const [saisie, setSaisie] = useState("");
  const [etat, envoyer] = useActionState<EtatAction, FormData>(supprimerMonCompte, {});

  return (
    <>
      <Bouton
        variante="secondaire"
        onClick={() => {
          setSaisie("");
          setOuverte(true);
        }}
      >
        Supprimer le compte
      </Bouton>
      <Fenetre titre="Supprimer votre compte ?" ouverte={ouverte} onFermer={() => setOuverte(false)}>
        <div className="grid gap-2 text-secondary">
          <p>
            La fiche entreprise, les véhicules, les conducteurs, le planning, les avis et leurs fichiers seront effacés
            définitivement.
          </p>
          {abonnement && (
            <p>
              Votre abonnement Pro sera annulé sur-le-champ. Téléchargez d&apos;abord vos factures depuis{" "}
              <Link href="/parametres/abonnement">Abonnement</Link>, avec « Gérer mon abonnement ».
            </p>
          )}
          {gmail && <p>Gmail sera déconnecté : Désigno n&apos;aura plus accès à votre boîte.</p>}
          <p>Vous pourrez ensuite recréer un compte vierge avec la même adresse email.</p>
        </div>
        {etat.erreur && <Alerte variante="erreur">{etat.erreur}</Alerte>}
        <form action={envoyer} className="grid gap-5">
          <Champ
            name="confirmation"
            libelle={`Saisissez « ${attendu.texte} » pour confirmer`}
            autoComplete="off"
            spellCheck={false}
            value={saisie}
            onChange={(e) => setSaisie(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <BoutonEnvoi enCours="Suppression…" disabled={!confirmationCorrecte(saisie, attendu)}>
              Supprimer définitivement
            </BoutonEnvoi>
            <Bouton variante="ghost" onClick={() => setOuverte(false)}>
              Annuler
            </Bouton>
          </div>
        </form>
      </Fenetre>
    </>
  );
}
