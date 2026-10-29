// La relève Gmail (phase 23) et les rappels Google Calendar (phase 22) par Composio, essayés sur un vrai compte :
// `npm run composio -- <commande>`. Lancé par Node seul (les types sont retirés à la volée). La clé de projet
// `COMPOSIO_API_KEY` et l'auth config `COMPOSIO_AUTH_CONFIG_GMAIL` sont lues dans .env.development.local, ou dans
// l'environnement.
//
//   config                     crée l'auth config Gmail (gérée par Composio, scope gmail.readonly), si elle manque
//   config-agenda              crée l'auth config de l'agenda (gérée par Composio, scope calendar.app.created), si elle manque
//   webhook <url>              abonne le projet aux événements V3, et affiche le secret de signature
//   connecter <userId>         ouvre le lien de connexion, attend le compte, puis affiche son adresse et ses libellés
//   declencher <userId> <compte> <libelle>   crée le déclencheur de la relève sur ce libellé (toutes les 15 min)
//   ecouter [dossier]          écoute les événements sans URL publique, et les écrit dans le dossier
//   piece <compte> <message> <piece>   télécharge une pièce jointe par le proxy, et en affiche la taille
//   oublier <declencheur|compte>       supprime un déclencheur (ti_…) ou un compte connecté (ca_…)
import { Composio } from "@composio/core";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
// Les scopes de SCOPES_AGENDA (src/lib/agenda/regles.ts) : le script ne passe pas par l'alias `@/` de l'app.
const SCOPES_AGENDA = [
  "https://www.googleapis.com/auth/calendar.app.created",
  "https://www.googleapis.com/auth/userinfo.email",
];
const DECLENCHEUR = "GMAIL_NEW_GMAIL_MESSAGE";
const EVENEMENTS = ["composio.trigger.message", "composio.connected_account.expired"];
const API_GMAIL = "https://gmail.googleapis.com/gmail/v1";

const cle = process.env.COMPOSIO_API_KEY;
if (!cle) {
  console.error("COMPOSIO_API_KEY manquante : mets la clé de projet Composio dans .env.development.local.");
  process.exit(1);
}
const composio = new Composio({ apiKey: cle, allowTracking: false, disableVersionCheck: true });
const [commande, ...args] = process.argv.slice(2);

function authConfig() {
  const id = process.env.COMPOSIO_AUTH_CONFIG_GMAIL;
  if (!id) throw new Error("COMPOSIO_AUTH_CONFIG_GMAIL manquante : lance d'abord `npm run composio -- config`.");
  return id;
}

/** Une lecture de l'API Gmail, par le proxy de Composio : toujours un GET. */
async function gmail(compte: string, chemin: string) {
  const endpoint = `${API_GMAIL}${chemin}`;
  const { status, data } = await composio.tools.proxyExecute({ endpoint, method: "GET", connectedAccountId: compte });
  if (status >= 300) throw new Error(`${chemin} : ${status} ${JSON.stringify(data)}`);
  return data as Record<string, unknown>;
}

switch (commande) {
  case "config": {
    const { items } = await composio.authConfigs.list({ toolkit: "gmail" });
    const existante = items.find((item) => item.name === "Désigno Gmail");
    if (existante) {
      console.log(`Auth config existante : ${existante.id}`);
      break;
    }
    const creee = await composio.authConfigs.create("gmail", {
      type: "use_composio_managed_auth",
      name: "Désigno Gmail",
      credentials: { scopes: SCOPE },
    });
    console.log(`Auth config créée : ${creee.id}\nAjoute COMPOSIO_AUTH_CONFIG_GMAIL=${creee.id} à .env.development.local.`);
    break;
  }

  case "config-agenda": {
    const { items } = await composio.authConfigs.list({ toolkit: "googlecalendar" });
    const existante = items.find((item) => item.name === "Désigno Agenda");
    if (existante) {
      console.log(`Auth config existante : ${existante.id}`);
      break;
    }
    const creee = await composio.authConfigs.create("googlecalendar", {
      type: "use_composio_managed_auth",
      name: "Désigno Agenda",
      credentials: { scopes: SCOPES_AGENDA },
    });
    console.log(`Auth config créée : ${creee.id}\nAjoute COMPOSIO_AUTH_CONFIG_AGENDA=${creee.id} à .env.development.local.`);
    break;
  }

  case "webhook": {
    const [url] = args;
    if (!url?.startsWith("https://")) throw new Error("Usage : webhook https://…/api/webhooks/composio");
    const abonnement = await composio.webhooks.subscriptions.set({ webhookUrl: url, enabledEvents: EVENEMENTS, version: "V3" });
    console.log(`Abonnement ${abonnement.id} → ${abonnement.webhookUrl}\nCOMPOSIO_WEBHOOK_SECRET=${abonnement.secret}`);
    break;
  }

  case "connecter": {
    const [userId] = args;
    if (!userId) throw new Error("Usage : connecter <userId>");
    const demande = await composio.connectedAccounts.link(userId, authConfig(), { callbackUrl: "https://example.com/retour" });
    console.log(`Ouvre ce lien et connecte la boîte de test :\n${demande.redirectUrl}\n`);
    const compte = await composio.connectedAccounts.waitForConnection(demande.id, 5 * 60_000);
    console.log(`Compte ${compte.id} : ${compte.status}`);
    const profil = await gmail(compte.id, "/users/me/profile");
    console.log("Profil :", profil);
    const { labels } = (await gmail(compte.id, "/users/me/labels")) as { labels: unknown[] };
    console.log("Libellés :", labels);
    break;
  }

  case "declencher": {
    const [userId, compte, libelle] = args;
    if (!userId || !compte || !libelle) throw new Error("Usage : declencher <userId> <ca_…> <Label_…>");
    const { triggerId } = await composio.triggers.create(userId, DECLENCHEUR, {
      connectedAccountId: compte,
      triggerConfig: { labelIds: libelle, userId: "me", interval: 15 },
    });
    console.log(`Déclencheur ${triggerId} sur ${libelle}`);
    break;
  }

  case "ecouter": {
    const dossier = args[0] ?? join(tmpdir(), "composio-essai");
    await mkdir(dossier, { recursive: true });
    console.log(`Écoute des événements, écrits dans ${dossier} (Ctrl+C pour arrêter)…`);
    await composio.triggers.subscribe(async (evenement) => {
      const fichier = join(dossier, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
      await writeFile(fichier, JSON.stringify(evenement, null, 2));
      console.log(`Événement reçu : ${fichier}`);
    });
    break;
  }

  case "piece": {
    const [compte, message, piece] = args;
    if (!compte || !message || !piece) throw new Error("Usage : piece <ca_…> <messageId> <attachmentId>");
    const { size, data } = (await gmail(compte, `/users/me/messages/${message}/attachments/${piece}`)) as {
      size: number;
      data: string;
    };
    const contenu = Buffer.from(data, "base64url");
    console.log(`Taille annoncée ${size} o, reçue ${contenu.length} o, début : ${contenu.subarray(0, 8).toString("hex")}`);
    break;
  }

  case "oublier": {
    const [id] = args;
    if (id?.startsWith("ti_")) await composio.triggers.delete(id);
    else if (id?.startsWith("ca_")) await composio.connectedAccounts.delete(id);
    else throw new Error("Usage : oublier <ti_…|ca_…>");
    console.log(`${id} supprimé`);
    break;
  }

  default:
    console.error(
      "Commandes : config, config-agenda, webhook, connecter, declencher, ecouter, piece, oublier (voir l'en-tête du script).",
    );
    process.exit(1);
}
