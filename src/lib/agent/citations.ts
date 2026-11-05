import { versIso, depuisIso } from "@/lib/dates";
import { lienPlanning } from "@/lib/flotte/planning";

// Les liens des réponses de l'agent (phase 26). Sans dépendance serveur : le serveur nettoie chaque réponse avant de
// l'enregistrer, et le panneau ne rend en lien que ce qui a la forme d'un lien autorisé.
//
// Un lien ne reste un lien que s'il vise un élément qu'un outil a renvoyé pendant la conversation : un avis, un véhicule,
// un conducteur, ou le planning d'un véhicule connu. Un lien inventé, externe, ou vers l'élément d'une autre entreprise
// devient du texte. Quelques écrans, sans donnée, restent aussi des liens.

export const TYPES_ELEMENT = ["avis", "vehicule", "conducteur"] as const;
export type TypeElement = (typeof TYPES_ELEMENT)[number];

const CHEMINS: Record<TypeElement, string> = {
  avis: "/avis/",
  vehicule: "/flotte/vehicules/",
  conducteur: "/flotte/conducteurs/",
};

/**
 * Les écrans vers lesquels l'agent peut renvoyer sans citer d'élément : les listes, puis ceux où agir quand une demande
 * sort de son rôle (phase 31). La section « # Les écrans » des consignes les reprend, dans le même ordre.
 */
export const ECRANS = [
  "/avis",
  "/flotte/vehicules",
  "/flotte/conducteurs",
  "/flotte/planning",
  "/rapports",
  "/parametres/entreprise",
  "/parametres/integrations",
  "/parametres/abonnement",
  "/parametres/compte",
];

/** Un élément cité dans une réponse, enregistré avec elle. Le planning cite un véhicule, à une date. */
export type ElementCite =
  | { type: TypeElement; id: string; lien: string }
  | { type: "planning"; id: string; date: string | null; lien: string };

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** « avis:<id> » : la clé d'un élément renvoyé par un outil. */
export function cleElement(type: TypeElement, id: string) {
  return `${type}:${id}`;
}

export function lienElement(type: TypeElement, id: string) {
  return `${CHEMINS[type]}${id}`;
}

/** Le lien d'une affectation : le planning de son véhicule, à la semaine d'une date. */
export function lienAffectation(vehiculeId: string, dateIso: string) {
  return lienPlanning({ vehicule: vehiculeId, date: dateIso });
}

/** Ce que vise un lien : un élément, le planning d'un véhicule, un écran ; `null` pour tout autre lien. */
export function analyserLien(href: string): { element: ElementCite } | { ecran: string } | null {
  if (ECRANS.includes(href)) return { ecran: href };

  for (const type of TYPES_ELEMENT) {
    const prefixe = CHEMINS[type];
    if (!href.startsWith(prefixe)) continue;
    const id = href.slice(prefixe.length).toLowerCase();
    return UUID.test(id) ? { element: { type, id, lien: lienElement(type, id) } } : null;
  }

  const [chemin, requete, ...reste] = href.split("?");
  if (chemin !== "/flotte/planning" || requete === undefined || reste.length) return null;
  const parametres = new URLSearchParams(requete);
  if ([...parametres.keys()].some((cle) => cle !== "vehicule" && cle !== "date")) return null;
  const id = parametres.get("vehicule")?.toLowerCase() ?? "";
  const date = parametres.get("date");
  if (!UUID.test(id) || parametres.getAll("vehicule").length > 1 || parametres.getAll("date").length > 1) return null;
  if (date !== null && versIso(depuisIso(date)) !== date) return null;
  return {
    element: { type: "planning", id, date, lien: lienPlanning({ vehicule: id, date: date ?? undefined }) },
  };
}

/** Le lien est autorisé dans une réponse : il vise un écran, ou un élément connu de la conversation. */
function citation(href: string, connus: ReadonlySet<string>): { lien: string; element?: ElementCite } | null {
  const analyse = analyserLien(href);
  if (!analyse) return null;
  if ("ecran" in analyse) return { lien: analyse.ecran };
  const { element } = analyse;
  const cle = element.type === "planning" ? cleElement("vehicule", element.id) : cleElement(element.type, element.id);
  return connus.has(cle) ? { lien: element.lien, element } : null;
}

// Un lien ou une image Markdown en ligne : [texte](cible "titre"), ![texte](cible). Les crochets imbriqués ne sont pas
// pris en charge : le panneau, de toute façon, ne rend en lien que ce qui a la forme d'un lien autorisé.
const LIEN_MARKDOWN = /(!?)\[((?:[^[\]\\]|\\.)*)\]\(\s*<?([^\s()<>]*)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;
// Un lien automatique : <https://exemple.fr>.
const LIEN_AUTOMATIQUE = /<((?:https?|mailto):[^\s<>]+)>/gi;

/**
 * La réponse de l'agent, prête à enregistrer : chaque lien qui ne vise ni un écran, ni un élément renvoyé par un outil
 * pendant la conversation (`connus`), devient son texte ; une image devient son texte. Renvoie aussi les éléments cités,
 * une fois chacun.
 */
export function nettoyerReponse(
  markdown: string,
  connus: ReadonlySet<string>,
): { contenu: string; elements_cites: ElementCite[] } {
  const cites = new Map<string, ElementCite>();
  const contenu = markdown
    .replace(LIEN_MARKDOWN, (_tout, image: string, texte: string, cible: string) => {
      if (image) return texte;
      const lien = citation(cible, connus);
      if (!lien) return texte;
      if (lien.element) cites.set(lien.element.lien, lien.element);
      return `[${texte}](${lien.lien})`;
    })
    .replace(LIEN_AUTOMATIQUE, "$1")
    .trim();
  return { contenu, elements_cites: [...cites.values()] };
}

/**
 * Les éléments renvoyés par les outils, d'après les résultats tels qu'ils sont partis chez Anthropic : chaque champ
 * « lien » qui vise un élément. Une réponse retrouvée après une coupure se nettoie avec eux.
 */
export function elementsDesResultats(resultats: readonly string[]): string[] {
  const cles = new Set<string>();
  for (const resultat of resultats) {
    for (const [, lien] of resultat.matchAll(/"lien":"([^"]+)"/g)) {
      const analyse = analyserLien(lien);
      if (!analyse || !("element" in analyse)) continue;
      const { element } = analyse;
      cles.add(element.type === "planning" ? cleElement("vehicule", element.id) : cleElement(element.type, element.id));
    }
  }
  return [...cles];
}
