import { depuisIso, partiesParis } from "@/lib/dates";
import { POLICE, POLICE_MONO, POLICE_TITRE, echapper, type ContenuEmail } from "@/lib/email/gabarit";
import { formaterMontant } from "@/lib/format";
import type { Facture } from "./regles";

// L'email de facture (phase 18), envoyé par Désigno sur `invoice.paid` : les emails client de Stripe restent désactivés.
// Sans dépendance serveur, pour se tester seul. Le gabarit commun est dans src/lib/email/gabarit.ts.

const MOIS = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", month: "long", year: "numeric" });

/** « 2026-10-25T08:00:00Z » → « 25/10/2026 », le jour à Paris. */
const jour = (instant: string) => depuisIso(partiesParis(instant).date);

/** La facture du mois, avec les liens de Stripe vers son PDF et sa page en ligne. */
export function emailFacture({
  facture,
  raisonSociale,
  urlSite,
}: {
  facture: Facture;
  raisonSociale: string;
  urlSite: string;
}): ContenuEmail {
  const site = urlSite.replace(/\/+$/, "");
  // Le mois facturé est celui du début de la période, à Paris : une période qui commence le 31/10 à 23:30 UTC est novembre.
  const sujet = `Votre facture Désigno Pro · ${MOIS.format(new Date(facture.debutPeriode))}`;
  const titre = "Votre facture Désigno Pro";
  const montant = `${formaterMontant(facture.totalCentimes)} TTC, payée le ${jour(facture.payeeLe)}`;
  const abonnement = `${site}/parametres/abonnement`;
  // Le renvoi vers l'écran Abonnement, au milieu du pied : un lien dans l'email HTML, l'adresse dans la version texte.
  const pied = {
    avant: "Vos factures restent téléchargeables depuis Désigno : ",
    renvoi: "Abonnement › Gérer mon abonnement",
    apres: ". Vous y changez aussi votre carte, ou annulez l'abonnement.",
  };

  const lignes = [
    { libelle: "N° de facture", valeur: facture.numero, mono: true },
    { libelle: "Au nom de", valeur: raisonSociale, mono: false },
    { libelle: "Montant", valeur: montant, mono: false },
    { libelle: "Période", valeur: `du ${jour(facture.debutPeriode)} au ${jour(facture.finPeriode)}`, mono: false },
  ];

  const html = `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${echapper(sujet)}</title>
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
                <h1 style="margin:0 0 24px;font-family:${POLICE_TITRE};font-size:24px;font-weight:700;letter-spacing:-0.02em;line-height:1.2;">
                  ${echapper(titre)}
                </h1>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #E8E8E8;">
${lignes.map(ligneHtml).join("\n")}
                </table>
${facture.pdf ? boutonPdf(facture.pdf) : ""}${facture.enLigne ? lienEnLigne(facture.enLigne, Boolean(facture.pdf)) : ""}
                <p style="margin:24px 0 0;color:#646464;font-size:13px;">
                  ${echapper(pied.avant)}<a href="${echapper(abonnement)}" style="color:#202020;text-decoration:underline;">${echapper(pied.renvoi)}</a>${echapper(pied.apres)}
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;

  const texte = [
    titre,
    "",
    ...lignes.map(({ libelle, valeur }) => `${libelle} : ${valeur}`),
    "",
    ...(facture.pdf ? [`Télécharger la facture (PDF) : ${facture.pdf}`] : []),
    ...(facture.enLigne ? [`Voir la facture en ligne : ${facture.enLigne}`] : []),
    "",
    `${pied.avant}${pied.renvoi} (${abonnement})${pied.apres}`,
    "",
  ].join("\n");

  return { sujet, html, texte };
}

function ligneHtml({ libelle, valeur, mono }: { libelle: string; valeur: string; mono: boolean }) {
  const style = mono ? `font-family:${POLICE_MONO};font-size:13px;font-weight:500;` : "font-weight:600;";
  return `                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #E8E8E8;color:#646464;font-size:13px;width:140px;">${echapper(libelle)}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #E8E8E8;${style}">${echapper(valeur)}</td>
                  </tr>`;
}

function boutonPdf(url: string) {
  return `                <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:24px;">
                  <tr>
                    <td style="border-radius:9999px;background:#202020;">
                      <a href="${echapper(url)}" style="display:inline-block;padding:12px 24px;border-radius:9999px;font-size:14px;font-weight:600;color:#FFFFFF;text-decoration:none;">
                        Télécharger la facture (PDF)
                      </a>
                    </td>
                  </tr>
                </table>
`;
}

function lienEnLigne(url: string, apresBouton: boolean) {
  return `                <p style="margin:${apresBouton ? 16 : 24}px 0 0;">
                  <a href="${echapper(url)}" style="color:#202020;text-decoration:underline;">Voir la facture en ligne</a>
                </p>
`;
}
