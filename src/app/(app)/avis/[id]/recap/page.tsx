import { ArrowLeft, ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CadenasPro } from "@/components/CadenasPro";
import { StatutAvis } from "@/components/StatutAvis";
import { Alerte } from "@/components/ui/Alerte";
import { Bloc } from "@/components/ui/Bloc";
import { classesBouton } from "@/components/ui/Bouton";
import { LIMITES_FREE, type Plan } from "@/lib/abonnement/plans";
import { debutHistorique, masqueParHistorique } from "@/lib/abonnement/quotas";
import { lireAvisRecap } from "@/lib/avis/avis";
import { URL_ANTAI, contenuRecap, manquantsRecap, refusRecap } from "@/lib/avis/recap";
import { schemaIdAvis } from "@/lib/avis/regles";
import { lireFiche, versValeurs as valeursEntreprise } from "@/lib/entreprise/fiche";
import { LIBELLES_CHAMP } from "@/lib/entreprise/regles";
import { versValeurs as valeursConducteur } from "@/lib/flotte/conducteurs";
import { LIBELLES_CHAMP_CONDUCTEUR, nomComplet } from "@/lib/flotte/regles";
import { formaterDateAHeure } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { completerConducteur } from "../../../flotte/conducteurs/actions";
import { FormulaireConducteur } from "../../../flotte/conducteurs/FormulaireConducteur";
import { completerEntreprise } from "../../../parametres/entreprise/actions";
import { FormulaireEntreprise } from "../../../parametres/entreprise/FormulaireEntreprise";
import { marquerDesigne } from "../../actions";
import { DesignationAntai } from "./DesignationAntai";
import { RecapAntai } from "./RecapAntai";

export const metadata: Metadata = { title: "Récap ANTAI" };

export default async function PageRecap(props: PageProps<"/avis/[id]/recap">) {
  const { id } = await props.params;
  if (!schemaIdAvis.safeParse(id).success) notFound();

  const supabase = await createClient();
  const [{ data: avis, error }, entreprise, abonnement] = await Promise.all([
    lireAvisRecap(supabase, id),
    lireFiche(supabase),
    supabase.from("entreprise").select("plan").single<{ plan: Plan }>(),
  ]);
  if (error) throw error;
  if (abonnement.error) throw abonnement.error;
  if (!avis) notFound();
  // Masqué par l'historique Free, comme l'avis : son récap ne se consulte plus, sans rien supprimer.
  const masque = masqueParHistorique(avis, debutHistorique(abonnement.data.plan));

  // Les mêmes règles que « J'ai désigné sur l'ANTAI » : le récap ne s'ouvre que sur un avis prêt à désigner.
  const { conducteur } = avis;
  const refus = refusRecap(avis, conducteur);
  const manquants = conducteur && !refus ? manquantsRecap({ conducteur, entreprise }) : null;
  const incomplet = manquants && (manquants.conducteur.length > 0 || manquants.entreprise.length > 0);

  // Une flèche, et non une déclaration : `avis` y reste non nul.
  const contenu = () => {
    if (masque) {
      return (
        <CadenasPro fonction="Historique complet">
          <p>
            En Free, l&apos;historique est visible sur {LIMITES_FREE.historiqueMois} mois. Cet avis n&apos;est pas
            supprimé, et réapparaît dès le passage en Pro.
          </p>
        </CadenasPro>
      );
    }

    if (refus || !conducteur || !manquants) {
      return (
        <Alerte>
          <p>{refus}</p>
          <p>
            {conducteur?.archive_le ? (
              <Link href={`/flotte/conducteurs/${conducteur.id}`}>Ouvrir sa fiche</Link>
            ) : (
              <Link href={`/avis/${avis.id}`}>Ouvrir l&apos;avis</Link>
            )}
          </p>
        </Alerte>
      );
    }

    if (incomplet) {
      return (
        <>
          <Alerte>
            <p className="font-medium">Pour ouvrir le récap, complétez&nbsp;:</p>
            <ul className="list-disc pl-5">
              {manquants.conducteur.map((champ) => (
                <li key={champ}>
                  {LIBELLES_CHAMP_CONDUCTEUR[champ]} ({nomComplet(conducteur)})
                </li>
              ))}
              {manquants.entreprise.map((champ) => (
                <li key={champ}>{LIBELLES_CHAMP[champ]}</li>
              ))}
            </ul>
          </Alerte>

          {manquants.conducteur.length > 0 && (
            <section aria-labelledby="fiche-conducteur" className="grid gap-4">
              <div className="grid gap-1">
                <h2 id="fiche-conducteur" className="text-title-sm font-semibold">
                  Fiche de {nomComplet(conducteur)}
                </h2>
                <p className="text-label text-secondary">
                  Seuls les champs manquants sont demandés&nbsp;: le reste de sa fiche ne change pas.{" "}
                  <Link href={`/flotte/conducteurs/${conducteur.id}`}>Ouvrir sa fiche</Link>
                </p>
              </div>
              <FormulaireConducteur
                action={completerConducteur.bind(null, conducteur.id, manquants.conducteur)}
                valeurs={valeursConducteur(conducteur)}
                champs={manquants.conducteur}
              />
            </section>
          )}

          {manquants.entreprise.length > 0 && (
            <section aria-labelledby="fiche-entreprise" className="grid gap-4">
              <div className="grid gap-1">
                <h2 id="fiche-entreprise" className="text-title-sm font-semibold">
                  Fiche entreprise
                </h2>
                <p className="text-label text-secondary">
                  Seuls les champs manquants sont demandés&nbsp;: le reste de la fiche ne change pas.{" "}
                  <Link href="/parametres/entreprise">Ouvrir la fiche entreprise</Link>
                </p>
              </div>
              <FormulaireEntreprise
                action={completerEntreprise.bind(null, manquants.entreprise)}
                valeurs={valeursEntreprise(entreprise)}
                champs={manquants.entreprise}
              />
            </section>
          )}
        </>
      );
    }

    // Désigné, le récap reste consultable pour mémoire : la date du clic remplace la consigne.
    const designeLe = avis.statut === "designe" ? avis.designe_le : null;
    return (
      <>
        {designeLe && <Alerte variante="succes">Désigné le {formaterDateAHeure(designeLe)}.</Alerte>}
        <div className="grid justify-items-start gap-3">
          {!designeLe && (
            <p className="text-secondary">
              Recopiez chaque champ sur le site de l&apos;ANTAI, puis revenez ici marquer l&apos;avis comme désigné.
            </p>
          )}
          <a
            href={URL_ANTAI}
            target="_blank"
            rel="noopener noreferrer"
            className={classesBouton({ variante: "secondaire" })}
          >
            <ExternalLink size={16} strokeWidth={1.5} aria-hidden />
            Ouvrir le site de l&apos;ANTAI
          </a>
        </div>

        <RecapAntai blocs={contenuRecap({ avis, entreprise, conducteur })} />

        {!designeLe && (
          <Bloc
            titre="Désignation"
            description="Désigno ne transmet rien à l'ANTAI&nbsp;: une fois la désignation faite sur son site, l'avis passe « Désigné » et ses alertes s'arrêtent."
          >
            <DesignationAntai action={marquerDesigne.bind(null, avis.id)} />
          </Bloc>
        )}
      </>
    );
  };

  return (
    <div className="grid max-w-recap gap-6">
      <Link href={`/avis/${avis.id}`} className="inline-flex items-center gap-1.5 justify-self-start text-label">
        <ArrowLeft size={16} strokeWidth={1.5} aria-hidden />
        Avis
      </Link>

      <header className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-title font-bold">
          Récap ANTAI
          {avis.numero && (
            <>
              {" "}
              · avis n° <span className="font-mono font-medium tracking-normal">{avis.numero}</span>
            </>
          )}
        </h1>
        <StatutAvis statut={avis.statut} />
      </header>

      {contenu()}
    </div>
  );
}
