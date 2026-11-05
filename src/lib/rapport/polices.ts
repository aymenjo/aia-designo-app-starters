import path from "node:path";
import { Font } from "@react-pdf/renderer";

// Les polices de DESIGN.md dans le PDF du rapport. react-pdf ne lit que le TTF et le WOFF, et pas les polices variables :
// on prend les fichiers statiques des paquets @fontsource, sous-ensemble latin (€, espaces insécables et fines compris).
// Le chemin part de la racine du projet ; sur Vercel, next.config.ts les ajoute au paquet de la route qui génère le PDF.

export const POLICES = { titre: "Plus Jakarta Sans", corps: "Geist", mono: "JetBrains Mono" } as const;

const fichier = (paquet: string, graisse: number) =>
  path.join(process.cwd(), "node_modules", "@fontsource", paquet, "files", `${paquet}-latin-${graisse}-normal.woff`);

/** Chaque graisse employée dans le PDF : une graisse absente ferait échouer le rendu. */
const GRAISSES = {
  [POLICES.titre]: { paquet: "plus-jakarta-sans", graisses: [700, 800] },
  [POLICES.corps]: { paquet: "geist", graisses: [400, 500, 600] },
  [POLICES.mono]: { paquet: "jetbrains-mono", graisses: [500] },
};

for (const [family, { paquet, graisses }] of Object.entries(GRAISSES)) {
  Font.register({ family, fonts: graisses.map((fontWeight) => ({ src: fichier(paquet, fontWeight), fontWeight })) });
}

// Aucune césure : un mot, une plaque ou un montant passe entier à la ligne.
Font.registerHyphenationCallback((mot) => [mot]);

/** Ce que le préchauffage lit d'une police chargée (fontkit, sans types). */
type PoliceChargee = { characterSet: number[]; glyphForCodePoint: (codePoint: number) => unknown };

let prechauffage: Promise<void> | undefined;

/**
 * fontkit garde chaque glyphe en cache avec les caractères de sa première création. Or dessiner un glyphe composé (« É »)
 * crée ses composants (« E », l'accent) sans caractère : un « E » écrit plus loin compterait alors pour zéro caractère,
 * la ligne se couperait au milieu d'un mot, et le texte copié depuis le PDF serait faux. Avant le premier rendu, chaque
 * glyphe de la table des caractères est donc créé avec le sien. Une fois par processus ; un échec sera retenté.
 */
export function prechaufferPolices(): Promise<void> {
  prechauffage ??= Promise.all(
    Object.entries(GRAISSES).flatMap(([fontFamily, { graisses }]) =>
      graisses.map(async (fontWeight) => {
        await Font.load({ fontFamily, fontWeight });
        const police = Font.getFont({ fontFamily, fontWeight }).data as PoliceChargee | null;
        for (const codePoint of police?.characterSet ?? []) police!.glyphForCodePoint(codePoint);
      }),
    ),
  ).then(
    () => undefined,
    (erreur: unknown) => {
      prechauffage = undefined;
      throw erreur;
    },
  );
  return prechauffage;
}
