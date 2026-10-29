# Mettre ta copie en production

Ce guide part d'une copie du dépôt poussée sur ton propre GitHub. À la fin, chaque push sur `main` est testé, les migrations sont appliquées sur ton Supabase, et Vercel sert l'application sur ton adresse.

## 1. Prérequis

- Node 24 et Docker (OrbStack sur macOS).
- La CLI GitHub `gh`, connectée à ton compte (`gh auth login`).
- Un compte Supabase, un compte Vercel et un compte Resend (pour les emails de connexion, les alertes et les factures).
- Un compte Stripe (pour le passage en Pro), et la [Stripe CLI](https://docs.stripe.com/stripe-cli) pour la recette en mode test.
- Une clé d'API Claude, créée dans la Console Claude (pour la lecture IA des avis).

## 2. En local

Suis la section « Développer en local » du [README](../README.md). Tout tourne sur le Supabase local, sans compte.

## 3. Premier push

Pousse ta copie sur la branche `main` de ton dépôt. La CI (`.github/workflows/ci.yml`) se lance :

- le job `tests` passe : lint, types, tests unitaires, d'intégration et E2E, sur un Supabase local créé pour l'occasion ;
- le job `migrations` est **sauté**, et le résumé du run affiche la note « Migrations sautées ».

C'est normal : ta CI ne connaît pas encore ton Supabase. Elle reste verte en attendant.

## 4. Supabase cloud

1. Crée un projet sur [supabase.com](https://supabase.com/dashboard). Choisis la région **Europe West (Ireland)**, `eu-west-1` : elle est à côté des fonctions Vercel (`dub1` dans `vercel.json`) et garde les données dans l'UE.
2. Note le **mot de passe de la base**, choisi à la création. Tu peux le réinitialiser plus tard dans les réglages Database.
3. Relève le **project ref** : c'est l'identifiant de 20 lettres dans l'URL du tableau de bord (`supabase.com/dashboard/project/<ref>`).
4. Crée un **access token** dans Account › Access Tokens.

## 5. GitHub

Depuis le dossier de ta copie :

```bash
gh variable set SUPABASE_PROJECT_REF --body <ref>
gh secret set SUPABASE_ACCESS_TOKEN   # colle le token quand gh le demande
gh secret set SUPABASE_DB_PASSWORD    # colle le mot de passe de la base
```

Pousse ensuite un commit sur `main`, même vide (`git commit --allow-empty -m "ci: migrations"`). Le job `migrations` tourne cette fois : il relie la CLI à ton projet et applique les migrations de `supabase/migrations/`.

S'il manque un des deux secrets, le job échoue avec un message qui le nomme.

## 6. Vercel

1. Importe ton dépôt GitHub dans Vercel (Add New › Project). Next.js est détecté tout seul.
2. Avant de déployer, ajoute ces variables d'environnement :

   | Variable | Valeur |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | la clé `sb_publishable_…`, dans Project Settings › API Keys de Supabase |
   | `SUPABASE_SECRET_KEY` | la clé `sb_secret_…`, au même endroit : la tâche des alertes lit les avis de toutes les entreprises |
   | `ANTHROPIC_API_KEY` | la clé `sk-ant-…` de la Console Claude : sans elle, les avis déposés se saisissent à la main |
   | `RESEND_API_KEY` | la clé `re_…` de Resend, la même que pour le SMTP (étape 7) : elle envoie les alertes |
   | `CRON_SECRET` | une valeur aléatoire, par exemple `openssl rand -hex 32` : Vercel l'envoie à chaque tâche planifiée |
   | `STRIPE_SECRET_KEY` | une clé restreinte `rk_live_…` suffit à l'app (étape 9) : sans elle, « Passer en Pro » est indisponible |
   | `STRIPE_WEBHOOK_SECRET` | le secret `whsec_…` de l'endpoint du webhook (étape 9) : il authentifie chaque appel de Stripe |
   | `COMPOSIO_API_KEY` | la clé de projet Composio (étape 11) : sans elle, « Connecter Gmail » est indisponible |
   | `COMPOSIO_AUTH_CONFIG_GMAIL` | l'auth config Gmail `ac_…` du projet (étape 11) |
   | `COMPOSIO_AUTH_CONFIG_AGENDA` | l'auth config de l'agenda `ac_…` du projet (étape 11) : sans elle, « Connecter Google Calendar » est indisponible |
   | `COMPOSIO_WEBHOOK_SECRET` | le secret de l'abonnement webhook du projet (étape 11) : il authentifie chaque appel de Composio |

   `SUPABASE_SECRET_KEY` contourne la RLS : elle ne sert que côté serveur (`src/lib/supabase/admin.ts`), jamais dans le navigateur. Aucune de ces clés ne va dans GitHub : la CI tourne sur un Supabase local, avec Mailpit, un `CRON_SECRET`, un `STRIPE_WEBHOOK_SECRET` et un `COMPOSIO_WEBHOOK_SECRET` fixes, et ne parle jamais à Stripe ni à Composio.
3. Note l'adresse de production que Vercel te donne, du type `https://<projet>.vercel.app`.
4. Les tâches planifiées sont déclarées dans `vercel.json` : les alertes J-15, J-7, J-2 partent chaque matin (`0 6 * * *` en UTC, vers 7 h l'hiver et 8 h l'été à Paris). Vercel ne les lance que sur la production, et leurs liens pointent vers son adresse de production. Elles apparaissent dans Settings › Cron Jobs, d'où « Run » en lance une à la main. Depuis un terminal :

   ```bash
   curl -H "Authorization: Bearer <CRON_SECRET>" https://<projet>.vercel.app/api/cron/alertes
   ```

   La réponse donne le bilan (`{"emails":1,"avis":3,"echecs":0}`). Relancer le même jour n'envoie aucun doublon. Un échec renvoie 500 et se lit dans les logs de Vercel : relance alors la tâche, seuls les emails qui ne sont pas partis repartent.

   Le déverrouillage des avis Free tourne chaque nuit (`0 0 * * *` en UTC, vers 1 h l'hiver et 2 h l'été à Paris). Le 1er du mois, les avis « Verrouillés » d'un mois passé entrent dans le quota du nouveau mois, dans la limite de ses 5 places ; les autres nuits, il n'a presque jamais rien à faire. Le dépôt suivant d'une entreprise le rattrape si la tâche saute. À la main :

   ```bash
   curl -H "Authorization: Bearer <CRON_SECRET>" https://<projet>.vercel.app/api/cron/deverrouillage
   ```

   La réponse donne le nombre d'avis déverrouillés (`{"avis":2}`). Relancer ne change rien de plus.

   Les impayés sont traités chaque nuit (`0 3 * * *` en UTC, vers 4 h l'hiver et 5 h l'été à Paris). Un abonnement en échec de paiement depuis plus de 7 jours (le jour de l'échec, à Paris, plus 7 jours : la date de l'email et du bandeau) est annulé chez Stripe, et sa facture restée ouverte est annulée (void) : les 7 jours sont offerts. Le webhook `customer.subscription.deleted` repasse ensuite le compte en Free. Si la tâche saute, la nuit suivante la rattrape. À la main :

   ```bash
   curl -H "Authorization: Bearer <CRON_SECRET>" https://<projet>.vercel.app/api/cron/impayes
   ```

   La réponse donne le bilan (`{"annules":1,"echecs":0}`). Relancer le même jour ne fait rien de plus : Stripe donne déjà l'abonnement annulé. Un échec renvoie 500 et se lit dans les logs de Vercel, avec l'abonnement et la facture en cause. Une facture que la tâche n'a pas pu annuler n'est plus prélevée, mais reste due : annule-la à la main dans le Dashboard (Billing › Invoices › la facture › « Void invoice »), ou avec la Stripe CLI :

   ```bash
   stripe invoices void <in_…>
   ```

   Les agendas « Désigno » sont synchronisés chaque nuit (`0 5 * * *` en UTC, vers 6 h l'hiver et 7 h l'été à Paris). La synchronisation part déjà après chaque action sur un avis : la tâche rattrape ce qu'elle n'a pas pu faire, quand Google ne répondait pas, ou pour un avis modifié hors des écrans. Un agenda dont les rappels sont interrompus est laissé de côté jusqu'à la reconnexion. À la main :

   ```bash
   curl -H "Authorization: Bearer <CRON_SECRET>" https://<projet>.vercel.app/api/cron/agenda
   ```

   La réponse donne le bilan (`{"entreprises":3,"poses":1,"retires":0,"interrompus":0,"echecs":0}`). Relancer ne pose rien de plus que ce qui manque. Un échec renvoie 500 et se lit dans les logs de Vercel, avec l'entreprise en cause : la nuit suivante la reprend.

   Le rapport mensuel part chaque matin (`0 6 * * *` en UTC, vers 7 h l'hiver et 8 h l'été à Paris). La tâche produit le rapport du mois écoulé de chaque entreprise Pro qui existait pendant ce mois et ne l'a pas encore reçu : elle génère le PDF, le range dans le bucket `rapports` (`{entreprise_id}/AAAA-MM.pdf`), puis l'envoie aux adresses « direction », avec le gestionnaire en copie. Le 1er du mois, elle a tout à faire ; les autres matins, elle ne rattrape qu'un passage manqué, un envoi échoué, ou le mois précédent d'un compte tout juste passé en Pro. À la main :

   ```bash
   curl -H "Authorization: Bearer <CRON_SECRET>" https://<projet>.vercel.app/api/cron/rapport-mensuel
   ```

   La réponse donne le bilan (`{"generes":3,"envoyes":3,"echecs":0}`). Relancer n'envoie aucun doublon : un rapport parti est figé, et seuls ceux qui ne sont pas partis repartent. Un échec renvoie 500 et se lit dans les logs de Vercel, avec l'entreprise en cause : le PDF est archivé, et le matin suivant retente l'envoi. Tant que Resend est en mode test (voir le PLAN, risques), seule l'adresse du compte Resend reçoit le rapport : une adresse « direction » autre fait échouer l'envoi, que la tâche retente chaque matin.

## 7. Auth de la prod

Les réglages Auth du Supabase cloud (adresse du site, durée du lien, SMTP) viennent de `supabase/config.toml`. Le bloc `[remotes.production]` y porte ce qui diffère du local, avec les valeurs du dépôt d'origine. Remplace-les par les tiennes :

```toml
[remotes.production]
project_id = "<ref>"

[remotes.production.auth]
site_url = "https://<projet>.vercel.app"
additional_redirect_urls = ["https://<projet>.vercel.app"]
```

Le `project_id` compte : la CLI n'applique ce bloc qu'au projet qui porte ce ref. Avec un autre ref, c'est la config locale qui partirait en prod, avec une adresse en `127.0.0.1`.

Les emails partent par le SMTP de Resend. Crée une clé API chez Resend et mets-la dans `supabase/.env.local`, qui est ignoré par git :

```bash
RESEND_API_KEY=re_…
```

Puis pousse la config :

```bash
npx supabase login
npx supabase config push --project-ref <ref>
```

Tant que tu n'as pas de domaine vérifié chez Resend, les emails (liens de connexion et alertes) partent de `onboarding@resend.dev` et n'arrivent qu'à l'adresse de ton compte Resend : connecte-toi avec celle-là. Pour ouvrir à d'autres adresses, vérifie un domaine chez Resend, puis change `admin_email` dans `[remotes.production.auth.email.smtp]` et relance `config push`. Change aussi `EXPEDITEUR` dans `src/lib/email/envoi.ts`, qui envoie les alertes.

Pour vérifier, ouvre `https://<projet>.vercel.app/connexion`, saisis l'adresse de ton compte Resend et clique sur le lien reçu.

## 8. Deployment Checks

Dans les réglages du projet Vercel, section Deployment Checks, ajoute le check GitHub `migrations`. Vercel construit alors chaque push sur `main`, mais ne met la version en production qu'une fois ce job vert : le code n'est jamais servi avant ses migrations.

Ajoute ce check seulement après l'étape 5. Tant que la variable `SUPABASE_PROJECT_REF` manque, le job est sauté, et un job sauté ne prouve pas que les migrations sont appliquées.

## 9. Stripe

Le passage en Pro passe par Stripe : Checkout encaisse 49 € HT + TVA 20 % par carte, le webhook passe le compte en Pro, et le portail client gère la carte, les factures et l'annulation. Fais ces gestes deux fois : en mode test (clé `sk_test_…`), puis en mode live (`sk_live_…`), le jour de l'ouverture.

1. **Le catalogue et le portail**. Dans le Dashboard, ouvre d'abord Settings › Billing › Customer portal et clique une fois sur « Enregistrer » : la configuration par défaut du portail n'existe qu'après ce premier enregistrement. Mets ensuite la clé secrète dans `.env.development.local` (`STRIPE_SECRET_KEY=sk_test_…`), puis :

   ```bash
   npm run stripe:config
   ```

   Le script affiche le mode (test ou LIVE). Il crée, ou retrouve s'ils existent, le produit « Désigno Pro », son prix mensuel (49 € HT, hors taxe, lookup_key `designo_pro_mensuel`) et le taux « TVA FR 20 % » exclusif. Il règle le portail : carte, historique des factures et annulation en fin de période, sans changement d'adresse ni d'offre. Relancé, il ne crée rien de plus.
2. **Le webhook**. Developers › Webhooks › Add destination : l'adresse `https://<projet>.vercel.app/api/webhooks/stripe`, la **version d'API `2026-09-30.endive`** (celle du SDK : avec une autre, la fin de période n'est pas au même endroit, et le webhook répond 500), et 4 événements : `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted` et `invoice.paid`. Copie son secret `whsec_…` dans `STRIPE_WEBHOOK_SECRET` (Vercel).
3. **Les emails de Stripe**. Settings › Customer emails : désactive les emails de factures et de reçus, et ceux d'un paiement en échec (Billing › Revenue recovery › Emails : carte à mettre à jour, paiement échoué). Désigno envoie lui-même la facture, sur `invoice.paid`, et un seul email au premier échec de chaque facture, avec sa date limite.
   **Les relances**. Billing › Revenue recovery › Retries : des relances sur **au moins 2 semaines**, puis l'abonnement laissé en l'état. C'est Désigno qui compte les 7 jours, et annule l'abonnement le lendemain de la date limite (la tâche `/api/cron/impayes`) : des relances plus courtes que Stripe terminerait par une annulation feraient repasser le compte en Free avant la date annoncée.
4. **Le gabarit de facture**. Settings › Invoices : le n° de TVA de Désigno et les mentions légales (raison sociale, adresse, SIREN, pénalités de retard). Le nom, l'adresse, le SIREN et la TVA du client viennent de sa fiche entreprise.
5. **La clé de l'app**. Developers › API keys › Create restricted key, avec en écriture : Customers, Checkout Sessions, Customer portal, Subscriptions et Invoices (la tâche des impayés relit l'abonnement, l'annule, puis annule sa facture ; la suppression de compte liste les abonnements du client et fait de même) ; en lecture : Prices et Tax Rates. Elle va dans `STRIPE_SECRET_KEY` (Vercel). La clé secrète complète ne sert qu'à `npm run stripe:config`, depuis ton poste.
6. **Le nom public** (mode live). À l'activation du compte, le nom public de l'entreprise (Paramètres › Informations publiques) est « Désigno » : il s'affiche sur la page de paiement, dans le lien de retour du portail et sur les factures. Ne le confonds pas avec le nom du compte dans le Dashboard. En mode test, sans activation, le nom par défaut reste affiché : ce n'est qu'un libellé.

Ne mets jamais `STRIPE_WEBHOOK_SECRET` dans `.env.development.local` : il y masquerait la valeur fixe `whsec_local` de `.env.local`, avec laquelle les tests E2E signent leurs événements.

## 10. Recette en mode test

La CI simule Stripe avec des événements signés. Le vrai parcours se vérifie à la main, en mode test, sur le Supabase local :

1. Dans un terminal, relaie les événements de Stripe vers l'app, sur une seule ligne :

   ```bash
   stripe listen --latest --forward-to 127.0.0.1:3000/api/webhooks/stripe --all-snapshot
   ```

   `--all-snapshot` relaie tous les événements classiques : le webhook répond « ignoré » (200) à ceux qu'il ne gère pas. Chaque événement reçu (`-->`) doit être suivi de sa réponse (`<-- [200] POST …`) : sans cette ligne, `--forward-to` manque. Un événement manqué se renvoie avec `stripe events resend <evt_…>`.

2. Dans un autre, lance l'app avec le secret de ce relais (la clé `sk_test_…` est dans `.env.development.local`, étape 9) :

   ```bash
   STRIPE_WEBHOOK_SECRET=$(stripe listen --print-secret) npm run dev
   ```

3. Connecte-toi, complète la fiche entreprise, puis « Passer en Pro ». Paie avec la carte `4242 4242 4242 4242` (date future, CVC quelconque). Au retour, l'écran affiche « Activation du Pro… », puis « Bienvenue en Pro » : un avis « Verrouillé » est débloqué, et la facture arrive dans Mailpit. Recommence sur un autre compte avec `4000 0025 0000 3155` (3DS demandé), puis `4000 0000 0000 0002` (carte refusée : le compte reste en Free).
4. Ouvre le PDF de la facture : il porte la raison sociale, l'adresse du siège, le SIREN, le n° de TVA, et 58,80 € TTC.
5. « Gérer mon abonnement » ouvre le portail : change de carte, télécharge une facture, puis annule. De retour, l'écran affiche « Fin de l'abonnement » et sa date. Renonce à l'annulation depuis le portail : le prochain prélèvement revient.
6. La fin de période : `stripe subscriptions cancel <sub_…>` (ou une [test clock](https://docs.stripe.com/billing/testing/test-clocks) avancée d'un mois) envoie `customer.subscription.deleted`, et le compte repasse en Free, sans perdre aucune donnée. Avec plus de 3 véhicules, chaque écran mène alors au choix des 3 véhicules actifs, sauf les écrans Abonnement et Compte.
7. L'échec de paiement, avec une [test clock](https://docs.stripe.com/billing/testing/test-clocks) : crée un client rattaché à l'horloge, abonne-le en Pro, puis remplace sa carte par `4000 0000 0000 0341` (elle s'enregistre, mais tout prélèvement échoue). Avance l'horloge d'un mois : le renouvellement échoue, le bandeau « Le paiement de votre abonnement Pro a échoué » s'affiche, avec la date limite, et un seul email arrive dans Mailpit. « Mettre à jour ma carte » ouvre le portail : remets `4242 4242 4242 4242` et règle la facture, le bandeau disparaît.
8. Le retour en Free après l'impayé : refais échouer un renouvellement. La tâche compare la date limite à la date réelle, et non à celle de l'horloge : recule `paiement_echoue_le` de 8 jours dans la base locale (Studio, table `entreprise`), puis lance la tâche à la main, `curl -H "Authorization: Bearer cron-local" http://127.0.0.1:3000/api/cron/impayes`. L'abonnement est annulé, sa facture annulée (void), et le compte repasse en Free.
9. La suppression de compte : passe un compte en Pro avec `4242 4242 4242 4242`, puis avatar › « Mon compte » › « Supprimer le compte », et recopie la raison sociale. L'app revient sur la connexion, avec « Votre compte a été supprimé ». Dans le Dashboard, l'abonnement est annulé, avec le commentaire « Suppression du compte Désigno. », et le client garde ses factures. Le relais montre `customer.subscription.deleted` suivi de `<-- [200]` : le webhook l'ignore, car le client n'a plus d'entreprise. Redemande un lien avec le même email : il arrive dans Mailpit, et ouvre un compte vierge, avec la liste de démarrage.

## 11. Composio (relève Gmail et rappels Google Calendar)

La relève Gmail passe par Composio : le gestionnaire y connecte sa boîte, un déclencheur interroge Gmail toutes les 15 minutes sur le libellé choisi, et Composio appelle le webhook de Désigno à chaque nouvel email. Les rappels Google Calendar aussi : le gestionnaire y connecte son compte Google, puis Désigno écrit dans l'agenda « Désigno » par le proxy de Composio, sans déclencheur. Un projet Composio n'a qu'un abonnement webhook : garde un projet pour le développement (son webhook vise un tunnel) et un autre pour la production.

1. **Le projet et la clé**. Crée un compte sur [dashboard.composio.dev](https://dashboard.composio.dev), puis un projet. Dans Project settings › API Keys, crée une clé de projet ; si des permissions sont proposées, coche Auth configs, Connected accounts, Triggers, Webhook subscriptions et **Proxy execute** (les pièces jointes se téléchargent par le proxy). Mets-la dans `.env.development.local` (`COMPOSIO_API_KEY=…`) pour les étapes suivantes, et dans `COMPOSIO_API_KEY` (Vercel) pour la production.
2. **L'auth config Gmail** :

   ```bash
   npm run composio -- config
   ```

   Le script crée, ou retrouve, l'auth config « Désigno Gmail », gérée par Composio, avec le seul scope `https://www.googleapis.com/auth/gmail.readonly` : Désigno ne peut rien envoyer depuis la boîte, ni la modifier. Son id `ac_…` va dans `COMPOSIO_AUTH_CONFIG_GMAIL`.
3. **L'auth config de l'agenda** :

   ```bash
   npm run composio -- config-agenda
   ```

   Le script crée, ou retrouve, l'auth config « Désigno Agenda » (toolkit `googlecalendar`), gérée par Composio, avec les seuls scopes `https://www.googleapis.com/auth/calendar.app.created` et `https://www.googleapis.com/auth/userinfo.email` : Désigno ne voit que l'agenda qu'il crée, et l'adresse du compte. Son id `ac_…` va dans `COMPOSIO_AUTH_CONFIG_AGENDA`. La clé de projet sert aux deux : la permission **Proxy execute**, déjà cochée pour Gmail, suffit aux écritures dans l'agenda. Si l'app OAuth de Composio refuse `calendar.app.created`, la connexion échoue : il faut alors repasser au scope `calendar` (voir les risques du PLAN).
4. **Le webhook** :

   ```bash
   npm run composio -- webhook https://<projet>.vercel.app/api/webhooks/composio
   ```

   Le script abonne le projet aux événements V3 `composio.trigger.message` et `composio.connected_account.expired`, et affiche le secret de signature : il va dans `COMPOSIO_WEBHOOK_SECRET` (Vercel). Relancé, il met à jour l'abonnement en place : recopie le secret qu'il affiche. Un compte de l'agenda qui expire arrive par le même événement : les rappels sont alors interrompus, sans email.
5. **Avant l'ouverture publique**. L'app OAuth gérée par Composio suffit au développement et à la bêta. Le scope `gmail.readonly` est restreint : il faut ensuite un client OAuth Désigno branché dans Composio, puis la vérification Google et son audit CASA (voir les risques du PLAN).

Ne mets jamais `COMPOSIO_WEBHOOK_SECRET` dans `.env.development.local` : il y masquerait la valeur fixe `composio-local` de `.env.local`, avec laquelle les tests signent leurs événements.

### Recette de la relève Gmail

La CI simule Composio avec des événements signés. Le vrai parcours se vérifie à la main, avec une boîte Gmail de test et un projet Composio de développement :

1. Expose l'app locale par un tunnel, par exemple `cloudflared tunnel --url http://127.0.0.1:3000`, puis abonne le projet de développement à son adresse : `npm run composio -- webhook https://<tunnel>/api/webhooks/composio`. Lance l'app avec le secret affiché :

   ```bash
   COMPOSIO_WEBHOOK_SECRET=<secret> npm run dev
   ```

2. Sur un compte Pro, Intégrations › « Connecter Gmail », choisis la boîte de test, puis un libellé créé dans Gmail (par exemple « Avis »).
3. Envoie-toi un email avec un avis en PDF, et range-le dans le libellé : en moins de 20 minutes, l'avis « À traiter » apparaît, lu, avec le bloc « Reçu par Gmail ».
4. Un email avec une photo HEIC apparaît dans « Emails non exploitables », avec son motif. « Déposer manuellement » convertit la photo, et l'avis déposé porte le bloc « Reçu par Gmail ».
5. Renvoie le même avis : aucun second avis n'est créé.
6. Retire l'accès de Désigno dans le compte Google (myaccount.google.com › Sécurité › Applications tierces) : à la relève suivante, le bandeau rouge s'affiche sur tous les écrans, et un seul email arrive dans Mailpit. « Reconnecter Gmail » fait disparaître le bandeau, et l'écran Intégrations rappelle que les emails de la coupure ne sont pas rattrapés.
7. Repasse le compte en Free (`stripe subscriptions cancel <sub_…>`, ou `plan` à `free` dans Studio) : la relève est en pause, sans bandeau. Repasse en Pro : elle reprend pour les emails suivants.

### Recette des rappels Google Calendar

La CI simule l'agenda. Le vrai parcours se vérifie à la main, avec un compte Google de test et le projet Composio de développement. `COMPOSIO_AUTH_CONFIG_AGENDA` est dans `.env.development.local` (étape 3 ci-dessus) ; le tunnel et le webhook de la recette Gmail ne servent qu'à l'étape 6.

1. Sur un compte Pro qui a deux ou trois avis ouverts avec une date d'envoi, Intégrations › « Connecter Google Calendar », puis choisis le compte de test. Google ne demande que l'accès aux agendas créés par l'app : si la page refuse le scope, note-le et repasse à `calendar` (PLAN, risques). De retour sur l'écran Intégrations, la carte montre le compte, l'agenda « Désigno » et « Rappels actifs depuis le … ».
2. Dans Google Calendar, l'agenda « Désigno » apparaît, avec un événement sur la journée à J-2 de chaque échéance, « Désigner – AB-123-CD – avant le 18/11 ». Il n'occupe pas la journée, et sa description donne le lien vers l'avis. Aucun autre agenda n'a changé.
3. Corrige la date d'envoi d'un avis : son événement se déplace. Désigne-le (ou classe-le) : l'événement disparaît. Rouvre-le : il revient.
4. Supprime un événement à la main dans Google, puis change l'échéance de son avis : il revient, à la nouvelle date.
5. Repasse le compte en Free (`plan` à `free` dans Studio) : la carte dit « Rappels en pause ». Classe un avis : son événement disparaît quand même. Ajoute une date d'envoi à un autre : aucun événement n'apparaît. Repasse en Pro, puis lance la tâche à la main (`curl -H "Authorization: Bearer cron-local" http://127.0.0.1:3000/api/cron/agenda`) : l'événement manquant apparaît.
6. Retire l'accès de Désigno dans le compte Google (myaccount.google.com › Sécurité › Applications tierces), puis modifie un avis : la carte affiche « Rappels interrompus depuis le … » et « Reconnecter Google Calendar », sans bandeau ni email. Reconnecte le même compte : l'agenda « Désigno » est repris, sans doublon.
7. « Déconnecter Google Calendar » : l'agenda « Désigno » disparaît du compte Google, et l'application n'y figure plus dans les applications tierces.

## 12. Recette du rapport mensuel

La CI génère le PDF, simule l'envoi et lit l'email dans Mailpit. Le vrai envoi se vérifie en production le 1er du mois, ou à la main avec la tâche.

1. Sur le compte de production (en Pro de test), Paramètres › Direction : saisis l'adresse du compte Resend, seule à recevoir des emails tant que le domaine n'est pas vérifié. L'écran Rapports annonce le prochain rapport, à cette adresse, avec toi en copie.
2. Le 1er du mois vers 8 h (ou après `curl … /api/cron/rapport-mensuel`), l'email « Rapport de flotte – <mois> » arrive au nom de l'entreprise (« <raison sociale> via Désigno »), avec ses 4 chiffres et le PDF `rapport-flotte-AAAA-MM.pdf` en pièce jointe. Répondre à l'email écrit au gestionnaire.
3. Ouvre le PDF : 1 ou 2 pages, les polices de Désigno, la plaque rectangulaire, les échéances dépassées en rouge et les amendes évitées en vert. Copie un n° d'avis ou un SIREN depuis le PDF : le texte collé est exact.
4. Rapports : la ligne du mois dit « Envoyé le … à … », et « Télécharger » rend le même PDF.
5. Relance la tâche : la réponse donne `"envoyes":0`, et aucun second email n'arrive.
