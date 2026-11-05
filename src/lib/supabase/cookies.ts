import type { CookieOptions } from "@supabase/ssr";
import { DUREE_SESSION_S } from "@/lib/auth/regles";

/**
 * @supabase/ssr impose 400 jours aux cookies de session : on les ramène à 30.
 * Les suppressions (maxAge 0) restent inchangées. La limite absolue des 30 jours
 * après connexion est vérifiée par le proxy.
 */
export function borneCookieSession(options: CookieOptions): CookieOptions {
  return options.maxAge ? { ...options, maxAge: DUREE_SESSION_S } : options;
}
