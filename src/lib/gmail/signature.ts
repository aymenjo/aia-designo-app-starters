import { createHmac, timingSafeEqual } from "node:crypto";

// La signature des webhooks de Composio (phase 23), vérifiée sur le corps brut, sans le SDK : il exige une clé d'API et
// ne connaît que les événements de déclencheur. L'algorithme est celui de `triggers.verifyWebhook` (@composio/core).

/** L'écart toléré entre l'horodatage signé et la réception : celui du SDK de Composio. */
export const TOLERANCE_SIGNATURE_S = 300;

/**
 * La signature de Composio (Standard Webhooks) : `v1,<base64>` dans `webhook-signature`, l'HMAC-SHA256, par le secret tel
 * quel, de `${webhook-id}.${webhook-timestamp}.${corps}`. L'horodatage, en secondes, doit être récent.
 */
export function verifierSignature({
  corps,
  entetes,
  secret,
  maintenant = Date.now(),
}: {
  corps: string;
  entetes: Headers;
  secret: string;
  maintenant?: number;
}): boolean {
  const id = entetes.get("webhook-id");
  const horodatage = entetes.get("webhook-timestamp");
  const signatures = entetes.get("webhook-signature");
  if (!id || !horodatage || !signatures || !secret || !/^\d+$/.test(horodatage)) return false;
  if (Math.abs(maintenant - Number(horodatage) * 1000) > TOLERANCE_SIGNATURE_S * 1000) return false;

  const attendue = createHmac("sha256", secret).update(`${id}.${horodatage}.${corps}`).digest();
  return signatures.split(" ").some((signature) => {
    const [version, valeur] = signature.split(",");
    if (version !== "v1" || !valeur) return false;
    const recue = Buffer.from(valeur, "base64");
    return recue.length === attendue.length && timingSafeEqual(recue, attendue);
  });
}

/** Signe un corps comme Composio : les tests et les E2E envoient ainsi leurs événements simulés. */
export function signerCorps(corps: string, secret: string, maintenant = Date.now()) {
  const id = `msg_${crypto.randomUUID()}`;
  const horodatage = String(Math.floor(maintenant / 1000));
  const signature = createHmac("sha256", secret).update(`${id}.${horodatage}.${corps}`).digest("base64");
  return { "webhook-id": id, "webhook-timestamp": horodatage, "webhook-signature": `v1,${signature}` };
}
