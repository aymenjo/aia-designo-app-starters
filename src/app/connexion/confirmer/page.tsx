import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { confirmerConnexion } from "../actions";

export const metadata: Metadata = { title: "Se connecter" };

// Le GET n'utilise pas le lien : seul le clic (POST) le consomme.
export default async function PageConfirmer({ searchParams }: PageProps<"/connexion/confirmer">) {
  const { token_hash: tokenHash } = await searchParams;
  if (typeof tokenHash !== "string" || !tokenHash) redirect("/connexion/lien-invalide");

  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        <h1 className="font-display text-title font-bold">Se connecter à Désigno</h1>
        <p className="text-secondary">Cliquez sur le bouton pour ouvrir votre espace.</p>
      </div>
      <form action={confirmerConnexion}>
        <input type="hidden" name="token_hash" value={tokenHash} />
        <BoutonEnvoi pleineLargeur enCours="Connexion…">
          Se connecter
        </BoutonEnvoi>
      </form>
    </div>
  );
}
