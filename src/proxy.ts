import type { NextRequest } from "next/server";
import { PAGE_APRES_CONNEXION, connexionExpiree } from "@/lib/auth/regles";
import { redirigerAvecSession, updateSession } from "@/lib/supabase/proxy";

// La landing (`/`) et la connexion. Avec une session, l'une et l'autre mènent au tableau de bord.
function estPublique(chemin: string) {
  return chemin === "/" || chemin === "/connexion" || chemin.startsWith("/connexion/");
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  // Le chemin demandé, pour le layout de l'application : il mène au choix des véhicules actifs, sauf depuis l'écran
  // Abonnement. Posé avant `updateSession`, qui transmet les en-têtes de la requête ; un en-tête du client est écrasé.
  request.headers.set("x-chemin", pathname);
  const { supabase, claims, reponse } = await updateSession(request);

  if (claims && connexionExpiree(claims.amr)) {
    await supabase.auth.signOut({ scope: "local" });
    return redirigerAvecSession(new URL("/connexion?expiree=1", request.url), reponse());
  }

  if (!claims && !estPublique(pathname)) {
    const url = new URL("/connexion", request.url);
    if (pathname !== PAGE_APRES_CONNEXION) {
      url.searchParams.set("suivant", `${pathname}${search}`);
    }
    return redirigerAvecSession(url, reponse());
  }

  if (claims && (pathname === "/connexion" || pathname === "/")) {
    return redirigerAvecSession(new URL(PAGE_APRES_CONNEXION, request.url), reponse());
  }

  return reponse();
}

export const config = {
  // Les tâches planifiées (/api/cron/*) et les webhooks (/api/webhooks/*) n'ont pas de session : CRON_SECRET
  // (src/lib/cron.ts) ou la signature de l'expéditeur les authentifie. Sinon, le proxy les redirigerait vers /connexion.
  matcher: ["/((?!api/cron/|api/webhooks/|_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
