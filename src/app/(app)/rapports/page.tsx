import { Download, FileText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CadenasPro } from "@/components/CadenasPro";
import { classesBouton } from "@/components/ui/Bouton";
import { FONCTIONS_PRO, type Plan } from "@/lib/abonnement/plans";
import { aujourdhuiParis, depuisIso } from "@/lib/dates";
import { formaterDateAHeure } from "@/lib/format";
import { etatEnvoi, listerRapports, prochainRapportLe, type RapportMensuel } from "@/lib/rapport/liste";
import { libelleMois } from "@/lib/rapport/synthese";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Rapports" };

const RAPPORT_MENSUEL = FONCTIONS_PRO.find(({ nom }) => nom === "Rapport mensuel")!;

const COLONNES =
  "grid grid-cols-[160px_minmax(0,1fr)_auto] items-center gap-3 px-4 max-md:grid-cols-[minmax(0,1fr)_auto] max-md:py-3";

type Entreprise = { plan: Plan; created_at: string; emails_direction: string[] };

/** « octobre 2026 » → « Octobre 2026 », en tête de ligne. */
const enTete = (mois: string) => {
  const libelle = libelleMois(mois);
  return libelle.charAt(0).toUpperCase() + libelle.slice(1);
};

function Envoi({ rapport, aujourdhui }: { rapport: RapportMensuel; aujourdhui: string }) {
  switch (etatEnvoi(rapport, aujourdhui)) {
    case "envoye":
      return (
        <span className="grid min-w-0">
          <span>Envoyé le {formaterDateAHeure(rapport.envoye_le!)}</span>
          <span className="truncate text-label text-secondary">{rapport.envoye_a?.join(", ")}</span>
        </span>
      );
    case "en_attente":
      return <span className="text-secondary">Envoi en attente&nbsp;: Désigno le retente chaque matin.</span>;
    case "non_envoye":
      return <span className="text-secondary">Non envoyé</span>;
  }
}

/** Le prochain envoi, et à qui : la direction avec le gestionnaire en copie, ou le gestionnaire seul. */
function ProchainEnvoi({ le, emails }: { le: string; emails: string[] }) {
  if (!emails.length) {
    return (
      <p className="text-secondary">
        Prochain rapport le {depuisIso(le)}, au gestionnaire seul. Ajoutez les adresses de la direction dans la{" "}
        <Link href="/parametres/entreprise">fiche entreprise</Link>&nbsp;: elles le recevront, avec vous en copie.
      </p>
    );
  }
  return (
    <p className="text-secondary">
      Prochain rapport le {depuisIso(le)}, à <span className="text-ink">{emails.join(", ")}</span>, avec vous en copie.{" "}
      <Link href="/parametres/entreprise">Modifier les adresses</Link>
    </p>
  );
}

export default async function Rapports() {
  const supabase = await createClient();
  const entreprise = await supabase
    .from("entreprise")
    .select("plan, created_at, emails_direction")
    .single<Entreprise>();
  if (entreprise.error) throw entreprise.error;
  const { plan, created_at: creeeLe, emails_direction: emails } = entreprise.data;

  const titre = (
    <header className="grid gap-1">
      <h1 className="font-display text-title font-bold">Rapports</h1>
      <p className="max-w-[720px] text-secondary">
        Le 1er de chaque mois, le bilan de la flotte du mois écoulé, en PDF&nbsp;: avis reçus, désignés et classés,
        échéances dépassées, amendes évitées, véhicules et conducteurs les plus verbalisés, fiches incomplètes.
      </p>
    </header>
  );

  // Au retour en Free, plus aucun rapport ne part ni ne se télécharge ; les rapports archivés restent, sans être montrés.
  if (plan !== "pro") {
    return (
      <div className="grid max-w-[720px] gap-6">
        {titre}
        <CadenasPro fonction={RAPPORT_MENSUEL.nom}>
          <p>{RAPPORT_MENSUEL.explication}</p>
        </CadenasPro>
      </div>
    );
  }

  const rapports = await listerRapports(supabase);
  const aujourdhui = aujourdhuiParis();
  const prochain = prochainRapportLe({ entrepriseCreeeLe: creeeLe, rapports, aujourdhui });

  return (
    <div className="grid gap-6">
      {titre}
      <ProchainEnvoi le={prochain} emails={emails} />

      {!rapports.length ? (
        <section className="grid justify-items-start gap-2 rounded-card border border-line p-6">
          <FileText size={20} strokeWidth={1.5} aria-hidden className="text-secondary" />
          <p>Votre premier rapport arrivera le {depuisIso(prochain)}.</p>
        </section>
      ) : (
        <div className="rounded-card border border-line">
          <div
            aria-hidden
            className={`${COLONNES} h-8 border-b border-line bg-surface font-mono text-meta font-medium text-secondary uppercase max-md:hidden`}
          >
            <span>Mois</span>
            <span>Envoi</span>
            <span className="sr-only">Télécharger</span>
          </div>
          <ul className="divide-y divide-line">
            {rapports.map((rapport) => (
              <li key={rapport.mois} className={`${COLONNES} min-h-13 py-2`}>
                <span className="font-medium">{enTete(rapport.mois)}</span>
                <span className="max-md:col-span-full max-md:row-start-2">
                  <Envoi rapport={rapport} aujourdhui={aujourdhui} />
                </span>
                <a
                  href={`/rapports/${rapport.mois.slice(0, 7)}`}
                  download
                  aria-label={`Télécharger le rapport de ${libelleMois(rapport.mois)}`}
                  className={classesBouton({ variante: "secondaire", taille: "sm" })}
                >
                  <Download size={16} strokeWidth={1.5} aria-hidden />
                  Télécharger
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
