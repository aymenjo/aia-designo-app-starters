import { MAX_EMAILS_DIRECTION } from "@/lib/entreprise/regles";
import { POLICE, POLICE_TITRE, echapper, type ContenuEmail } from "@/lib/email/gabarit";
import { formaterEuros } from "@/lib/format";
import { libelleMois, type SyntheseRapport } from "./synthese";

// L'email du rapport mensuel (phase 25) : il part au nom de l'entreprise, à la direction avec le gestionnaire en copie,
// et porte le PDF en pièce jointe. Comme l'email au conducteur, il n'a ni logo, ni lien, ni bouton. Sans dépendance
// serveur, pour se tester seul. Le gabarit commun est dans src/lib/email/gabarit.ts.

const COULEURS = { ok: "#0E7A4E", urgent: "#B42318" } as const;

type Chiffre = { libelle: string; valeur: string; couleur?: string };

/**
 * L'email d'un mois : 4 chiffres du rapport, puis le renvoi vers la pièce jointe. Sans adresse « direction », il ne part
 * qu'au gestionnaire, et une phrase l'invite à en ajouter.
 */
export function emailRapport({
  raisonSociale,
  synthese,
  sansDirection,
}: {
  raisonSociale: string | null;
  synthese: SyntheseRapport;
  sansDirection: boolean;
}): ContenuEmail {
  const mois = libelleMois(synthese.mois);
  const sujet = `Rapport de flotte – ${mois}`;
  const depassees = synthese.echeancesManquees.length;
  const chiffres: Chiffre[] = [
    { libelle: "Avis reçus", valeur: String(synthese.recus) },
    { libelle: "Avis désignés", valeur: String(synthese.designes) },
    {
      libelle: "Échéances dépassées",
      valeur: String(depassees),
      ...(depassees > 0 && { couleur: COULEURS.urgent }),
    },
    {
      libelle: "Amendes de non-désignation évitées",
      valeur: formaterEuros(synthese.eurosEvites.mois),
      couleur: COULEURS.ok,
    },
  ];
  const intro = raisonSociale
    ? `Voici le bilan de la flotte de ${raisonSociale} pour ${mois}.`
    : `Voici le bilan de la flotte pour ${mois}.`;
  const paragraphes = [
    ...(synthese.aucunAvis ? ["Aucun avis ce mois-ci."] : []),
    "Le rapport complet est en pièce jointe : échéances dépassées, véhicules et conducteurs les plus verbalisés, fiches incomplètes.",
    ...(sansDirection
      ? [
          `Ce rapport ne part qu'à vous. Pour que la direction le reçoive le 1er du mois, ajoutez jusqu'à ${MAX_EMAILS_DIRECTION} adresses dans la fiche entreprise de Désigno.`,
        ]
      : []),
  ];
  const pied = raisonSociale ? `Envoyé avec Désigno pour ${raisonSociale}.` : "Envoyé avec Désigno.";

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
                <h1 style="margin:0 0 8px;font-family:${POLICE_TITRE};font-size:24px;font-weight:700;letter-spacing:-0.02em;line-height:1.2;">
                  ${echapper(sujet)}
                </h1>
                <p style="margin:0 0 24px;color:#646464;">${echapper(intro)}</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;border-top:1px solid #E8E8E8;">
${chiffres.map(chiffreHtml).join("\n")}
                </table>
${paragraphes.map((p) => `                <p style="margin:0 0 16px;">${echapper(p)}</p>`).join("\n")}
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

  const texte = [
    sujet,
    "",
    intro,
    "",
    ...chiffres.map(({ libelle, valeur }) => `${libelle} : ${valeur}`),
    "",
    ...paragraphes.flatMap((p) => [p, ""]),
    pied,
    "",
  ].join("\n");

  return { sujet, html, texte };
}

/** Une ligne des chiffres : le libellé à gauche, le chiffre à droite, dans la couleur de son signal s'il en a une. */
function chiffreHtml({ libelle, valeur, couleur }: Chiffre) {
  return `                  <tr>
                    <td style="padding:12px 16px 12px 0;border-bottom:1px solid #E8E8E8;color:#646464;font-size:13px;">${echapper(libelle)}</td>
                    <td align="right" style="padding:12px 0;border-bottom:1px solid #E8E8E8;font-family:${POLICE_TITRE};font-size:18px;font-weight:800;white-space:nowrap;color:${couleur ?? "#202020"};">${echapper(valeur)}</td>
                  </tr>`;
}
