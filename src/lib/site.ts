// L'adresse du site, dans les liens d'un email (tâches planifiées, webhook) et les retours de Stripe (Checkout, portail).

const production = () => process.env.VERCEL_PROJECT_PRODUCTION_URL;

/**
 * L'adresse de production que Vercel fournit (elle suivra le domaine), sinon l'hôte appelé (en local et en E2E).
 * `requete.url` ne suffit pas : `next dev` y met son nom d'hôte (`localhost`), alors que la session du navigateur est sur
 * l'hôte appelé (`127.0.0.1`).
 */
export function urlSite(requete: Request): string {
  if (production()) return `https://${production()}`;
  const url = new URL(requete.url);
  const hote = requete.headers.get("host");
  return hote ? `${url.protocol}//${hote}` : url.origin;
}

/** La même adresse, depuis une server action, qui n'a que les en-têtes de la requête (`await headers()`). */
export function urlSiteDepuisEntetes(entetes: Headers): string {
  if (production()) return `https://${production()}`;
  const hote = entetes.get("host");
  if (!hote) throw new Error("adresse du site : aucun en-tête host");
  return `${entetes.get("x-forwarded-proto") ?? "http"}://${hote}`;
}
