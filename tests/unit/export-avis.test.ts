import { describe, expect, it } from "vitest";
import type { AvisAvecConducteur } from "@/lib/avis/avis";
import { COLONNES_EXPORT, lignesExport, nomFichierExport } from "@/lib/avis/export";
import { ecrireCsv, texteForce } from "@/lib/csv";

/** Un avis « À traiter » sans aucun champ, déposé le 01/10/2026 à 10:00 à Paris. */
const VIDE: AvisAvecConducteur = {
  id: "00000000-0000-4000-8000-000000000001",
  numero: null,
  plaque: null,
  vehicule_id: null,
  infraction_le: null,
  lieu: null,
  infraction: null,
  montant_centimes: null,
  date_envoi: null,
  echeance: null,
  statut: "a_traiter",
  source: "depot",
  fichier: "e/f.png",
  fichier_type: "image/png",
  fichier_nom: null,
  depose_le: "2026-10-01T08:00:00+00:00",
  lecture_ia: null,
  confiances: {},
  valeurs_refusees: {},
  conducteur_id: null,
  designe_le: null,
  conducteur_prevenu_le: null,
  classe_le: null,
  motif_classement: null,
  motif_libre: null,
  verrouille: false,
  mois_quota: null,
  deverrouille_le: null,
  vehicule_lecture_seule: false,
  email_gmail_id: null,
  conducteur: null,
};

const KARIM = { prenom: "Karim", nom: "Benali" };

/** Les champs de l'avis, rangés par en-tête de colonne. */
function ligne(avis: AvisAvecConducteur) {
  const [, valeurs] = lignesExport([avis]);
  return Object.fromEntries(COLONNES_EXPORT.map(({ entete }, i) => [entete, valeurs[i]]));
}

describe("lignesExport", () => {
  it("écrit les en-têtes dans l'ordre", () => {
    expect(lignesExport([])).toEqual([
      [
        "N° d'avis",
        "Plaque",
        "Date de l'infraction",
        "Heure",
        "Lieu",
        "Infraction",
        "Montant (€)",
        "Date d'envoi",
        "Échéance",
        "Statut",
        "Motif de classement",
        "Conducteur désigné",
        "Date de désignation",
        "Date de classement",
        "Déposé le",
      ],
    ]);
  });

  it("écrit toutes les colonnes d'un avis désigné, à l'heure de Paris", () => {
    expect(
      ligne({
        ...VIDE,
        numero: "0123456789",
        plaque: "AB-123-CD",
        // 06:30 UTC un 3 mars : 07:30 à Paris (UTC+1).
        infraction_le: "2026-03-03T06:30:00+00:00",
        lieu: "A6, Auxerre, sens Paris-Province",
        infraction: "Excès de vitesse inférieur à 20 km/h",
        montant_centimes: 13500,
        date_envoi: "2026-03-10",
        echeance: "2026-04-24",
        statut: "designe",
        conducteur_id: "00000000-0000-4000-8000-000000000002",
        conducteur: KARIM,
        // 23:30 UTC le 20 mars : déjà le 21 à Paris.
        designe_le: "2026-03-20T23:30:00+00:00",
        depose_le: "2026-03-12T08:00:00+00:00",
      }),
    ).toEqual({
      "N° d'avis": texteForce("0123456789"),
      Plaque: "AB-123-CD",
      "Date de l'infraction": "03/03/2026",
      Heure: "07:30",
      Lieu: "A6, Auxerre, sens Paris-Province",
      Infraction: "Excès de vitesse inférieur à 20 km/h",
      "Montant (€)": "135,00",
      "Date d'envoi": "10/03/2026",
      Échéance: "24/04/2026",
      Statut: "Désigné",
      "Motif de classement": null,
      "Conducteur désigné": "Karim Benali",
      "Date de désignation": "21/03/2026",
      "Date de classement": null,
      "Déposé le": "12/03/2026",
    });
  });

  it("prend l'heure d'été de Paris", () => {
    // 22:15 UTC le 14 juillet : 00:15 le 15 à Paris (UTC+2).
    const ete = ligne({ ...VIDE, infraction_le: "2026-07-14T22:15:00+00:00" });
    expect([ete["Date de l'infraction"], ete.Heure]).toEqual(["15/07/2026", "00:15"]);
  });

  it("écrit le motif d'un avis classé : le texte libre pour « Autre », le libellé sinon", () => {
    const classe = { ...VIDE, statut: "classe" as const, classe_le: "2026-10-20T09:00:00+00:00" };
    const autre = ligne({ ...classe, motif_classement: "autre", motif_libre: "Avis reçu en double" });
    expect(autre).toMatchObject({
      Statut: "Classé",
      "Motif de classement": "Avis reçu en double",
      "Date de classement": "20/10/2026",
    });
    expect(ligne({ ...classe, motif_classement: "conteste" })["Motif de classement"]).toBe("Avis contesté");
  });

  it("ne nomme pas le conducteur validé d'un avis qui n'est pas désigné", () => {
    const valide = { conducteur_id: "00000000-0000-4000-8000-000000000002", conducteur: KARIM };
    expect(ligne({ ...VIDE, ...valide, statut: "a_valider" })["Conducteur désigné"]).toBeNull();
    const classe = ligne({
      ...VIDE,
      ...valide,
      statut: "classe",
      classe_le: "2026-10-20T09:00:00+00:00",
      motif_classement: "conteste",
    });
    expect(classe["Conducteur désigné"]).toBeNull();
  });

  it("laisse vides les cellules d'un avis sans champ, sauf son statut et son dépôt", () => {
    expect(ecrireCsv(lignesExport([VIDE])).split("\r\n")[1]).toBe(";;;;;;;;;À traiter;;;;;01/10/2026");
  });

  it("écrit un montant sans séparateur de milliers, pour qu'Excel l'additionne", () => {
    expect(ligne({ ...VIDE, montant_centimes: 135000 })["Montant (€)"]).toBe("1350,00");
  });

  it("garde les zéros de tête du n° d'avis dans le fichier", () => {
    expect(ecrireCsv(lignesExport([{ ...VIDE, numero: "0123456789" }])).split("\r\n")[1]).toMatch(
      /^="0123456789";/,
    );
  });
});

describe("nomFichierExport", () => {
  it("date le fichier du jour", () => {
    expect(nomFichierExport("2026-10-29")).toBe("designo-avis-2026-10-29.csv");
  });
});
