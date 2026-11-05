import { depuisIso } from "@/lib/dates";
import { POLICE, POLICE_TITRE, echapper, type ContenuEmail } from "@/lib/email/gabarit";

// L'email d'impayé (phase 19), envoyé par Désigno au premier échec de paiement d'une facture : les emails « paiement
// échoué » de Stripe restent désactivés. Un seul email par facture, puis le bandeau de l'application prend le relais.
// Sans dépendance serveur, pour se tester seul. Le gabarit commun est dans src/lib/email/gabarit.ts.

export const SUJET_IMPAYE = "Le paiement de votre abonnement Désigno Pro a échoué";

/** L'échec, la date limite (`limite`, AAAA-MM-JJ) et le lien vers l'écran Abonnement, d'où s'ouvre le portail. */
export function emailImpaye({ limite, urlSite }: { limite: string; urlSite: string }): ContenuEmail {
  const abonnement = `${urlSite.replace(/\/+$/, "")}/parametres/abonnement`;
  const titre = "Le paiement de votre abonnement Pro a échoué";
  const consigne = `Mettez à jour votre carte d'ici le ${depuisIso(limite)} : sinon, votre compte repassera en Free, sans perte de données.`;
  const pied = "« Mettre à jour ma carte » ouvre la page sécurisée de Stripe, depuis l'écran Abonnement de Désigno.";

  const html = `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${echapper(SUJET_IMPAYE)}</title>
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
                <p style="margin:0;">${echapper(consigne)}</p>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:24px;">
                  <tr>
                    <td style="border-radius:9999px;background:#202020;">
                      <a href="${echapper(abonnement)}" style="display:inline-block;padding:12px 24px;border-radius:9999px;font-size:14px;font-weight:600;color:#FFFFFF;text-decoration:none;">
                        Mettre à jour ma carte
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

  const texte = [titre, "", consigne, "", `Mettre à jour ma carte : ${abonnement}`, "", pied, ""].join("\n");

  return { sujet: SUJET_IMPAYE, html, texte };
}
