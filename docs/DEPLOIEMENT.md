# Mettre ta copie en production

Ce guide part d'une copie du dépôt poussée sur ton propre GitHub. À la fin, chaque push sur `main` est testé, les migrations sont appliquées sur ton Supabase, et Vercel sert l'application sur ton adresse.

## 1. Prérequis

- Node 24 et Docker (OrbStack sur macOS).
- La CLI GitHub `gh`, connectée à ton compte (`gh auth login`).
- Un compte Supabase, un compte Vercel et un compte Resend (pour les emails de connexion et les alertes).
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

   `SUPABASE_SECRET_KEY` contourne la RLS : elle ne sert que côté serveur (`src/lib/supabase/admin.ts`), jamais dans le navigateur. Aucune de ces clés ne va dans GitHub : la CI tourne sur un Supabase local, avec Mailpit et un `CRON_SECRET` fixe.
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
