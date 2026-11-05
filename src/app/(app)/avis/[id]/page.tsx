import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BadgeEcheanceDepassee } from "@/components/BadgeEcheanceDepassee";
import { BadgeVehiculeInconnu } from "@/components/BadgeVehiculeInconnu";
import { BadgeVerrouille } from "@/components/BadgeVerrouille";
import { CadenasPro } from "@/components/CadenasPro";
import { Confirmation } from "@/components/Confirmation";
import { StatutAvis } from "@/components/StatutAvis";
import { Alerte } from "@/components/ui/Alerte";
import { Bloc } from "@/components/ui/Bloc";
import { classesBouton } from "@/components/ui/Bouton";
import { LIMITES_FREE, type Plan } from "@/lib/abonnement/plans";
import { debutHistorique, masqueParHistorique, prochainDeverrouillage } from "@/lib/abonnement/quotas";
import { lireAvis, urlFichier, versValeurs } from "@/lib/avis/avis";
import { echeanceDepassee } from "@/lib/avis/echeance";
import { lecteurConfigure } from "@/lib/avis/lecteur-claude";
import {
  LIBELLES_MOTIF_CLASSEMENT,
  LIBELLES_STATUT,
  MESSAGES_AVIS,
  aLireALOuverture,
  champsAConfirmer,
  estOuvert,
  champsManquantsAvis,
  refusValidationConducteur,
  refusVehiculeDepuisAvis,
  schemaIdAvis,
  statutDerive,
  vehiculeInconnu,
} from "@/lib/avis/regles";
import { depuisIso, partiesParis } from "@/lib/dates";
import { affectationCouvrante, affectationsVoisines, conducteursActifs } from "@/lib/flotte/affectations";
import { creneauManquant, lienPlanning } from "@/lib/flotte/planning";
import { nomComplet } from "@/lib/flotte/regles";
import { formaterDate, formaterDateAHeure, formaterDateHeure } from "@/lib/format";
import { lienGmail } from "@/lib/gmail/regles";
import { createClient } from "@/lib/supabase/server";
import {
  classerAvis,
  creerVehiculeDepuisAvis,
  enregistrerAffectationManquante,
  enregistrerAvis,
  rouvrirAvis,
  validerConducteur,
} from "../actions";
import { ClassementAvis } from "./ClassementAvis";
import { ConducteurAvis } from "./ConducteurAvis";
import { FormulaireAvis } from "./FormulaireAvis";
import { LectureDifferee } from "./LectureDifferee";
import { VehiculeInconnu } from "./VehiculeInconnu";
import { VisionneuseAvis } from "./VisionneuseAvis";

export const metadata: Metadata = { title: "Avis" };

// Vaut aussi pour les server actions de la page : un avis déverrouillé (plan Free), ou relevé dans Gmail et resté sans
// lecture, est lu par l'IA à son ouverture, ce qui peut prendre une minute (une relance comprise, voir lecteur-claude.ts).
export const maxDuration = 120;

/** L'affectation qui couvre l'infraction, à défaut ses voisines, et les conducteurs actifs parmi lesquels choisir. */
async function lireProposition(supabase: SupabaseClient, vehiculeId: string, instant: string) {
  const [couvrante, voisines, conducteurs] = await Promise.all([
    affectationCouvrante(supabase, vehiculeId, instant),
    affectationsVoisines(supabase, vehiculeId, instant),
    conducteursActifs(supabase),
  ]);
  if (couvrante.error) throw couvrante.error;
  if (voisines.error) throw voisines.error;
  if (conducteurs.error) throw conducteurs.error;
  return { affectation: couvrante.data, voisines: voisines.data, conducteurs: conducteurs.data ?? [] };
}

export default async function PageAvis(props: PageProps<"/avis/[id]">) {
  const { id } = await props.params;
  if (!schemaIdAvis.safeParse(id).success) notFound();

  const supabase = await createClient();
  const [{ data: avis, error }, entreprise] = await Promise.all([
    lireAvis(supabase, id),
    supabase.from("entreprise").select("plan").single<{ plan: Plan }>(),
  ]);
  if (error) throw error;
  if (entreprise.error) throw entreprise.error;
  if (!avis) notFound();

  const titre = (
    <h1 className="font-display text-title font-bold">
      {avis.numero ? (
        <>
          Avis n° <span className="font-mono font-medium tracking-normal">{avis.numero}</span>
        </>
      ) : (
        `Avis déposé le ${formaterDate(avis.depose_le)}`
      )}
    </h1>
  );
  const retour = (
    <Link href="/avis" className="inline-flex items-center gap-1.5 justify-self-start text-label">
      <ArrowLeft size={16} strokeWidth={1.5} aria-hidden />
      Avis
    </Link>
  );

  // Masqué par l'historique Free, mais jamais supprimé : le lien « Cet avis existe déjà » peut mener ici.
  if (masqueParHistorique(avis, debutHistorique(entreprise.data.plan))) {
    return (
      <div className="grid max-w-[720px] gap-6">
        {retour}
        <header className="flex flex-wrap items-center gap-3">
          {titre}
          <StatutAvis statut={avis.statut} />
        </header>
        <CadenasPro fonction="Historique complet">
          <p>
            Cet avis a été {avis.statut === "designe" ? "désigné" : "classé"} le{" "}
            {formaterDate((avis.designe_le ?? avis.classe_le)!)}&nbsp;: en Free, l&apos;historique est visible sur{" "}
            {LIMITES_FREE.historiqueMois} mois. Il n&apos;est pas supprimé, et réapparaît dès le passage en Pro.
          </p>
        </CadenasPro>
      </div>
    );
  }
  // Le conducteur ne se propose que sur un avis « À valider » rattaché à un véhicule : la même règle que l'écriture.
  const { vehicule_id: vehiculeId, infraction_le: instant } = avis;
  const validable = refusValidationConducteur(avis) === null && vehiculeId && instant;
  const [url, proposition] = await Promise.all([
    urlFichier(supabase, avis.fichier),
    validable ? lireProposition(supabase, vehiculeId, instant) : null,
  ]);
  // L'affectation manquante ne s'enregistre que pour un véhicule et un conducteur validé actifs : les règles des écrans.
  // D'après l'état du véhicule, et non de l'avis : un avis déposé avant sa lecture seule reste traitable, mais le
  // véhicule ne reçoit plus d'affectation.
  const { vehicule, conducteur } = avis;
  const vehiculeActif = vehicule && !vehicule.archive_le && !vehicule.lecture_seule_le;
  const creneau =
    proposition && instant && !proposition.affectation && vehiculeActif && conducteur && !conducteur.archive_le
      ? creneauManquant(instant, proposition.voisines.avant, proposition.voisines.apres)
      : null;
  const manquante = creneau && vehicule ? { plaque: vehicule.plaque, creneau } : null;
  const verrouille = avis.verrouille && estOuvert(avis.statut);
  // Retour en Free : déposé depuis le passage de son véhicule en lecture seule, l'avis attend qu'il redevienne actif.
  const bloque = avis.vehicule_lecture_seule && estOuvert(avis.statut);
  // Un avis déverrouillé ou relevé, jamais lu, l'est à son ouverture ; le formulaire repart des valeurs lues (`key`).
  const formulaire = (
    <FormulaireAvis
      key={avis.lecture_ia ?? "jamais"}
      action={enregistrerAvis.bind(null, avis.id)}
      valeurs={versValeurs(avis)}
      plaque={avis.plaque}
      vehicule={avis.vehicule}
      manquants={avis.statut === "a_traiter" ? champsManquantsAvis(avis) : []}
      confiances={avis.confiances}
      aConfirmer={champsAConfirmer(avis)}
      refusees={avis.valeurs_refusees}
      designeLe={avis.designe_le}
      classeLe={avis.classe_le}
    />
  );
  // Rouvert, l'avis reprend le statut que donnent ses champs : la même règle que l'écriture.
  const rouvert = `Il repasse « ${LIBELLES_STATUT[statutDerive(avis)]} »`;
  const rouvrir = {
    libelle: "Rouvrir l'avis",
    titre: "Rouvrir cet avis ?",
    confirmer: "Rouvrir",
    enCours: "Réouverture…",
    action: rouvrirAvis.bind(null, avis.id),
  };

  return (
    <div className="grid gap-6">
      {retour}

      <header className="flex flex-wrap items-center gap-3">
        {titre}
        <StatutAvis statut={avis.statut} />
        {(verrouille || bloque) && <BadgeVerrouille />}
        {echeanceDepassee(avis) && <BadgeEcheanceDepassee />}
        {vehiculeInconnu(avis) && <BadgeVehiculeInconnu />}
      </header>

      {/* La proposition et la création du véhicule tombent d'elles-mêmes : leurs règles refusent un avis verrouillé. */}
      {verrouille && (
        <CadenasPro fonction="Lecture IA, conducteur proposé et récap ANTAI">
          <p>
            Cet avis dépasse les {LIMITES_FREE.avisParMois} avis du mois du plan Free. Ces fonctions reviennent le{" "}
            {depuisIso(prochainDeverrouillage()).slice(0, 5)}, dans la limite des {LIMITES_FREE.avisParMois} avis du
            mois, ou dès le passage en Pro.
          </p>
          <p>
            D&apos;ici là, saisissez au moins la plaque et la date d&apos;envoi&nbsp;: l&apos;échéance est calculée et
            les alertes partent.
          </p>
        </CadenasPro>
      )}

      {/* La proposition et la création du véhicule tombent d'elles-mêmes : leurs règles refusent un avis bloqué. */}
      {bloque && vehicule && (
        <CadenasPro fonction="Conducteur proposé et récap ANTAI">
          <p>
            Le véhicule {vehicule.plaque} est en lecture seule depuis le retour en Free&nbsp;: {LIMITES_FREE.vehicules}{" "}
            véhicules actifs au plus. Cet avis, déposé depuis, attend qu&apos;il redevienne actif, ou le passage en Pro.
          </p>
          <p>
            Son échéance et ses alertes restent actives.{" "}
            <Link href={`/flotte/vehicules/${vehicule.id}`}>Ouvrir la fiche du véhicule</Link>
          </p>
        </CadenasPro>
      )}

      {avis.lecture_ia === "echec" && (
        <Alerte>
          Désigno n&apos;a pas pu lire cet avis&nbsp;: saisissez ses champs à la main, en vous aidant de l&apos;image.
        </Alerte>
      )}

      {/* L'image à gauche reste visible pendant que l'on parcourt les champs. */}
      <div className="grid items-start gap-6 lg:grid-cols-12">
        <div className="lg:sticky lg:top-8 lg:col-span-7">
          <VisionneuseAvis url={url} type={avis.fichier_type} />
        </div>
        <div className="grid gap-6 lg:col-span-5">
          {aLireALOuverture(avis) && lecteurConfigure() ? (
            <LectureDifferee
              id={avis.id}
              explication={
                avis.source === "gmail"
                  ? "Cet avis a été relevé dans Gmail : Désigno lit ses informations, comme après un dépôt."
                  : "Cet avis vient d'être déverrouillé : Désigno lit ses informations, comme après un dépôt. Les champs déjà saisis sont gardés."
              }
            >
              {formulaire}
            </LectureDifferee>
          ) : (
            formulaire
          )}
          {/* Un formulaire à part : les formulaires ne s'imbriquent pas. */}
          {proposition && vehiculeId && instant && (
            <ConducteurAvis
              action={validerConducteur.bind(null, avis.id)}
              affectation={proposition.affectation}
              voisines={proposition.voisines}
              manquante={manquante}
              enregistrer={enregistrerAffectationManquante.bind(null, avis.id)}
              planning={lienPlanning({ vehicule: vehiculeId, date: partiesParis(instant).date })}
              valide={avis.conducteur}
              conducteurs={proposition.conducteurs}
              recap={`/avis/${avis.id}/recap`}
            />
          )}
          {avis.statut === "designe" && avis.designe_le && (
            <Bloc titre="Désignation" description="Vous avez désigné le conducteur sur le site de l'ANTAI.">
              <div className="grid gap-1">
                <p>Désigné le {formaterDateAHeure(avis.designe_le)}</p>
                {avis.conducteur && (
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span>
                      Conducteur désigné&nbsp;: <strong className="font-semibold">{nomComplet(avis.conducteur)}</strong>
                    </span>
                    <Link href={`/flotte/conducteurs/${avis.conducteur.id}`} className="text-label">
                      Ouvrir sa fiche
                    </Link>
                  </p>
                )}
                {avis.conducteur && avis.conducteur_prevenu_le && (
                  <p>{MESSAGES_AVIS.prevenuParEmail(nomComplet(avis.conducteur), avis.conducteur.civilite)}</p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href={`/avis/${avis.id}/recap`} className={classesBouton({ variante: "secondaire" })}>
                  Voir le récap ANTAI
                </Link>
                <Confirmation
                  {...rouvrir}
                  explication={`${rouvert} : la date de désignation est effacée, et le conducteur validé redevient modifiable.`}
                />
              </div>
            </Bloc>
          )}
          {avis.statut === "classe" && avis.classe_le && avis.motif_classement ? (
            <Bloc titre="Classement" description="Cet avis est sorti du suivi : il n'a plus d'échéance ni d'alerte.">
              <div className="grid gap-1">
                <p>Classé le {formaterDateAHeure(avis.classe_le)}</p>
                <p>
                  Motif&nbsp;:{" "}
                  <strong className="font-semibold">
                    {avis.motif_libre ?? LIBELLES_MOTIF_CLASSEMENT[avis.motif_classement]}
                  </strong>
                </p>
              </div>
              <div>
                <Confirmation {...rouvrir} explication={`${rouvert}, et retrouve son échéance et ses alertes.`} />
              </div>
            </Bloc>
          ) : refusVehiculeDepuisAvis(avis) === null && avis.plaque ? (
            <VehiculeInconnu
              plaque={avis.plaque}
              creer={creerVehiculeDepuisAvis.bind(null, avis.id)}
              classer={classerAvis.bind(null, avis.id)}
            />
          ) : (
            <section className="flex flex-wrap items-center justify-between gap-4 rounded-card border border-line p-6 max-md:p-5">
              <div className="grid gap-1">
                <h2 className="font-semibold">Classer cet avis</h2>
                <p className="text-label text-secondary">
                  Pour un avis qui ne donne pas lieu à désignation&nbsp;: contesté, véhicule volé, avis non soumis… Vous
                  pourrez le rouvrir.
                </p>
              </div>
              <ClassementAvis action={classerAvis.bind(null, avis.id)} designe={avis.statut === "designe"} />
            </section>
          )}
          {/* L'email d'origine (phase 23) : ses métadonnées seulement, le corps n'est pas gardé. */}
          {avis.email && (
            <Bloc titre="Reçu par Gmail">
              <dl className="-my-2 grid gap-x-4 gap-y-1 text-label sm:grid-cols-[auto_minmax(0,1fr)]">
                <dt className="text-secondary">Expéditeur</dt>
                <dd className="min-w-0 break-words">{avis.email.expediteur ?? "—"}</dd>
                <dt className="text-secondary">Objet</dt>
                <dd className="min-w-0 break-words">{avis.email.objet ?? "(sans objet)"}</dd>
                {avis.email.recu_le && (
                  <>
                    <dt className="text-secondary">Reçu le</dt>
                    <dd>{formaterDateHeure(avis.email.recu_le)}</dd>
                  </>
                )}
                {avis.fichier_nom && (
                  <>
                    <dt className="text-secondary">Fichier</dt>
                    <dd className="min-w-0 font-mono font-medium break-all">{avis.fichier_nom}</dd>
                  </>
                )}
              </dl>
              <a
                href={lienGmail(avis.email.boite, avis.email.message_id)}
                target="_blank"
                rel="noreferrer"
                className="justify-self-start text-label"
              >
                Ouvrir dans Gmail
              </a>
            </Bloc>
          )}
        </div>
      </div>
    </div>
  );
}
