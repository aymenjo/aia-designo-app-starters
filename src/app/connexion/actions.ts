"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  COOKIE_EMAIL,
  COOKIE_SUIVANT,
  DUREE_COOKIES_DEMANDE_S,
  MESSAGES,
  cheminSuivantSur,
  masquerEmail,
  schemaEmail,
} from "@/lib/auth/regles";
import { createClient } from "@/lib/supabase/server";

export type EtatDemande = {
  /** Adresse à laquelle le dernier lien est parti : affiche « Vérifiez votre boîte mail ». */
  envoyeA?: string;
  email?: string;
  erreurEmail?: string;
  erreur?: string;
};

const optionsCookie = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: DUREE_COOKIES_DEMANDE_S,
} as const;

/**
 * Inscription et connexion ne font qu'un : le message est le même que le compte existe ou non.
 * Sans champ email (renvoi en un clic), l'adresse vient du cookie posé à la demande précédente.
 */
export async function demanderLien(etat: EtatDemande, formData: FormData): Promise<EtatDemande> {
  const cookieStore = await cookies();
  const saisie = formData.get("email");
  const depuisCookie = saisie === null;
  const brut = depuisCookie ? (cookieStore.get(COOKIE_EMAIL)?.value ?? "") : String(saisie);

  const resultat = schemaEmail.safeParse(brut);
  if (!resultat.success) {
    return { email: depuisCookie ? "" : brut, erreurEmail: resultat.error.issues[0].message };
  }
  const email = resultat.data;

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });
  if (error) {
    console.error("signInWithOtp", error.status, error.code, error.message);
    const erreur = error.status === 429 ? MESSAGES.tropDeDemandes : MESSAGES.envoiImpossible;
    return { envoyeA: etat.envoyeA, email, erreur };
  }

  cookieStore.set(COOKIE_EMAIL, email, optionsCookie);
  const suivant = formData.get("suivant");
  if (typeof suivant === "string") {
    if (suivant) cookieStore.set(COOKIE_SUIVANT, cheminSuivantSur(suivant), optionsCookie);
    else cookieStore.delete(COOKIE_SUIVANT);
  }

  return { envoyeA: depuisCookie ? (etat.envoyeA ?? masquerEmail(email)) : email };
}

/** Le POST consomme le lien : un scanner de messagerie qui suit le lien (GET) ne le grille pas. */
export async function confirmerConnexion(formData: FormData) {
  const tokenHash = formData.get("token_hash");
  if (typeof tokenHash !== "string" || !tokenHash) redirect("/connexion/lien-invalide");

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type: "email", token_hash: tokenHash });
  if (error) redirect("/connexion/lien-invalide");

  const cookieStore = await cookies();
  const suivant = cookieStore.get(COOKIE_SUIVANT)?.value;
  cookieStore.delete(COOKIE_SUIVANT);
  redirect(cheminSuivantSur(suivant));
}
