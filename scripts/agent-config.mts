// L'agent et l'environnement de « Demande à Désigno » (phase 26) chez Anthropic : `npm run agent:config`.
// Idempotent : relancé, il retrouve l'agent « Désigno » et son environnement par leur nom, crée ce qui manque, et ne met
// l'agent à jour que si sa définition (src/lib/agent/definition.ts) a changé. Il n'archive ni ne supprime jamais rien.
// Lancé par Node seul (les types sont retirés à la volée) : il importe la définition par son chemin, Node ne résout pas
// l'alias `@/`.
//
// La clé choisit la cible : chaque cible a son workspace (« Désigno dev », « Désigno prod ») et sa clé, qui n'agit que
// sur lui. La clé est lue dans l'environnement, puis dans .env.development.local : pour la prod,
// `ANTHROPIC_API_KEY=<clé prod> npm run agent:config` (docs/DEPLOIEMENT.md, « Demande à Désigno »).
import Anthropic from "@anthropic-ai/sdk";
import {
  ENVIRONNEMENT,
  MODELE_AGENT,
  NOM_AGENT,
  NOM_ENVIRONNEMENT,
  definitionAgent,
  empreinte,
} from "../src/lib/agent/definition.ts";

const cle = process.env.ANTHROPIC_API_KEY;
if (!cle) {
  console.error(
    "ANTHROPIC_API_KEY manquante : mets la clé du workspace « Désigno dev » dans .env.development.local, ou passe celle " +
      "de « Désigno prod » dans l'environnement (voir .env.example).",
  );
  process.exit(1);
}
const anthropic = new Anthropic({ apiKey: cle });

async function environnement() {
  for await (const existant of anthropic.beta.environments.list()) {
    if (existant.name === NOM_ENVIRONNEMENT && !existant.archived_at) return { environnement: existant, etat: "déjà là" };
  }
  return { environnement: await anthropic.beta.environments.create(ENVIRONNEMENT), etat: "créé" };
}

async function agent() {
  const definition = definitionAgent();
  const metadata = { application: "designo", empreinte: await empreinte() };
  for await (const existant of anthropic.beta.agents.list()) {
    if (existant.name !== NOM_AGENT || existant.archived_at) continue;
    if (existant.metadata?.empreinte === metadata.empreinte) return { agent: existant, etat: "à jour" };
    const misAJour = await anthropic.beta.agents.update(existant.id, {
      ...definition,
      metadata,
      version: existant.version,
    });
    return { agent: misAJour, etat: `mis à jour, version ${misAJour.version}` };
  }
  return { agent: await anthropic.beta.agents.create({ ...definition, metadata }), etat: "créé" };
}

const { environnement: env, etat: etatEnvironnement } = await environnement();
console.log(`Environnement ${env.id} « ${env.name} » : réseau limité, aucun hôte (${etatEnvironnement})`);
const { agent: unAgent, etat: etatAgent } = await agent();
console.log(`Agent         ${unAgent.id} « ${unAgent.name} » · ${MODELE_AGENT} (${etatAgent})`);

console.log(`
À reporter, avec la clé de ce workspace :
  - en développement, dans .env.development.local ;
  - en production, dans Vercel (Production), puis redéployer.

ANTHROPIC_AGENT_ID=${unAgent.id}
ANTHROPIC_ENVIRONMENT_ID=${env.id}

Les sessions se suivent dans la Console, Managed Agents › Sessions du workspace.`);
