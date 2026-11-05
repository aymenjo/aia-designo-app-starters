import { Circle, Document, Page, Path, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";
import type { ReactNode } from "react";
import { LIBELLES_STATUT } from "@/lib/avis/regles";
import { depuisIso } from "@/lib/dates";
import { formaterDate, formaterEuros, formaterMontant } from "@/lib/format";
import { POLICES } from "./polices";
import { libelleMois, type Compte, type SyntheseRapport } from "./synthese";

// Le PDF du rapport mensuel (phase 25) : A4 portrait, 1 à 2 pages. Les couleurs, les polices et les formes viennent de
// DESIGN.md, en points : la couleur n'a que 3 sens (vert « sous contrôle », rouge « urgent »), et la plaque est la seule
// forme rectangulaire. Pour tenir en 2 pages, les listes longues s'arrêtent sur « et n autres ».

/** Les échéances dépassées listées, puis « et n autres ». */
export const MAX_ECHEANCES = 10;
/** Les fiches incomplètes listées (l'entreprise comprise), puis « et n autres ». */
export const MAX_FICHES = 15;

export type DonneesRapport = {
  /** Vide si la fiche n'a pas de raison sociale. */
  raisonSociale: string | null;
  synthese: SyntheseRapport;
  /** L'instant de la génération : le pied de page le date. */
  genereLe: string;
};

/**
 * Les montants de l'application séparent les milliers par une espace fine insécable (U+202F), absente des polices du
 * PDF : elle y devient une espace insécable, qui garde le montant entier sur sa ligne.
 */
const insecable = (texte: string) => texte.replaceAll("\u202F", "\u00A0");
const euros = (centimes: number) => insecable(formaterEuros(centimes));
const montant = (centimes: number) => insecable(formaterMontant(centimes));

const COULEURS = {
  encre: "#202020",
  secondaire: "#646464",
  filet: "#E8E8E8",
  surface: "#F8F9FA",
  ok: "#0E7A4E",
  urgent: "#B42318",
} as const;

// Un `lineHeight` sans unité est converti en points d'après la taille du nœud qui le porte, puis hérité tel quel : il
// n'est donc jamais posé sur la page, mais avec la taille du texte qu'il règle. Sans lui, react-pdf prend l'interligne
// de la police.
const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 60,
    paddingHorizontal: 40,
    fontFamily: POLICES.corps,
    fontSize: 9.5,
    color: COULEURS.encre,
  },
  logo: { flexDirection: "row", alignItems: "center", marginBottom: 18 },
  logoNom: { fontFamily: POLICES.titre, fontWeight: 800, fontSize: 12, letterSpacing: -0.24, marginLeft: 5 },
  enTete: { paddingBottom: 16, borderBottomWidth: 0.75, borderBottomColor: COULEURS.filet },
  titre: { fontFamily: POLICES.titre, fontWeight: 700, fontSize: 20, letterSpacing: -0.4, lineHeight: 1.2 },
  sousTitre: { marginTop: 4, fontSize: 10.5, color: COULEURS.secondaire },
  tuiles: { flexDirection: "row", marginTop: 14 },
  tuile: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 0.75,
    borderColor: COULEURS.filet,
    borderRadius: 9,
  },
  tuileLibelle: { fontSize: 8.5, color: COULEURS.secondaire },
  tuileChiffre: {
    marginTop: 2,
    fontFamily: POLICES.titre,
    fontWeight: 800,
    fontSize: 20,
    lineHeight: 1.15,
    letterSpacing: -0.6,
  },
  tuileSousLigne: { marginTop: 2, fontSize: 8.5, color: COULEURS.secondaire },
  info: { marginTop: 12, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 9, backgroundColor: COULEURS.surface },
  section: { marginTop: 18 },
  titreSection: { marginBottom: 6, fontFamily: POLICES.titre, fontWeight: 700, fontSize: 12, letterSpacing: -0.12 },
  sousTitreSection: { marginTop: 10, marginBottom: 2, fontWeight: 600 },
  meta: {
    fontFamily: POLICES.mono,
    fontWeight: 500,
    fontSize: 6.5,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: COULEURS.secondaire,
  },
  entete: { flexDirection: "row", paddingVertical: 5, borderBottomWidth: 0.75, borderBottomColor: COULEURS.filet },
  ligne: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 4,
    minHeight: 22,
    borderBottomWidth: 0.75,
    borderBottomColor: COULEURS.filet,
  },
  mono: { fontFamily: POLICES.mono, fontWeight: 500, fontSize: 8.5 },
  nombre: { textAlign: "right" },
  plaque: {
    alignSelf: "flex-start",
    paddingVertical: 1.5,
    paddingHorizontal: 5,
    borderWidth: 0.75,
    borderColor: COULEURS.encre,
    borderRadius: 3,
    backgroundColor: "#FFFFFF",
  },
  secondaire: { color: COULEURS.secondaire },
  ok: { color: COULEURS.ok },
  urgent: { color: COULEURS.urgent },
  suite: { marginTop: 6, fontSize: 8.5, color: COULEURS.secondaire },
  pied: {
    position: "absolute",
    bottom: 28,
    left: 40,
    right: 40,
    paddingTop: 8,
    borderTopWidth: 0.75,
    borderTopColor: COULEURS.filet,
    fontSize: 7.5,
    color: COULEURS.secondaire,
  },
});

/** La jauge des 45 jours bouclée, suivie de « Désigno » (src/components/Logo.tsx). */
function Logo() {
  return (
    <View style={styles.logo}>
      <Svg viewBox="0 0 24 24" width={15} height={15}>
        <Circle cx={12} cy={12} r={10} fill="none" stroke={COULEURS.ok} strokeWidth={2.5} />
        <Path
          d="M7.5 12.2 L10.5 15.2 L16.5 9"
          fill="none"
          stroke={COULEURS.ok}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
      <Text style={styles.logoNom}>Désigno</Text>
    </View>
  );
}

/** La plaque : mono, filet encre, rayon 4 px, jamais arrondie davantage. */
function Plaque({ plaque }: { plaque: string }) {
  return (
    <View style={styles.plaque}>
      <Text style={styles.mono}>{plaque}</Text>
    </View>
  );
}

function Tuile({
  libelle,
  chiffre,
  couleur,
  sousLigne,
  dernier = false,
}: {
  libelle: string;
  chiffre: string;
  couleur?: string;
  sousLigne?: string;
  dernier?: boolean;
}) {
  return (
    <View style={[styles.tuile, dernier ? {} : { marginRight: 8 }]}>
      <Text style={styles.tuileLibelle}>{libelle}</Text>
      <Text style={[styles.tuileChiffre, couleur ? { color: couleur } : {}]}>{chiffre}</Text>
      {sousLigne && <Text style={styles.tuileSousLigne}>{sousLigne}</Text>}
    </View>
  );
}

/** Un titre de section, jamais seul en bas de page. */
function Section({ titre, children }: { titre: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.titreSection} minPresenceAhead={60}>
        {titre}
      </Text>
      {children}
    </View>
  );
}

type Colonne = { titre: string; largeur: number; nombre?: boolean };

/** Les en-têtes d'un tableau, en libellés méta ; `largeur` est la part de la ligne. */
function EnTeteTableau({ colonnes }: { colonnes: readonly Colonne[] }) {
  return (
    <View style={styles.entete} wrap={false}>
      {colonnes.map(({ titre, largeur, nombre }) => (
        <Text key={titre} style={[styles.meta, { flex: largeur }, nombre ? styles.nombre : {}]}>
          {titre}
        </Text>
      ))}
    </View>
  );
}

/** Une ligne de tableau, qui ne se coupe jamais entre deux pages. */
function Ligne({ colonnes, cellules }: { colonnes: readonly Colonne[]; cellules: ReactNode[] }) {
  return (
    <View style={styles.ligne} wrap={false}>
      {cellules.map((cellule, rang) => (
        <View key={colonnes[rang].titre} style={{ flex: colonnes[rang].largeur }}>
          {typeof cellule === "string" ? (
            <Text style={colonnes[rang].nombre ? styles.nombre : {}}>{cellule}</Text>
          ) : (
            cellule
          )}
        </View>
      ))}
    </View>
  );
}

/** « et 3 autres », sous une liste tronquée. */
function Suite({ restants }: { restants: number }) {
  return restants > 0 ? <Text style={styles.suite}>{`et ${restants} autre${restants > 1 ? "s" : ""}`}</Text> : null;
}

const COLONNES_ECHEANCES: readonly Colonne[] = [
  { titre: "N° d'avis", largeur: 3 },
  { titre: "Plaque", largeur: 3 },
  { titre: "Échéance", largeur: 2 },
  { titre: "Statut", largeur: 2 },
];

function EcheancesDepassees({ echeances }: { echeances: SyntheseRapport["echeancesManquees"] }) {
  if (!echeances.length) return <Text style={styles.ok}>Aucune échéance dépassée ce mois-ci.</Text>;
  return (
    <View>
      <EnTeteTableau colonnes={COLONNES_ECHEANCES} />
      {echeances.slice(0, MAX_ECHEANCES).map((un) => (
        <Ligne
          key={un.id}
          colonnes={COLONNES_ECHEANCES}
          cellules={[
            un.numero ? <Text style={styles.mono}>{un.numero}</Text> : <Text style={styles.secondaire}>N° non saisi</Text>,
            un.plaque ? <Plaque plaque={un.plaque} /> : <Text style={styles.secondaire}>Plaque non saisie</Text>,
            depuisIso(un.echeance),
            LIBELLES_STATUT[un.statut],
          ]}
        />
      ))}
      <Suite restants={echeances.length - MAX_ECHEANCES} />
    </View>
  );
}

const colonnesPalmares = (premiere: string): readonly Colonne[] => [
  { titre: premiere, largeur: 5 },
  { titre: "12 mois", largeur: 1.5, nombre: true },
  { titre: "Mois", largeur: 1.5, nombre: true },
  { titre: "Montant", largeur: 2.5, nombre: true },
];

const comptes = ({ douzeMois, mois, montantCentimes }: Compte) => [
  String(douzeMois),
  String(mois),
  montant(montantCentimes),
];

function PlusVerbalises({ palmares }: { palmares: SyntheseRapport["plusVerbalises"] }) {
  const vehicules = colonnesPalmares("Véhicule");
  const conducteurs = colonnesPalmares("Conducteur");
  return (
    <View>
      <Text style={[styles.sousTitreSection, { marginTop: 0 }]} minPresenceAhead={50}>
        Véhicules
      </Text>
      {palmares.vehicules.length ? (
        <View>
          <EnTeteTableau colonnes={vehicules} />
          {palmares.vehicules.map((un) => (
            <Ligne
              key={un.plaque}
              colonnes={vehicules}
              cellules={[
                <View key="vehicule" style={{ flexDirection: "row", alignItems: "center" }}>
                  <Plaque plaque={un.plaque} />
                  {un.modele && <Text style={[styles.secondaire, { marginLeft: 6 }]}>{un.modele}</Text>}
                </View>,
                ...comptes(un),
              ]}
            />
          ))}
        </View>
      ) : (
        <Text style={styles.secondaire}>Aucun avis sur un véhicule de la flotte depuis 12 mois.</Text>
      )}
      <Text style={styles.sousTitreSection} minPresenceAhead={50}>
        Conducteurs
      </Text>
      {palmares.conducteurs.length ? (
        <View>
          <EnTeteTableau colonnes={conducteurs} />
          {palmares.conducteurs.map((un) => (
            <Ligne key={un.nom} colonnes={conducteurs} cellules={[un.nom, ...comptes(un)]} />
          ))}
        </View>
      ) : (
        <Text style={styles.secondaire}>Aucun conducteur validé sur un avis depuis 12 mois.</Text>
      )}
    </View>
  );
}

const COLONNES_FICHES: readonly Colonne[] = [
  { titre: "Fiche", largeur: 2.2 },
  { titre: "Champs manquants", largeur: 7.8 },
];

function FichesIncompletes({ fiches }: { fiches: SyntheseRapport["fichesIncompletes"] }) {
  const lignes = [
    ...(fiches.entreprise.length ? [{ nom: "Fiche entreprise", manquants: fiches.entreprise }] : []),
    ...fiches.conducteurs,
  ];
  if (!lignes.length) return <Text style={styles.ok}>Toutes les fiches sont complètes.</Text>;
  return (
    <View>
      <EnTeteTableau colonnes={COLONNES_FICHES} />
      {lignes.slice(0, MAX_FICHES).map(({ nom, manquants }) => (
        <Ligne
          key={nom}
          colonnes={COLONNES_FICHES}
          cellules={[
            <Text key="nom" style={{ fontWeight: 600 }}>
              {nom}
            </Text>,
            <Text key="manquants" style={[styles.secondaire, { fontSize: 8, lineHeight: 1.4 }]}>
              {manquants.join(", ")}
            </Text>,
          ]}
        />
      ))}
      <Suite restants={lignes.length - MAX_FICHES} />
    </View>
  );
}

/** Le rapport d'un mois, tel qu'il part en pièce jointe et se télécharge. */
export function RapportPdf({ raisonSociale, synthese, genereLe }: DonneesRapport) {
  const mois = libelleMois(synthese.mois);
  const depassees = synthese.echeancesManquees.length;
  const titre = `Rapport de flotte – ${mois}`;
  return (
    <Document title={titre} author={raisonSociale ?? undefined} creator="Désigno" producer="Désigno" language="fr-FR">
      <Page size="A4" style={styles.page}>
        <View style={styles.enTete}>
          <Logo />
          <Text style={styles.titre}>Rapport de flotte</Text>
          <Text style={styles.sousTitre}>{[raisonSociale, mois].filter(Boolean).join(" · ")}</Text>
        </View>

        <View style={styles.tuiles}>
          <Tuile libelle="Avis reçus" chiffre={String(synthese.recus)} />
          <Tuile libelle="Avis désignés" chiffre={String(synthese.designes)} />
          <Tuile libelle="Avis classés" chiffre={String(synthese.classes)} />
          <Tuile
            libelle="Échéances dépassées"
            chiffre={String(depassees)}
            couleur={depassees ? COULEURS.urgent : undefined}
            dernier
          />
        </View>
        <View style={[styles.tuiles, { marginTop: 8 }]}>
          <Tuile
            libelle="Amendes de non-désignation évitées"
            chiffre={euros(synthese.eurosEvites.mois)}
            couleur={COULEURS.ok}
            sousLigne={`en ${mois} · ${euros(synthese.eurosEvites.cumul)} en cumul`}
            dernier
          />
        </View>
        {synthese.aucunAvis && (
          <View style={styles.info}>
            <Text>Aucun avis ce mois-ci.</Text>
          </View>
        )}

        <Section titre="Échéances dépassées">
          <EcheancesDepassees echeances={synthese.echeancesManquees} />
        </Section>
        <Section titre="Les plus verbalisés · 12 mois">
          <PlusVerbalises palmares={synthese.plusVerbalises} />
        </Section>
        <Section titre="Fiches incomplètes">
          <FichesIncompletes fiches={synthese.fichesIncompletes} />
        </Section>

        <Text
          style={styles.pied}
          fixed
          render={({ pageNumber, totalPages }) =>
            `Généré le ${formaterDate(genereLe)} · échéances indicatives · ${pageNumber}/${totalPages}`
          }
        />
      </Page>
    </Document>
  );
}
