// L'empreinte d'un email, pour sa clé d'idempotence chez Resend. Sans dépendance Node (Web Crypto) : les écritures des
// avis l'importent, et le dépôt, côté navigateur, importe aussi ce module.

/**
 * Resend refuse une clé déjà vue avec un autre contenu (un avis corrigé entre-temps) : l'empreinte porte donc sur le
 * destinataire et le contenu. Les 32 premiers caractères hexadécimaux du SHA-256.
 */
export async function empreinteEmail(a: string, sujet: string, html: string) {
  const octets = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([a, sujet, html])));
  return Array.from(new Uint8Array(octets), (octet) => octet.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}
