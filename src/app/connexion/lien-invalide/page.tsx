import type { Metadata } from "next";
import { cookies } from "next/headers";
import { COOKIE_EMAIL, masquerEmail } from "@/lib/auth/regles";
import { FormulaireLien } from "../FormulaireLien";

export const metadata: Metadata = { title: "Lien invalide" };

export default async function PageLienInvalide() {
  const email = (await cookies()).get(COOKIE_EMAIL)?.value;

  return (
    <FormulaireLien
      entete={
        <div className="grid gap-2">
          <h1 className="font-display text-title font-bold">Ce lien a expiré ou a déjà servi</h1>
          <p className="text-secondary">
            Pour votre sécurité, un lien de connexion n&apos;est valable que 15 minutes, une seule fois.
          </p>
        </div>
      }
      libelleBouton="Recevoir un nouveau lien"
      renvoiA={email ? masquerEmail(email) : undefined}
    />
  );
}
