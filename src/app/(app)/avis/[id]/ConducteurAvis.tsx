"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Plaque } from "@/components/Plaque";
import { Alerte } from "@/components/ui/Alerte";
import { Bloc } from "@/components/ui/Bloc";
import { Bouton, classesBouton } from "@/components/ui/Bouton";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { ChampListe } from "@/components/ui/ChampListe";
import type { AvisDetaille } from "@/lib/avis/avis";
import { MESSAGES_AVIS } from "@/lib/avis/regles";
import type { AffectationDetaillee, ChoixAffectation, Voisines } from "@/lib/flotte/affectations";
import { libelleCreneau, type Creneau } from "@/lib/flotte/planning";
import { nomComplet } from "@/lib/flotte/regles";
import { formaterDateHeure } from "@/lib/format";
import type { EtatAffectationManquante, EtatValidation } from "../actions";

type Props = {
  action: (etat: EtatValidation, formData: FormData) => Promise<EtatValidation>;
  /** L'affectation qui couvre l'infraction, conducteur archivé compris, ou `null` s'il n'y en a pas. */
  affectation: AffectationDetaillee | null;
  /** Sans affectation qui couvre l'infraction : celles d'avant et d'après sur ce véhicule, en indices. */
  voisines: Voisines;
  /** L'affectation à enregistrer pour le conducteur validé, quand le planning n'en a pas, ou `null`. */
  manquante: { plaque: string; creneau: Creneau } | null;
  enregistrer: (etat: EtatAffectationManquante, formData: FormData) => Promise<EtatAffectationManquante>;
  /** Le planning du véhicule à la date de l'infraction. */
  planning: string;
  /** Le conducteur déjà validé, archivé compris. */
  valide: AvisDetaille["conducteur"];
  /** Les conducteurs actifs : les seuls qui se valident. */
  conducteurs: ChoixAffectation["conducteurs"];
  /** Le récap ANTAI de l'avis : il s'ouvre une fois un conducteur actif validé. */
  recap: string;
};

/** « Karim Benali (archivé) » : un indice nomme aussi un conducteur archivé. */
function Indice({ libelle, affectation, quand }: { libelle: string; affectation: AffectationDetaillee; quand: string }) {
  return (
    <li>
      {libelle}&nbsp;: <strong className="font-semibold">{nomComplet(affectation.conducteur)}</strong>
      {affectation.conducteur.archive_le && " (archivé)"}, {quand}
    </li>
  );
}

/**
 * Le conducteur proposé d'après le planning, et sa validation : rien n'est écrit sans « Valider ce conducteur ».
 * Sans affectation à cette date, les indices aident à choisir, puis l'affectation manquante s'enregistre d'un clic.
 */
export function ConducteurAvis({
  action,
  affectation,
  voisines,
  manquante,
  enregistrer,
  planning,
  valide,
  conducteurs,
  recap,
}: Props) {
  const propose = affectation && !affectation.conducteur.archive_le ? affectation.conducteur : null;
  // Le choix est ouvert d'emblée quand il n'y a rien à valider d'un clic ; sinon, au clic.
  const [ouvertAuClic, setOuvertAuClic] = useState(false);
  const choixOuvert = ouvertAuClic || (!valide && !propose);
  // Les états vivent ici, toujours monté : le message d'une action survit au rafraîchissement qui la suit. Seul celui
  // de la dernière action s'affiche.
  const [derniere, setDerniere] = useState<"validation" | "affectation">();

  const [etat, envoyer] = useActionState<EtatValidation, FormData>(async (precedent, formData) => {
    const suivant = await action(precedent, formData);
    setDerniere("validation");
    if (suivant.ok) setOuvertAuClic(false);
    return suivant;
  }, {});
  const [etatAffectation, envoyerAffectation] = useActionState<EtatAffectationManquante, FormData>(
    async (precedent, formData) => {
      const suivant = await enregistrer(precedent, formData);
      setDerniere("affectation");
      return suivant;
    },
    {},
  );
  const validation = derniere === "validation" ? etat : {};
  const enregistrement = derniere === "affectation" ? etatAffectation : {};
  // Sans liste à l'écran, un refus sur le conducteur s'affiche avec les autres.
  const erreurChamp = choixOuvert ? validation.erreurs?.conducteur_id : undefined;
  const erreurGenerale =
    validation.erreurs?.general ?? (choixOuvert ? undefined : validation.erreurs?.conducteur_id) ?? enregistrement.erreur;

  return (
    <Bloc titre="Conducteur" description="Désigno propose le conducteur d'après le planning&nbsp;: vous le validez vous-même.">
      {affectation && propose ? (
        <div className="grid gap-1">
          <p>
            Proposé d&apos;après le planning&nbsp;: <strong className="font-semibold">{nomComplet(propose)}</strong>
          </p>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-label text-secondary">
            <Plaque plaque={affectation.vehicule.plaque} />
            <span>{libelleCreneau(affectation.debut, affectation.fin)}</span>
            <Link href={planning}>Voir dans le planning</Link>
          </p>
        </div>
      ) : affectation ? (
        <Alerte>
          <p>
            {MESSAGES_AVIS.conducteurArchivePropose(nomComplet(affectation.conducteur), affectation.vehicule.plaque)}
          </p>
          <p>
            <Link href={`/flotte/conducteurs/${affectation.conducteur.id}`}>Ouvrir sa fiche</Link>
          </p>
        </Alerte>
      ) : (
        <Alerte>
          <p className="font-medium">{MESSAGES_AVIS.aucuneAffectation}.</p>
          {(voisines.avant || voisines.apres) && (
            <ul className="grid gap-0.5">
              {voisines.avant?.fin && (
                <Indice
                  libelle="Avant"
                  affectation={voisines.avant}
                  quand={`jusqu'au ${formaterDateHeure(voisines.avant.fin)}`}
                />
              )}
              {voisines.apres && (
                <Indice
                  libelle="Après"
                  affectation={voisines.apres}
                  quand={`à partir du ${formaterDateHeure(voisines.apres.debut)}`}
                />
              )}
            </ul>
          )}
          <p>
            Choisissez vous-même le conducteur. <Link href={planning}>Voir dans le planning</Link>
          </p>
        </Alerte>
      )}

      {valide && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>
            Conducteur validé&nbsp;: <strong className="font-semibold">{nomComplet(valide)}</strong>
            {valide.archive_le && <span className="text-secondary"> (archivé)</span>}
          </span>
          <Link href={`/flotte/conducteurs/${valide.id}`} className="text-label">
            Ouvrir sa fiche
          </Link>
        </p>
      )}

      {valide && manquante && !choixOuvert && (
        <Alerte>
          <p>{MESSAGES_AVIS.affectationManquante(nomComplet(valide))}</p>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-label text-secondary">
            <Plaque plaque={manquante.plaque} />
            <span>{libelleCreneau(manquante.creneau.debut, manquante.creneau.fin)}</span>
          </p>
          <form action={envoyerAffectation} className="mt-2">
            <BoutonEnvoi variante="secondaire" taille="sm" enCours="Enregistrement…">
              Enregistrer l&apos;affectation
            </BoutonEnvoi>
          </form>
        </Alerte>
      )}

      {erreurGenerale && <Alerte variante="erreur">{erreurGenerale}</Alerte>}
      {validation.ok && !choixOuvert && <Alerte variante="succes">Conducteur validé.</Alerte>}
      {enregistrement.ok && <Alerte variante="succes">Affectation enregistrée dans le planning.</Alerte>}

      {choixOuvert ? (
        <form action={envoyer} className="grid gap-4" noValidate>
          <ChampListe
            name="conducteur_id"
            libelle="Conducteur"
            vide="Choisir un conducteur"
            options={conducteurs.map((conducteur) => ({ valeur: conducteur.id, libelle: nomComplet(conducteur) }))}
            aide={conducteurs.length ? undefined : "Aucun conducteur actif\u00a0: ajoutez-en un depuis la flotte."}
            erreur={erreurChamp}
          />
          <div className="flex flex-wrap gap-2">
            <BoutonEnvoi enCours="Validation…">Valider ce conducteur</BoutonEnvoi>
            {ouvertAuClic && (
              <Bouton variante="ghost" onClick={() => setOuvertAuClic(false)}>
                Annuler
              </Bouton>
            )}
          </div>
        </form>
      ) : valide ? (
        <div className="flex flex-wrap gap-2">
          {/* L'action principale de l'écran, à ce moment : les fiches incomplètes se complètent sur le récap. */}
          {!valide.archive_le && (
            <Link href={recap} className={classesBouton()}>
              Ouvrir le récap ANTAI
            </Link>
          )}
          <Bouton variante="secondaire" onClick={() => setOuvertAuClic(true)}>
            Changer de conducteur
          </Bouton>
        </div>
      ) : (
        propose && (
          <form action={envoyer} className="flex flex-wrap gap-2">
            <input type="hidden" name="conducteur_id" value={propose.id} />
            <BoutonEnvoi enCours="Validation…">Valider ce conducteur</BoutonEnvoi>
            <Bouton variante="ghost" onClick={() => setOuvertAuClic(true)}>
              Choisir un autre conducteur
            </Bouton>
          </form>
        )
      )}
    </Bloc>
  );
}
