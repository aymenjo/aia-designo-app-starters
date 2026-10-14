import { CalendarRange, LayoutDashboard, Settings, Truck, Users } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { createClient } from "@/lib/supabase/server";
import { MenuCompte } from "./MenuCompte";
import { NavItem } from "./NavItem";

export default async function LayoutApp({ children }: LayoutProps<"/">) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/connexion");
  const email = typeof data.claims.email === "string" ? data.claims.email : "";

  // Un simple libellé : si la lecture échoue, la barre haute invite à renseigner l'entreprise plutôt que de casser l'écran.
  const { data: entreprise } = await supabase.from("entreprise").select("raison_sociale").maybeSingle();
  const raisonSociale: string | null = entreprise?.raison_sociale ?? null;

  return (
    <div className="grid min-h-screen md:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="flex flex-col gap-1 border-r border-line bg-surface px-3 pb-4 max-md:hidden">
        <div className="flex h-14 items-center px-2">
          <Logo />
        </div>
        <nav aria-label="Navigation principale" className="mt-2 grid gap-1">
          <NavItem
            href="/tableau-de-bord"
            icone={<LayoutDashboard size={16} strokeWidth={1.5} aria-hidden className="flex-none" />}
          >
            Tableau de bord
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
        </nav>
        <nav aria-label="Réglages" className="mt-auto grid gap-1">
          <NavItem
            href="/parametres/entreprise"
            section="/parametres"
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
          <MenuCompte email={email} />
        </header>
        <main className="w-full max-w-content p-8 max-md:px-4 max-md:py-5">{children}</main>
      </div>
    </div>
  );
}
