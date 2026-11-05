import { Check } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/Logo";
import { classesBouton } from "@/components/ui/Bouton";
import { PRIX_PRO_HT_CENTIMES } from "@/lib/abonnement/plans";
import { AMENDE_NON_DESIGNATION_CENTIMES } from "@/lib/avis/echeance";
import { formaterEuros } from "@/lib/format";
import { ApercuProduit } from "./ApercuProduit";
import { Etapes } from "./Etapes";
import { Faq } from "./Faq";
import { Tarifs } from "./Tarifs";

// Sans API dynamique : la landing est prérendue en statique. Avec une session, le proxy mène au tableau de bord.

export const metadata: Metadata = {
  title: { absolute: "Désigno · Ne laissez plus jamais filer une échéance de désignation" },
};

const AMENDE = formaterEuros(AMENDE_NON_DESIGNATION_CENTIMES);

const ANCRES = [
  { href: "#fonctionnement", libelle: "Fonctionnement" },
  { href: "#tarifs", libelle: "Tarifs" },
  { href: "#faq", libelle: "FAQ" },
];

// « J-2 » ne se coupe jamais au trait d'union.
const BENEFICES: ReactNode[] = [
  <>
    L&apos;échéance des 45 jours calculée pour chaque avis, avec des alertes à{" "}
    <span className="whitespace-nowrap">J-15, J-7 et J-2</span>.
  </>,
  "Le conducteur proposé d'après votre planning : vous validez, rien n'est automatique.",
  "Un récap prêt à copier, champ par champ, sur le site de l'ANTAI.",
];

const CONTENEUR = "mx-auto w-full max-w-content px-8 max-md:px-4";
// Sans point final ni virgule : en Plus Jakarta Sans 800, ils sont plus larges qu'une espace et se détachent du mot.
const TITRE_SECTION = "font-display text-display font-extrabold max-md:text-stat";

// Le CTA du hero et de la fin de page, pleine largeur sur téléphone.
const ESSAYER = (
  <Link href="/connexion" className={`${classesBouton({ taille: "lg" })} max-md:w-full`}>
    Essayer gratuitement
  </Link>
);

/** L'en-tête d'une section : libellé méta, titre et chapeau facultatif. */
function EnteteSection({ meta, titre, children }: { meta: string; titre: string; children?: ReactNode }) {
  return (
    <div className="grid max-w-[760px] content-start gap-4">
      <p className="font-mono text-meta font-medium text-secondary uppercase">{meta}</p>
      <h2 className={TITRE_SECTION}>{titre}</h2>
      {children && <p className="text-lead text-secondary">{children}</p>}
    </div>
  );
}

export default function Landing() {
  return (
    <>
      <header className="border-b border-line">
        <div className={`${CONTENEUR} flex h-14 items-center gap-6`}>
          <Logo href="/" />
          <nav aria-label="Sections" className="flex items-center gap-1 max-md:hidden">
            {ANCRES.map(({ href, libelle }) => (
              <a
                key={href}
                href={href}
                className="flex h-8 items-center rounded-full px-3 text-label font-medium text-secondary no-underline transition-colors duration-120 ease-enter hover:bg-[rgb(0_0_0/0.04)] hover:text-ink"
              >
                {libelle}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/connexion" className={`${classesBouton({ variante: "ghost" })} max-md:h-11`}>
              Se connecter
            </Link>
            <Link href="/connexion" className={`${classesBouton()} max-md:hidden`}>
              Essayer gratuitement
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className={`${CONTENEUR} grid items-center gap-12 py-20 max-md:gap-10 max-md:pt-10 max-md:pb-12 lg:grid-cols-[1.1fr_1fr]`}>
          <div className="grid justify-items-start gap-6">
            <p className="font-mono text-meta font-medium text-secondary uppercase">
              Avis de contravention · Véhicules d&apos;entreprise
            </p>
            <h1 className="font-display text-hero font-extrabold max-md:text-[40px]">
              Ne laissez plus jamais filer une échéance de désignation
            </h1>
            <p className="max-w-[540px] text-title-sm leading-[1.45] text-secondary max-md:text-lead">
              Désigno lit vos avis de contravention, retrouve le conducteur d&apos;après votre planning et prépare
              le récap à reporter sur le site de l&apos;ANTAI.{" "}
              <strong className="font-semibold text-ink">Plus d&apos;amende de {AMENDE} pour un avis oublié.</strong>
            </p>
            <ul className="grid gap-2.5">
              {BENEFICES.map((benefice, i) => (
                <li key={i} className="flex gap-2.5">
                  <Check size={16} strokeWidth={1.5} aria-hidden className="mt-0.5 flex-none" />
                  <span>{benefice}</span>
                </li>
              ))}
            </ul>
            <div className="grid gap-3 max-md:w-full">
              {ESSAYER}
              <p className="text-label text-secondary">Plan Free, sans carte bancaire&nbsp;: votre email suffit.</p>
            </div>
          </div>
          <ApercuProduit />
        </section>

        <section id="fonctionnement" className="bg-band">
          <div className={`${CONTENEUR} grid gap-12 py-20 max-md:gap-8 max-md:py-12`}>
            <EnteteSection meta="Fonctionnement" titre="Quatre étapes pour ne plus rien laisser filer">
              Décrivez votre flotte une fois, à la main ou par un import CSV&nbsp;: véhicules, conducteurs, et qui
              conduit quoi et quand. Ensuite, chaque avis ne vous prend que quelques minutes.
            </EnteteSection>
            <Etapes />
          </div>
        </section>

        <section id="tarifs">
          <div className={`${CONTENEUR} grid gap-12 py-20 max-md:gap-8 max-md:py-12`}>
            <EnteteSection meta="Tarifs" titre="Une seule amende évitée paie plus d'un an d'abonnement">
              {AMENDE} d&apos;amende pour non-désignation, contre {formaterEuros(12 * PRIX_PRO_HT_CENTIMES)} HT pour
              12 mois de Pro.
            </EnteteSection>
            <Tarifs />
          </div>
        </section>

        <section id="faq" className="bg-band">
          <div className={`${CONTENEUR} grid gap-12 py-20 max-md:gap-8 max-md:py-12 lg:grid-cols-[1fr_2fr]`}>
            <EnteteSection meta="FAQ" titre="Vos questions" />
            <Faq />
          </div>
        </section>

        <section>
          <div className={`${CONTENEUR} grid justify-items-center gap-6 py-20 text-center max-md:py-12`}>
            <h2 className={TITRE_SECTION}>
              Le prochain avis arrive peut-être demain
            </h2>
            <p className="max-w-[560px] text-lead text-secondary">
              Créez votre espace avec votre seule adresse email, et déposez votre premier avis en quelques minutes.
            </p>
            {ESSAYER}
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className={`${CONTENEUR} flex flex-wrap items-center gap-x-8 gap-y-4 py-8`}>
          <Logo href="/" />
          <p className="flex-1 text-label text-secondary max-md:basis-full">
            L&apos;échéance affichée est indicative&nbsp;: Désigno ne fait pas de conseil juridique et ne transmet
            rien à l&apos;ANTAI.
          </p>
          <Link href="/connexion" className="text-label">
            Se connecter
          </Link>
        </div>
      </footer>
    </>
  );
}
