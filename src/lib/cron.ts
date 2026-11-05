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
