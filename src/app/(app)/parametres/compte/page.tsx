import type { Metadata } from "next";
import { Bloc } from "@/components/ui/Bloc";
import { abonnementTermine, type StatutAbonnement } from "@/lib/abonnement/regles";
import { texteConfirmation } from "@/lib/compte/regles";
import { lireConnexionGmail } from "@/lib/gmail/connexion";
import { createClient } from "@/lib/supabase/server";
import { SuppressionCompte } from "./SuppressionCompte";

export const metadata: Metadata = { title: "Compte" };

export default async function Compte() {
  const supabase = await createClient();
  const [session, entreprise, gmail] = await Promise.all([
    supabase.auth.getClaims(),
    supabase
      .from("entreprise")
      .select("raison_sociale, abonnement_statut")
      .single<{ raison_sociale: string | null; abonnement_statut: StatutAbonnement | null }>(),
    lireConnexionGmail(supabase),
  ]);
  if (entreprise.error) throw entreprise.error;
  if (gmail.error) throw gmail.error;
  const email = typeof session.data?.claims.email === "string" ? session.data.claims.email : "";
  const { raison_sociale, abonnement_statut } = entreprise.data;

  return (
    <div className="grid max-w-[720px] gap-6">
      <header className="grid gap-1">
        <h1 className="font-display text-title font-bold">Compte</h1>
        <p className="text-secondary">Votre adresse de connexion, et la suppression de votre compte.</p>
      </header>

      <Bloc titre="Adresse de connexion" description="Vos liens de connexion et vos alertes arrivent à cette adresse.">
        <p className="font-medium break-all">{email}</p>
      </Bloc>

      <section className="flex flex-wrap items-center justify-between gap-4 rounded-card border border-line p-6 max-md:p-5">
        <div className="grid gap-1">
          <h2 className="font-semibold">Supprimer le compte</h2>
          <p className="text-label text-secondary">
            Toutes les données de votre entreprise seront effacées définitivement.
          </p>
        </div>
        <SuppressionCompte
          attendu={texteConfirmation({ raisonSociale: raison_sociale, email })}
          abonnement={abonnement_statut !== null && !abonnementTermine(abonnement_statut)}
          gmail={gmail.data !== null}
        />
      </section>
    </div>
  );
}
