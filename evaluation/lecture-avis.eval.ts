import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { clientLecture, lireAvecClaude, MODELE_LECTURE } from "@/lib/avis/lecteur-claude";
import { nettoyerLecture } from "@/lib/avis/lecture";
import {
  CHAMPS_REQUIS_AVIS,
  LIBELLES_CHAMP_AVIS,
  schemaAvis,
  type ChampRequisAvis,
  type Confiances,
  type DonneesAvis,
  type SaisieAvis,
  type ValeursRefusees,
} from "@/lib/avis/regles";

// Justesse de la lecture IA sur des avis réels anonymisés (phase 9) : npm run eval:lecture.
// Chaque lancement appelle l'API Claude, et coûte donc quelques centimes par avis. Mode d'emploi : LISEZMOI.md.

const DOSSIER = fileURLToPath(new URL("./avis/", import.meta.url));
const SEUIL = 0.9;
/** Avis lus en même temps. */
const EN_PARALLELE = 4;
/** Prix de Claude Opus 5.5 en dollars par million de jetons, hors repli sur un autre modèle. */
const PRIX = { entree: 4, sortie: 20 };

const TYPES: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

type Resultat = {
  fichier: string;
  attendu: DonneesAvis;
  lu: DonneesAvis | null;
  confiances: Confiances;
  refusees: ValeursRefusees;
  justes: ChampRequisAvis[];
  erreur?: string;
  latence: number;
  jetons: { entree: number; sortie: number };
};

/** attendu.json : pour chaque fichier du dossier, les valeurs justes, aux formats de saisie de l'écran. */
function lireJeu(): [string, SaisieAvis][] {
  const chemin = `${DOSSIER}attendu.json`;
  if (!existsSync(chemin)) throw new Error(`Jeu d'évaluation absent (${chemin}) : voir evaluation/LISEZMOI.md.`);
  const jeu = Object.entries(JSON.parse(readFileSync(chemin, "utf8")) as Record<string, SaisieAvis>);
  const absents = jeu.filter(([fichier]) => !existsSync(DOSSIER + fichier)).map(([fichier]) => fichier);
  if (absents.length) throw new Error(`Fichiers absents de evaluation/avis/ : ${absents.join(", ")}`);
  return jeu;
}

/** Les valeurs attendues, passées par les règles de l'écran : un attendu fautif est une erreur du jeu. */
function donneesAttendues(fichier: string, saisie: SaisieAvis): DonneesAvis {
  const valide = schemaAvis.safeParse(saisie);
  if (!valide.success) throw new Error(`attendu.json, ${fichier} : ${valide.error.message}`);
  return valide.data;
}

/** Le lieu et l'infraction se comparent sans casse, accents, ponctuation ni espaces en trop. */
function texteCompare(texte: string | null) {
  return texte
    ?.normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function estJuste(champ: ChampRequisAvis, lu: DonneesAvis, attendu: DonneesAvis) {
  if (champ === "lieu" || champ === "infraction") return texteCompare(lu[champ]) === texteCompare(attendu[champ]);
  return lu[champ] === attendu[champ];
}

async function evaluer(client: ReturnType<typeof clientLecture>, [fichier, saisie]: [string, SaisieAvis]) {
  const attendu = donneesAttendues(fichier, saisie);
  const type = TYPES[fichier.split(".").pop()?.toLowerCase() ?? ""];
  if (!type) throw new Error(`${fichier} : déposez un PDF, un JPG ou un PNG (un HEIC se convertit d'abord en JPG).`);

  const debut = performance.now();
  try {
    const { lecture, usage } = await lireAvecClaude(client, { contenu: readFileSync(DOSSIER + fichier), type });
    const { saisie: lue, confiances, refusees } = nettoyerLecture(lecture);
    // Toujours valide une fois nettoyée : c'est ce que l'avis enregistrerait.
    const lu = schemaAvis.parse(lue);
    return {
      fichier,
      attendu,
      lu,
      confiances,
      refusees,
      justes: CHAMPS_REQUIS_AVIS.filter((champ) => estJuste(champ, lu, attendu)),
      latence: performance.now() - debut,
      jetons: { entree: usage.input_tokens, sortie: usage.output_tokens },
    } satisfies Resultat;
  } catch (erreur) {
    // Comme dans l'application : la lecture a échoué, tous les champs sont à saisir.
    return {
      fichier,
      attendu,
      lu: null,
      confiances: {},
      refusees: {},
      justes: [],
      erreur: erreur instanceof Error ? erreur.message : String(erreur),
      latence: performance.now() - debut,
      jetons: { entree: 0, sortie: 0 },
    } satisfies Resultat;
  }
}

async function enParallele<T, R>(elements: T[], taille: number, traiter: (element: T) => Promise<R>) {
  const resultats: R[] = [];
  let suivant = 0;
  const fil = async () => {
    while (suivant < elements.length) {
      const i = suivant++;
      resultats[i] = await traiter(elements[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(taille, elements.length) }, fil));
  return resultats;
}

const pourcent = (part: number, total: number) => `${((100 * part) / Math.max(total, 1)).toFixed(1)} %`;

function afficher(resultats: Resultat[]) {
  const n = resultats.length;
  console.table(
    Object.fromEntries(
      CHAMPS_REQUIS_AVIS.map((champ) => {
        const justes = resultats.filter((r) => r.justes.includes(champ)).length;
        const surFaux = resultats.filter((r) => r.confiances[champ] === "sur" && !r.justes.includes(champ)).length;
        return [LIBELLES_CHAMP_AVIS[champ], { justesse: pourcent(justes, n), "« Sûr » faux": surFaux }];
      }),
    ),
  );

  // Le cas dangereux : un champ faux affiché en vert, que le gestionnaire ne regardera pas.
  for (const r of resultats) {
    if (r.erreur) console.log(`${r.fichier} : lecture en échec (${r.erreur})`);
    for (const champ of CHAMPS_REQUIS_AVIS) {
      if (!r.lu || r.justes.includes(champ)) continue;
      const niveau = r.confiances[champ] ?? "—";
      const refusee = r.refusees[champ];
      const lu = refusee ? `${refusee.valeur} (refusé : ${refusee.motif})` : r.lu[champ];
      console.log(`${r.fichier} · ${LIBELLES_CHAMP_AVIS[champ]} [${niveau}] : lu ${lu}, attendu ${r.attendu[champ]}`);
    }
  }

  const latences = resultats.map((r) => r.latence / 1000);
  const entree = resultats.reduce((total, r) => total + r.jetons.entree, 0);
  const sortie = resultats.reduce((total, r) => total + r.jetons.sortie, 0);
  const dollars = (entree * PRIX.entree + sortie * PRIX.sortie) / 1e6;
  console.log(
    [
      `${MODELE_LECTURE} · ${n} avis`,
      `latence moyenne ${(latences.reduce((a, b) => a + b, 0) / Math.max(n, 1)).toFixed(1)} s, max ${Math.max(...latences).toFixed(1)} s`,
      `${entree} jetons en entrée, ${sortie} en sortie : ${dollars.toFixed(3)} $ (${(dollars / Math.max(n, 1)).toFixed(4)} $ par avis)`,
    ].join("\n"),
  );
}

it(`lit au moins ${SEUIL * 100} % des champs justes`, async () => {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY manquante : mettez-la dans .env.development.local.");
  const jeu = lireJeu();
  const client = clientLecture();
  const resultats = await enParallele(jeu, EN_PARALLELE, (avis) => evaluer(client, avis));
  afficher(resultats);

  const justes = resultats.reduce((total, r) => total + r.justes.length, 0);
  const total = resultats.length * CHAMPS_REQUIS_AVIS.length;
  console.log(`Justesse : ${justes}/${total} champs, soit ${pourcent(justes, total)}`);
  expect(justes / total).toBeGreaterThanOrEqual(SEUIL);
});
