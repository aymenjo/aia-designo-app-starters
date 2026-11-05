import { depuisIso } from "@/lib/dates";
import { POLICE, POLICE_MONO, POLICE_TITRE, echapper, type ContenuEmail } from "@/lib/email/gabarit";
import { formaterDateAHeure, formaterEuros } from "@/lib/format";
import type { Avis } from "./avis";
import { AMENDE_NON_DESIGNATION_CENTIMES, joursRestants, niveauEcheance } from "./echeance";

// L'email des alertes (phase 14) : un seul par entreprise et par jour, qui regroupe ses avis à J-15, J-7 ou J-2.
// Sans dépendance serveur, pour se tester seul. Le gabarit commun est dans src/lib/email/gabarit.ts.

/** Un avis concerné : son échéance est connue, puisqu'elle a déclenché l'alerte. */
export type AvisAlerte = Pick<Avis, "id" | "numero" | "plaque" | "infraction_le"> & { echeance: string };

/** Le texte et la teinte de l'échéance : rouge à J-2, ambre à J-7 et J-15 (DESIGN.md, l'échéance). */
const COULEURS = {
  urgent: { texte: "#B42318", teinte: "#FDECEA" },
  a_regarder: { texte: "#B45309", teinte: "#FDF3E3" },
} as const;

const VIDES = {
  numero: "N° non saisi",
  plaque: "Plaque non saisie",
  infraction_le: "Date de l'infraction non saisie",
};

/** Ce qu'une ligne affiche, en clair : l'email HTML l'échappe, la version texte le reprend tel quel. */
function ligne(avis: AvisAlerte, aujourdhui: string, urlSite: string) {
  const jours = joursRestants(avis.echeance, aujourdhui);
  return {
    plaque: avis.plaque,
    numero: avis.numero,
    infraction: avis.infraction_le ? `Infraction du ${formaterDateAHeure(avis.infraction_le)}` : VIDES.infraction_le,
    echeance: `avant le ${depuisIso(avis.echeance)} · J-${jours}`,
    couleurs: COULEURS[niveauEcheance(jours) === "urgent" ? "urgent" : "a_regarder"],
    lien: `${urlSite}/avis/${avis.id}`,
  };
}

/**
 * L'email du jour pour une entreprise : ses avis, du plus urgent au moins urgent, chacun avec un lien vers sa fiche.
 * Le sujet annonce le nombre d'avis et l'échéance la plus proche.
 */
export function emailAlertes({
  avis,
  aujourdhui,
  urlSite,
}: {
  avis: readonly AvisAlerte[];
  aujourdhui: string;
  urlSite: string;
}): ContenuEmail {
  if (!avis.length) throw new Error("emailAlertes : aucun avis");
  const site = urlSite.replace(/\/+$/, "");
  const tries = avis.toSorted((a, b) => a.echeance.localeCompare(b.echeance));
  const lignes = tries.map((un) => ligne(un, aujourdhui, site));
  const plusProche = tries[0].echeance;
  const proche = `${depuisIso(plusProche).slice(0, 5)} (J-${joursRestants(plusProche, aujourdhui)})`;
  const seul = tries.length === 1;

  const titre = `${tries.length} avis à désigner`;
  const sujet = seul ? `${titre} · échéance le ${proche}` : `${titre} · échéance la plus proche le ${proche}`;
  const amende = formaterEuros(AMENDE_NON_DESIGNATION_CENTIMES);
  const intro = seul
    ? `Son échéance de désignation approche. Désignez le conducteur sur le site de l'ANTAI avant la date indiquée, sous peine d'une amende de ${amende}.`
    : `Leur échéance de désignation approche. Désignez les conducteurs sur le site de l'ANTAI avant la date indiquée, sous peine d'une amende de ${amende} par avis.`;
  const pied =
    "Désigno vous écrit à J-15, J-7 et J-2 pour chaque avis ni désigné ni classé. Une fois désigné ou classé, un avis ne déclenche plus d'alerte.";
  const listeAvis = `${site}/avis`;

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
                <h1 style="margin:0 0 8px;font-family:${POLICE_TITRE};font-size:24px;font-weight:700;letter-spacing:-0.02em;line-height:1.2;">
                  ${echapper(titre)}
                </h1>
                <p style="margin:0 0 24px;color:#646464;">${echapper(intro)}</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #E8E8E8;">
${lignes.map(ligneHtml).join("\n")}
                </table>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:24px;">
                  <tr>
                    <td style="border-radius:9999px;background:#202020;">
                      <a href="${echapper(listeAvis)}" style="display:inline-block;padding:12px 24px;border-radius:9999px;font-size:14px;font-weight:600;color:#FFFFFF;text-decoration:none;">
                        Voir mes avis
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

  const texte = [
    titre,
    "",
    intro,
    "",
    ...lignes.flatMap((l) => [
      `- ${l.plaque ?? VIDES.plaque} · ${l.numero ? `avis n° ${l.numero}` : VIDES.numero}`,
      `  ${l.infraction}`,
      `  ${l.echeance}`,
      `  ${l.lien}`,
      "",
    ]),
    `Voir mes avis : ${listeAvis}`,
    "",
    pied,
    "",
  ].join("\n");

  return { sujet, html, texte };
}

/** Une ligne de la liste : la plaque (la seule forme rectangulaire), le n°, l'infraction, l'échéance et le lien. */
function ligneHtml(l: ReturnType<typeof ligne>) {
  const plaque = l.plaque
    ? `<span style="display:inline-block;padding:1px 6px;border:1px solid #202020;border-radius:4px;background:#FFFFFF;font-family:${POLICE_MONO};font-size:13px;font-weight:500;">${echapper(l.plaque)}</span>`
    : `<span style="color:#646464;">${VIDES.plaque}</span>`;
  const numero = l.numero
    ? `avis n° <span style="font-family:${POLICE_MONO};font-size:13px;font-weight:500;">${echapper(l.numero)}</span>`
    : `<span style="color:#646464;">${VIDES.numero}</span>`;
  return `                  <tr>
                    <td style="padding:16px 0;border-bottom:1px solid #E8E8E8;">
                      <p style="margin:0 0 4px;">${plaque} &nbsp;${numero}</p>
                      <p style="margin:0 0 8px;color:#646464;font-size:13px;">${echapper(l.infraction)}</p>
                      <p style="margin:0;">
                        <span style="display:inline-block;padding:2px 10px;border-radius:9999px;background:${l.couleurs.teinte};color:${l.couleurs.texte};font-size:13px;font-weight:600;white-space:nowrap;">${echapper(l.echeance)}</span>
                        &nbsp;<a href="${echapper(l.lien)}" style="color:#202020;text-decoration:underline;font-size:13px;">Ouvrir l'avis</a>
                      </p>
                    </td>
                  </tr>`;
}
