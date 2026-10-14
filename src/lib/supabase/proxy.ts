import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { borneCookieSession } from "./cookies";

/**
 * Rafraîchit la session à chaque requête et renvoie les claims vérifiés.
 * Les cookies rafraîchis sont posés sur `reponse()`, à recopier sur toute redirection.
 */
export async function updateSession(request: NextRequest) {
  let reponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          reponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            reponse.cookies.set(name, value, borneCookieSession(options)),
          );
          Object.entries(headers ?? {}).forEach(([cle, valeur]) => reponse.headers.set(cle, valeur));
        },
      },
    },
  );

  // Ne rien exécuter entre createServerClient et getClaims : la session doit être lue d'abord.
  const { data } = await supabase.auth.getClaims();

  return { supabase, claims: data?.claims ?? null, reponse: () => reponse };
}

/** Redirige en conservant les cookies et en-têtes posés par updateSession. */
export function redirigerAvecSession(url: URL, depuis: NextResponse) {
  const redirection = NextResponse.redirect(url);
  depuis.cookies.getAll().forEach((cookie) => redirection.cookies.set(cookie));
  const cacheControl = depuis.headers.get("Cache-Control");
  if (cacheControl) redirection.headers.set("Cache-Control", cacheControl);
  return redirection;
}
