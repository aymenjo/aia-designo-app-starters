import { timingSafeEqual } from "node:crypto";

// Les tâches planifiées de Vercel (`vercel.json`) appellent les routes /api/cron/* sans session. Vercel envoie
// `Authorization: Bearer $CRON_SECRET` : seul cet en-tête les autorise. Sans secret configuré, tout est refusé.

export function cronAutorise(requete: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const attendu = Buffer.from(`Bearer ${secret}`);
  const recu = Buffer.from(requete.headers.get("authorization") ?? "");
  return recu.length === attendu.length && timingSafeEqual(recu, attendu);
}

/**
 * L'adresse du site dans les liens d'un email : l'adresse de production que Vercel fournit (elle suivra le domaine),
 * sinon l'hôte appelé (en local et en E2E). `requete.url` ne suffit pas : `next dev` y met son nom d'hôte
 * (`localhost`), alors que la session du navigateur est sur l'hôte appelé (`127.0.0.1`).
 */
export function urlSite(requete: Request): string {
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (production) return `https://${production}`;
  const url = new URL(requete.url);
  const hote = requete.headers.get("host");
  return hote ? `${url.protocol}//${hote}` : url.origin;
}
