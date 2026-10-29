// Ce que partagent les emails de l'application (alertes, factures) : styles en ligne et tableaux, comme
// supabase/templates/lien-connexion.html, et les polices de DESIGN.md avec leurs replis.

export type ContenuEmail = { sujet: string; html: string; texte: string };

export const POLICE = "Geist,'Helvetica Neue',Arial,sans-serif";
export const POLICE_TITRE = "'Plus Jakarta Sans','Helvetica Neue',Arial,sans-serif";
export const POLICE_MONO = "'JetBrains Mono',ui-monospace,Menlo,Consolas,monospace";

export function echapper(texte: string) {
  return texte
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
