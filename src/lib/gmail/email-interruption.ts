import { POLICE, POLICE_TITRE, echapper, type ContenuEmail } from "@/lib/email/gabarit";
import { MESSAGES_GMAIL } from "./regles";

// L'email de la relève Gmail interrompue (phase 23) : un seul par interruption, puis le bandeau de l'application prend le
// relais jusqu'à la reconnexion. Sans dépendance serveur, pour se tester seul. Le gabarit commun est dans
// src/lib/email/gabarit.ts.

export const SUJET_INTERRUPTION = "La relève Gmail de Désigno est interrompue";

/** L'interruption, le libellé qui n'est plus relevé, et le lien vers l'écran Intégrations, d'où l'on reconnecte Gmail. */
export function emailInterruption({ libelle, urlSite }: { libelle: string | null; urlSite: string }): ContenuEmail {
  const integrations = `${urlSite.replace(/\/+$/, "")}/parametres/integrations`;
  const titre = "La relève Gmail est interrompue";
  const constat = MESSAGES_GMAIL.bandeau(libelle);
  const consigne =
    "Reconnectez Gmail depuis Désigno pour reprendre la relève. D'ici là, déposez vos avis à la main : aucune échéance ne doit filer.";
  const pied = "Google a retiré l'accès de Désigno à votre boîte, ou il a expiré. Désigno ne lit que le libellé choisi.";

  const html = `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${echapper(SUJET_INTERRUPTION)}</title>
  </head>
  <body style="margin:0;padding:0;background:#F8F9FA;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F8F9FA;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border:1px solid #E8E8E8;border-radius:12px;">
            <tr>
              <td style="padding:32px;font-family:${POLICE};font-size:14px;line-height:1.5;color:#202020;">
                <p style="margin:0 0 24px;font-family:${POLICE_TITRE};font-size:18px;font-weight:800;letter-spacing:-0.02em;">
                  <span style="color:#0E7A4E;">&#10003;</span> Désigno
                </p>
                <h1 style="margin:0 0 16px;font-family:${POLICE_TITRE};font-size:24px;font-weight:700;letter-spacing:-0.02em;line-height:1.2;">
                  ${echapper(titre)}
                </h1>
                <p style="margin:0 0 12px;">${echapper(constat)}</p>
                <p style="margin:0;">${echapper(consigne)}</p>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:24px;">
                  <tr>
                    <td style="border-radius:9999px;background:#202020;">
                      <a href="${echapper(integrations)}" style="display:inline-block;padding:12px 24px;border-radius:9999px;font-size:14px;font-weight:600;color:#FFFFFF;text-decoration:none;">
                        Reconnecter Gmail
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="margin:24px 0 0;color:#646464;font-size:13px;">${echapper(pied)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;

  const texte = [titre, "", constat, "", consigne, "", `Reconnecter Gmail : ${integrations}`, "", pied, ""].join("\n");

  return { sujet: SUJET_INTERRUPTION, html, texte };
}
