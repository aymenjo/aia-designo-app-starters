import type { Metadata } from "next";
import { Alerte } from "@/components/ui/Alerte";
import { MESSAGES } from "@/lib/auth/regles";
import { FormulaireLien } from "./FormulaireLien";

export const metadata: Metadata = { title: "Connexion" };

export default async function PageConnexion({ searchParams }: PageProps<"/connexion">) {
  const { expiree, suivant } = await searchParams;

  return (
    <FormulaireLien
      entete={
        <>
          <div className="grid gap-2">
            <h1 className="font-display text-title font-bold">Connexion</h1>
            <p className="text-secondary">
              Saisissez votre adresse email : vous recevrez un lien pour vous connecter, sans mot de passe. Votre
              espace est créé à la première connexion.
            </p>
          </div>
          {expiree === "1" && <Alerte>{MESSAGES.sessionExpiree}</Alerte>}
        </>
      }
      libelleBouton="Recevoir mon lien"
      suivant={typeof suivant === "string" ? suivant : ""}
    />
  );
}
