// Fichiers CSV : lecture selon la RFC 4180, écriture au format qu'ouvre Excel en français, sans qu'aucune cellule
// ne s'y exécute comme une formule. Repris par l'import de la flotte (phase 6) et l'export des avis (phase 24).

const BOM = "﻿";
const FIN_DE_LIGNE = "\r\n";
const SEPARATEUR = ";";

/**
 * UTF-8, avec ou sans BOM (retiré), sinon windows-1252 : l'encodage du « CSV (séparateur : point-virgule) »
 * d'Excel sous Windows.
 */
export function decoderCsv(octets: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(octets);
  } catch {
    return new TextDecoder("windows-1252").decode(octets);
  }
}

export type LectureCsv = { ok: true; enregistrements: string[][] } | { ok: false; ligne: number };

/**
 * Les enregistrements du fichier, cellules brutes. Une cellule entre guillemets peut contenir le séparateur,
 * des `""` (un guillemet) et des sauts de ligne. Fins de ligne CRLF, LF ou CR seul.
 * Un guillemet jamais fermé renvoie le n° de l'enregistrement où il s'ouvre, compté comme Excel (le premier vaut 1).
 */
export function lireCsv(texte: string, separateur: string): LectureCsv {
  const enregistrements: string[][] = [];
  let enregistrement: string[] = [];
  let cellule = "";
  let debutCellule = true;
  let entreGuillemets = false;

  const finCellule = () => {
    enregistrement.push(cellule);
    cellule = "";
    debutCellule = true;
  };
  const finEnregistrement = () => {
    finCellule();
    enregistrements.push(enregistrement);
    enregistrement = [];
  };

  for (let i = 0; i < texte.length; i++) {
    const c = texte[i];
    if (entreGuillemets) {
      if (c !== '"') cellule += c;
      else if (texte[i + 1] === '"') {
        cellule += '"';
        i++;
      } else entreGuillemets = false;
    } else if (c === '"' && debutCellule) {
      entreGuillemets = true;
      debutCellule = false;
    } else if (c === separateur) finCellule();
    else if (c === "\r" || c === "\n") {
      if (c === "\r" && texte[i + 1] === "\n") i++;
      finEnregistrement();
    } else {
      // Un guillemet au milieu d'une cellule est gardé tel quel, comme le fait Excel.
      cellule += c;
      debutCellule = false;
    }
  }

  if (entreGuillemets) return { ok: false, ligne: enregistrements.length + 1 };
  // La dernière ligne n'a pas toujours de fin de ligne ; un fichier qui en finit une n'a pas d'enregistrement vide en plus.
  if (enregistrement.length || !debutCellule) finEnregistrement();
  return { ok: true, enregistrements };
}

/** Une cellule écrite `="…"` : Excel la garde en texte, zéros de tête compris (le n° d'avis). */
export type TexteForce = { texteForce: string };
export type Cellule = string | number | null | undefined | TexteForce;

export function texteForce(valeur: string): TexteForce {
  return { texteForce: valeur };
}

const A_PROTEGER = /[;"\r\n]/;
const A_PROTEGER_FORMULE = /[;\r\n]/;
// Injection CSV : Excel calcule une cellule qui commence par l'un de ces caractères. Une apostrophe devant en fait du
// texte. Le lieu, l'infraction et le motif viennent de la lecture IA, de Gmail ou d'une saisie libre.
const DEBUT_DE_FORMULE = /^[=+\-@\t\r]/;

function proteger(texte: string) {
  return `"${texte.replaceAll('"', '""')}"`;
}

function cellule(valeur: Cellule): string {
  if (valeur == null) return "";
  if (typeof valeur === "number") return String(valeur);
  if (typeof valeur === "object") {
    // Un guillemet au milieu d'une cellule est gardé tel quel par Excel : la formule n'est protégée que si elle doit l'être.
    const formule = `=${proteger(valeur.texteForce)}`;
    return A_PROTEGER_FORMULE.test(formule) ? proteger(formule) : formule;
  }
  const texte = DEBUT_DE_FORMULE.test(valeur) ? `'${valeur}` : valeur;
  return A_PROTEGER.test(texte) ? proteger(texte) : texte;
}

/**
 * Un CSV qu'Excel en français ouvre en colonnes, accents compris : BOM UTF-8, « ; » et CRLF.
 * Pas de ligne `sep=;` : avec elle, Excel ignore le BOM et casse les accents.
 */
export function ecrireCsv(lignes: readonly (readonly Cellule[])[]): string {
  return BOM + lignes.map((ligne) => ligne.map(cellule).join(SEPARATEUR) + FIN_DE_LIGNE).join("");
}
