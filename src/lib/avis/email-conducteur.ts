import { depuisIso, partiesParis } from "@/lib/dates";
import { POLICE, POLICE_MONO, echapper, type ContenuEmail } from "@/lib/email/gabarit";
import type { Conducteur } from "@/lib/flotte/conducteurs";
import type { Vehicule } from "@/lib/flotte/vehicules";
import { formaterDateAHeure, formaterMontant } from "@/lib/format";
import type { Avis } from "./avis";

// L'email au conducteur (phase 21) : au clic sur « J'ai désigné sur l'ANTAI », l'entreprise prévient le conducteur
// qu'un nouvel avis va arriver à son nom. Les réponses vont au gestionnaire, et rien n'est joint : ni le scan, ni lien.
// Sans dépendance serveur, pour se tester seul. Le gabarit commun est dans src/lib/email/gabarit.ts.

/** Un fait de l'avis. Pour le véhicule, la plaque à part (mono, rectangle), et le modèle en `valeur`. */
export type FaitEmail = { libelle: string; valeur: string; plaque?: string };

/** L'email en clair, la seule source de l'envoi et de l'aperçu affiché avant le clic. */
export type ContenuEmailConducteur = {
  a: string;
  repondreA: string;
  /** Le nom affiché de l'expéditeur. */
  expediteur: string;
  sujet: string;
  salutation: string;
  paragraphes: string[];
  faits: FaitEmail[];
  question: string;
  pied: string;
};

/** « AB-123-CD · Renault Master » : la valeur d'un fait en une ligne, pour la version texte. */
export function valeurFait({ valeur, plaque }: FaitEmail) {
  return [plaque, valeur].filter(Boolean).join(" · ");
}

/**
 * L'email d'un avis prêt à désigner : son conducteur validé, qui a un email, et la raison sociale de la fiche complète.
 * « désigné » s'accorde avec la civilité. Un fait encore vide est omis ; sans modèle, le véhicule se réduit à sa plaque.
 */
export function contenuEmailConducteur({
  avis,
  vehicule,
  conducteur,
  raisonSociale,
  repondreA,
}: {
  avis: Pick<Avis, "plaque" | "infraction_le" | "lieu" | "infraction" | "montant_centimes">;
  vehicule: Pick<Vehicule, "plaque" | "modele"> | null;
  conducteur: Pick<Conducteur, "civilite" | "prenom" | "nom"> & { email: string };
  raisonSociale: string;
  repondreA: string;
}): ContenuEmailConducteur {
  const plaque = vehicule?.plaque ?? avis.plaque ?? "";
  const designe = conducteur.civilite === "mme" ? "désignée" : "désigné";
  const jour = avis.infraction_le ? ` du ${depuisIso(partiesParis(avis.infraction_le).date)}` : "";
  const faits: FaitEmail[] = [
    { libelle: "Date", valeur: avis.infraction_le ? formaterDateAHeure(avis.infraction_le) : "" },
    { libelle: "Lieu", valeur: avis.lieu ?? "" },
    { libelle: "Véhicule", valeur: vehicule?.modele ?? "", plaque },
    { libelle: "Infraction", valeur: avis.infraction ?? "" },
    { libelle: "Montant", valeur: avis.montant_centimes ? formaterMontant(avis.montant_centimes) : "" },
  ];

  return {
    a: conducteur.email,
    repondreA,
    expediteur: `${raisonSociale} via Désigno`,
    sujet: `Vous avez été ${designe} conducteur – infraction${jour}${plaque ? ` (${plaque})` : ""}`,
    salutation: `Bonjour ${conducteur.prenom},`,
    paragraphes: [
      `${raisonSociale} vous a ${designe} sur le site de l'ANTAI comme conducteur du véhicule au moment de l'infraction ci-dessous.`,
      "Vous allez recevoir à votre nom un nouvel avis de contravention pour cette infraction.",
    ],
    faits: faits.filter((fait) => valeurFait(fait)),
    question: `Une question ? Répondez à cet email : votre réponse arrivera chez ${raisonSociale}.`,
    pied: `Envoyé avec Désigno pour ${raisonSociale}.`,
  };
}

/** L'email prêt à partir : la même structure que les autres emails de l'application, sans lien ni bouton. */
export function emailConducteur(contenu: ContenuEmailConducteur): ContenuEmail {
  const { sujet, salutation, paragraphes, faits, question, pied } = contenu;

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
                <p style="margin:0 0 16px;">${echapper(salutation)}</p>
${paragraphes.map((p) => `                <p style="margin:0 0 16px;">${echapper(p)}</p>`).join("\n")}
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;border-top:1px solid #E8E8E8;">
${faits.map(faitHtml).join("\n")}
                </table>
                <p style="margin:0;">${echapper(question)}</p>
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
    salutation,
    "",
    ...paragraphes.flatMap((p) => [p, ""]),
    ...faits.map((fait) => `${fait.libelle} : ${valeurFait(fait)}`),
    "",
    question,
    "",
    pied,
    "",
  ].join("\n");

  return { sujet, html, texte };
}

/** Une ligne des faits : le libellé à gauche, la valeur à droite ; la plaque, seule forme rectangulaire, en mono. */
function faitHtml(fait: FaitEmail) {
  const plaque = fait.plaque
    ? `<span style="display:inline-block;padding:1px 6px;border:1px solid #202020;border-radius:4px;background:#FFFFFF;font-family:${POLICE_MONO};font-size:13px;font-weight:500;">${echapper(fait.plaque)}</span>`
    : "";
  const valeur = [plaque, fait.valeur && echapper(fait.valeur)].filter(Boolean).join(" &middot; ");
  return `                  <tr>
                    <td style="width:96px;padding:10px 16px 10px 0;border-bottom:1px solid #E8E8E8;color:#646464;font-size:13px;vertical-align:top;">${echapper(fait.libelle)}</td>
                    <td style="padding:10px 0;border-bottom:1px solid #E8E8E8;vertical-align:top;">${valeur}</td>
                  </tr>`;
}
