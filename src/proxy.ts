import type { NextRequest } from "next/server";
import { PAGE_APRES_CONNEXION, connexionExpiree } from "@/lib/auth/regles";
import { redirigerAvecSession, updateSession } from "@/lib/supabase/proxy";

function estPublique(chemin: string) {
  return chemin === "/connexion" || chemin.startsWith("/connexion/");
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const { supabase, claims, reponse } = await updateSession(request);

  if (claims && connexionExpiree(claims.amr)) {
    await supabase.auth.signOut({ scope: "local" });
    return redirigerAvecSession(new URL("/connexion?expiree=1", request.url), reponse());
  }

  if (!claims && !estPublique(pathname)) {
    const url = new URL("/connexion", request.url);
    if (pathname !== "/" && pathname !== PAGE_APRES_CONNEXION) {
      url.searchParams.set("suivant", `${pathname}${search}`);
    }
    return redirigerAvecSession(url, reponse());
  }

  if (claims && pathname === "/connexion") {
    return redirigerAvecSession(new URL(PAGE_APRES_CONNEXION, request.url), reponse());
  }

  return reponse();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
