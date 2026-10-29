import {
  CalendarRange,
  Camera,
  CreditCard,
  FileChartColumn,
  FileText,
  LayoutDashboard,
  Plug,
  Settings,
  Truck,
  Users,
} from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BandeauPersistant } from "@/components/BandeauPersistant";
import { CompteurUsage } from "@/components/CompteurUsage";
import { Logo } from "@/components/Logo";
import { classesBouton } from "@/components/ui/Bouton";
import type { Plan } from "@/lib/abonnement/plans";
import { choixVehiculesRequis, lireUsage } from "@/lib/abonnement/quotas";
import { limiteImpaye, type StatutAbonnement } from "@/lib/abonnement/regles";
import { depuisIso } from "@/lib/dates";
import { lireConnexionGmail } from "@/lib/gmail/connexion";
import { MESSAGES_GMAIL } from "@/lib/gmail/regles";
import { createClient } from "@/lib/supabase/server";
import { MenuCompte } from "./MenuCompte";
import { MettreAJourCarte } from "./MettreAJourCarte";
import { NavItem } from "./NavItem";
import { ReconnecterGmail } from "./ReconnecterGmail";

/** Les écrans qui restent ouverts tant que le choix des 3 véhicules actifs attend (retour en Free). */
const ECRANS_SANS_CHOIX = ["/parametres/abonnement", "/parametres/compte"];

type Entreprise = {
  raison_sociale: string | null;
  plan: Plan;
  abonnement_statut: StatutAbonnement | null;
  paiement_echoue_le: string | null;
};

export default async function LayoutApp({ children }: LayoutProps<"/">) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/connexion");
  const email = typeof data.claims.email === "string" ? data.claims.email : "";

  // De simples libellés : si une lecture échoue, la barre haute invite à renseigner l'entreprise, ou tait le compteur
  // d'usage ou le bandeau de Gmail, plutôt que de casser l'écran.
  const [{ data: entreprise }, usage, entetes, { data: gmail }] = await Promise.all([
    supabase
      .from("entreprise")
      .select("raison_sociale, plan, abonnement_statut, paiement_echoue_le")
      .maybeSingle<Entreprise>(),
    lireUsage(supabase).catch((erreur: unknown) => {
      console.error("usage", erreur);
      return null;
    }),
    headers(),
    lireConnexionGmail(supabase),
  ]);
  const raisonSociale = entreprise?.raison_sociale ?? null;

  // Au retour en Free, tant qu'aucun véhicule n'est actif : chaque écran mène au choix des 3 véhicules actifs, sauf
  // l'écran Abonnement, d'où l'on repasse en Pro, et l'écran Compte : le droit à l'effacement n'attend pas ce choix. Un
  // layout n'est pas réexécuté à chaque navigation côté client : la base garantit de toute façon la lecture seule.
  // `x-chemin` vient du proxy.
  if (
    entreprise &&
    usage &&
    choixVehiculesRequis({ plan: entreprise.plan, ...usage }) &&
    !ECRANS_SANS_CHOIX.includes(entetes.get("x-chemin") ?? "")
  ) {
    redirect("/flotte/vehicules-actifs");
  }
  const limite =
    entreprise?.abonnement_statut === "past_due" && entreprise.paiement_echoue_le
      ? depuisIso(limiteImpaye(entreprise.paiement_echoue_le))
      : null;

  return (
    <div className="grid min-h-screen md:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="flex flex-col gap-1 border-r border-line bg-surface px-3 pb-4 max-md:hidden">
        <div className="flex h-14 items-center px-2">
          <Logo />
        </div>
        <Link href="/avis/nouveau" className={`mt-2 ${classesBouton({ pleineLargeur: true })}`}>
          Déposer un avis
        </Link>
        <nav aria-label="Navigation principale" className="mt-3 grid gap-1">
          <NavItem
            href="/tableau-de-bord"
            icone={<LayoutDashboard size={16} strokeWidth={1.5} aria-hidden className="flex-none" />}
          >
            Tableau de bord
          </NavItem>
          <NavItem href="/avis" icone={<FileText size={16} strokeWidth={1.5} aria-hidden className="flex-none" />}>
            Avis
          </NavItem>
          <NavItem
            href="/flotte/vehicules"
            icone={<Truck size={16} strokeWidth={1.5} aria-hidden className="flex-none" />}
          >
            Véhicules
          </NavItem>
          <NavItem
            href="/flotte/conducteurs"
            icone={<Users size={16} strokeWidth={1.5} aria-hidden className="flex-none" />}
          >
            Conducteurs
          </NavItem>
          <NavItem
            href="/flotte/planning"
            icone={<CalendarRange size={16} strokeWidth={1.5} aria-hidden className="flex-none" />}
          >
            Planning
          </NavItem>
          {/* Visible en Free aussi : l'écran montre alors le cadenas Pro. */}
          <NavItem
            href="/rapports"
            icone={<FileChartColumn size={16} strokeWidth={1.5} aria-hidden className="flex-none" />}
          >
            Rapports
          </NavItem>
        </nav>
        <nav aria-label="Réglages" className="mt-auto grid gap-1">
          <NavItem
            href="/parametres/abonnement"
            icone={<CreditCard size={16} strokeWidth={1.5} aria-hidden className="flex-none" />}
          >
            Abonnement
          </NavItem>
          <NavItem
            href="/parametres/integrations"
            icone={<Plug size={16} strokeWidth={1.5} aria-hidden className="flex-none" />}
          >
            Intégrations
          </NavItem>
          <NavItem
            href="/parametres/entreprise"
            icone={<Settings size={16} strokeWidth={1.5} aria-hidden className="flex-none" />}
          >
            Paramètres
          </NavItem>
        </nav>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="flex h-14 items-center justify-between gap-3 border-b border-line pr-6 pl-8 max-md:px-4">
          {raisonSociale ? (
            <Link
              href="/parametres/entreprise"
              className="-ml-3 flex h-8 min-w-0 items-center rounded-full px-3 font-medium no-underline transition-colors duration-120 ease-enter hover:bg-[rgb(0_0_0/0.05)] max-md:hidden"
            >
              <span className="truncate">{raisonSociale}</span>
            </Link>
          ) : (
            <Link href="/parametres/entreprise" className="truncate text-label max-md:hidden">
              Renseigner votre entreprise
            </Link>
          )}
          <span className="md:hidden">
            <Logo />
          </span>
          <div className="flex items-center gap-2">
            {/* Sur téléphone, le dépôt d'un avis est à un geste : l'appareil photo s'ouvre depuis l'écran de dépôt. */}
            <Link href="/avis/nouveau" className={`${classesBouton({ taille: "tactile" })} md:hidden`}>
              <Camera size={20} strokeWidth={1.5} aria-hidden />
              Déposer
            </Link>
            {/* Sur téléphone, la barre haute n'a que le logo, « Déposer » et l'avatar : le compteur est sur l'écran de dépôt. */}
            {entreprise && usage && (
              <span className="max-md:hidden">
                <CompteurUsage plan={entreprise.plan} usage={usage} />
              </span>
            )}
            <MenuCompte email={email} />
          </div>
        </header>
        {entreprise?.abonnement_statut === "past_due" && (
          <BandeauPersistant action={<MettreAJourCarte />}>
            Le paiement de votre abonnement Pro a échoué.{" "}
            {limite
              ? `Mettez à jour votre carte d'ici le ${limite} : sinon, votre compte repassera en Free, sans perte de données.`
              : "Mettez à jour votre carte : sinon, votre compte repassera en Free, sans perte de données."}
          </BandeauPersistant>
        )}
        {/* En Free, la relève est en pause : le bandeau attend le retour en Pro. */}
        {entreprise?.plan === "pro" && gmail?.interrompue_le && (
          <BandeauPersistant action={<ReconnecterGmail />}>{MESSAGES_GMAIL.bandeau(gmail.libelle_nom)}</BandeauPersistant>
        )}
        <main className="w-full max-w-content p-8 max-md:px-4 max-md:py-5">{children}</main>
      </div>
    </div>
  );
}
