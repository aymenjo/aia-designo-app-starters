import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { MenuCompte } from "@/app/(app)/MenuCompte";
import { createClient } from "@/lib/supabase/server";

// Le choix des véhicules actifs (phase 19) : une étape plein écran, hors du shell de l'application, sans barre latérale.
// Tant qu'aucun véhicule n'est actif, les autres écrans y mènent : un menu n'y mènerait nulle part (DESIGN.md).
export default async function LayoutEtape({ children }: LayoutProps<"/flotte/vehicules-actifs">) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/connexion");
  const email = typeof data.claims.email === "string" ? data.claims.email : "";

  return (
    <div className="min-h-screen">
      <header className="flex h-14 items-center justify-between gap-3 border-b border-line px-8 max-md:px-4">
        <Logo />
        <MenuCompte email={email} />
      </header>
      <main className="mx-auto w-full max-w-recap px-8 py-10 max-md:px-4 max-md:py-6">{children}</main>
    </div>
  );
}
