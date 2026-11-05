import { afterAll, beforeAll, expect, it } from "vitest";
import { afficher, duree, nettoyerBanc, poserTout, semerBanc, type Banc } from "./agent/banc";
import { QUESTIONS } from "./agent/questions";

// Justesse et rapidité de Demande à Désigno (phase 26) : npm run eval:agent. Le PRD fixe deux seuils sur 30 questions
// posées au compte de démonstration : au moins 90 % de réponses exactes, et 90 % en moins de 30 s. Chaque question part
// dans une session neuve, avec l'agent configuré par `npm run agent:config` ; les sessions sont effacées à la fin.
// Chaque lancement coûte quelques dollars. Mode d'emploi : LISEZMOI.md.

const SEUIL_JUSTESSE = 0.9;
const SEUIL_RAPIDITE = 0.9;
const DELAI_RAPIDE_MS = 30_000;

let banc: Banc | undefined;

beforeAll(async () => {
  banc = await semerBanc();
}, 120_000);

afterAll(() => nettoyerBanc(banc));

it("répond juste à 90 % des 30 questions, et vite à 90 %", { timeout: 30 * 60_000 }, async () => {
  expect(QUESTIONS).toHaveLength(30);
  const resultats = await poserTout(banc!, QUESTIONS, "phase-26");
  afficher(resultats);

  const justes = resultats.filter(({ ecarts }) => !ecarts.length);
  const rapides = resultats.filter(({ dureeMs }) => dureeMs < DELAI_RAPIDE_MS);
  console.log(`En moins de ${duree(DELAI_RAPIDE_MS)} : ${rapides.length}/${resultats.length}`);

  expect(justes.length / resultats.length).toBeGreaterThanOrEqual(SEUIL_JUSTESSE);
  expect(rapides.length / resultats.length).toBeGreaterThanOrEqual(SEUIL_RAPIDITE);
});
