# Désigno

**Ne laissez plus jamais filer une échéance de désignation.**

Désigno aide les PME à désigner le conducteur d'un véhicule d'entreprise flashé, dans les 45 jours, sans y passer plus de quelques minutes par avis. Un oubli coûte l'amende initiale plus 675 € d'amende pour non-désignation.

## Le problème

Quand un véhicule d'entreprise est flashé, l'avis de contravention arrive au nom de la société. Dans une PME de 10 à 50 salariés qui fait rouler 5 à 30 utilitaires, c'est l'office manager qui s'en charge, entre deux autres dossiers. Il ou elle doit retrouver qui conduisait ce jour-là, puis reporter sans erreur l'identité et le permis du conducteur sur le site de l'ANTAI. Rien ne prévient quand l'échéance approche.

## Comment ça marche

1. **Transférez vos avis** : photo, scan, ou relève automatique d'un libellé Gmail (Pro).
2. **L'IA les lit** : les champs de l'avis sont pré-remplis, avec un niveau de confiance par champ, et l'échéance des 45 jours est calculée.
3. **Désigno retrouve le conducteur** à partir du planning des affectations. Le gestionnaire le valide lui-même.
4. **Vous désignez sur l'ANTAI, sans oubli** : un récap avec un bouton « Copier » par champ, des alertes à J-15, J-7 et J-2, et un rappel Google Calendar (Pro).

Avec **Demande à Désigno** (Pro), le gestionnaire pose une question ou décrit un changement en une phrase, depuis n'importe quel écran : « Qui avait AB-123-CD le 12/03 à 8 h ? », « Karim part vendredi, passe son camion à Léa ». L'agent cite ses sources et ne modifie rien avant un clic sur « Confirmer ».

### Deux principes non négociables

- **Désigno ne désigne jamais à la place du gestionnaire.** Il ne transmet rien à l'ANTAI et ne valide jamais un conducteur automatiquement.
- **Rien ne change sans accord explicite.** Les modifications proposées par l'agent sont appliquées toutes ou aucune, après « Confirmer ».

## Offres

| | Free | Pro |
|---|---|---|
| Prix | 0 € | 49 € HT/mois (58,80 € TTC) |
| Véhicules | 3 actifs | Illimités |
| Avis | 5 par mois | Illimités |
| Historique | 3 mois | Complet |
| Relève Gmail, rappels Google Calendar | — | ✓ |
| Email au conducteur, export CSV, rapport mensuel PDF | — | ✓ |
| Demande à Désigno | — | 100 demandes/mois |

Une seule amende de non-désignation évitée (675 €) paie plus d'un an de Pro (588 € HT).

## État du projet

**Phases 1 à 25 terminées.** La production tourne sur https://aia-designo-app.vercel.app. Elle est réservée pour l'instant à l'adresse du compte Resend, et le paiement y passe par le mode test de Stripe : aucune carte n'est réellement débitée.

| Phases | Bloc | État |
|---|---|---|
| 1–2 | Socle : connexion par lien magique, fiche entreprise | Terminé |
| 3–6 | Flotte : véhicules, conducteurs, affectations et planning, import CSV | Terminé |
| 7–13 | Avis et désignation : dépôt, lecture IA, proposition du conducteur, récap ANTAI | Terminé, sauf la mesure de la lecture IA sur 20 avis réels (phase 9) |
| 14–16 | Suivi : alertes email, tableau de bord, landing page | Terminé |
| 17–20 | Abonnement : quotas Free, passage en Pro, échec de paiement et retour en Free, suppression de compte | Terminé |
| 21–25 | Fonctions Pro : email au conducteur, Google Calendar, relève Gmail, export CSV, rapport mensuel | Terminé, sauf deux vérifications en production : la réponse du conducteur (phase 21) et le premier envoi réel du rapport, le 01/11/2026 (phase 25) |
| 26–32 | Demande à Désigno : questions, limite mensuelle, récapitulatifs de modifications, refus hors rôle, historique | À venir |

La prochaine étape est la phase 26 (Demande à Désigno : question et réponse citée). Restent aussi à vérifier en production que la réponse du conducteur à son email arrive chez le gestionnaire (phase 21), et que le rapport du 01/11/2026 part bien (phase 25, recette dans [`docs/DEPLOIEMENT.md`](docs/DEPLOIEMENT.md)).

Le détail de chaque phase (user stories, livrable, critères d'acceptation, dépendances) est dans [`docs/PLAN.md`](docs/PLAN.md).

## Stack

- **Application** : Next.js (TypeScript), hébergée sur Vercel, avec les tâches planifiées Vercel (alertes, déverrouillage des avis Free, impayés, agendas Google, rapport mensuel, purge des conversations)
- **Données** : Supabase (Postgres, Auth, Storage), isolation par entreprise avec RLS
- **Paiement** : Stripe (Checkout, Billing, factures, portail client)
- **Emails** : Resend, y compris le lien de connexion via le SMTP Supabase (en mode test tant qu'il n'y a pas de domaine : seule l'adresse du compte Resend reçoit les emails)
- **Lecture des avis** : API Claude (vision, sortie structurée avec confiance par champ)
- **Gmail et Google Calendar** : Composio
- **Demande à Désigno** : Claude Managed Agents, sans outils intégrés, avec uniquement des outils définis et exécutés par Désigno

## Développer en local

Prérequis : Node 24 et Docker (OrbStack sur macOS).

```bash
npm install
npx supabase start     # Postgres, Auth et Mailpit en local, migrations appliquées
npm run env:local      # écrit .env.local avec les clés du Supabase local
npm run dev            # http://127.0.0.1:3000
```

Les emails (liens de connexion, alertes, factures) arrivent dans Mailpit : http://127.0.0.1:54324. Pour lancer à la main la tâche des alertes J-15, J-7, J-2 : `curl -H "Authorization: Bearer cron-local" http://127.0.0.1:3000/api/cron/alertes`.

La lecture IA des avis est facultative en local. Sans clé d'API, l'avis déposé se saisit à la main. Pour l'activer, mets `ANTHROPIC_API_KEY` dans `.env.development.local` (voir `.env.example`).

La relève Gmail est facultative aussi. Sans clé Composio, « Connecter Gmail » est indisponible, et les tests simulent Composio avec des événements signés. Pour relever une vraie boîte, mets `COMPOSIO_API_KEY` et `COMPOSIO_AUTH_CONFIG_GMAIL` dans `.env.development.local`, puis suis la recette de [`docs/DEPLOIEMENT.md`](docs/DEPLOIEMENT.md) (section « Composio »). Les rappels Google Calendar demandent en plus `COMPOSIO_AUTH_CONFIG_AGENDA` (`npm run composio -- config-agenda`) : sans elle, aucune synchronisation ne part.

Le paiement Stripe est facultatif aussi. Sans clé, « Passer en Pro » est indisponible, et les tests simulent Stripe avec des événements signés. Pour payer en mode test, mets `STRIPE_SECRET_KEY=sk_test_…` dans `.env.development.local`, lance `npm run stripe:config`, puis suis la recette de [`docs/DEPLOIEMENT.md`](docs/DEPLOIEMENT.md) (section « Recette en mode test »).

| Commande | Rôle |
|---|---|
| `npm run lint` · `npm run typecheck` | Qualité du code |
| `npm run test:unit` | Règles métier (Vitest) |
| `npm run test:integration` | RLS et base, sur le Supabase local |
| `npm run test:e2e` | Parcours complets (Playwright), sur le Supabase local |
| `npm run stripe:config` | Produit, prix, TVA et portail client Stripe, en test ou en live, sans doublon ([`docs/DEPLOIEMENT.md`](docs/DEPLOIEMENT.md)) |
| `npm run composio -- <commande>` | Auth configs Gmail et agenda, abonnement webhook et essais de la relève sur une vraie boîte (`scripts/composio-essai.mts`) |
| `npm run eval:lecture` | Justesse de la lecture IA sur de vrais avis, hors CI ([`evaluation/LISEZMOI.md`](evaluation/LISEZMOI.md)) |
| `npx supabase migration new <nom>` | Nouvelle migration dans `supabase/migrations/` |

Chaque push sur `main` lance la CI (`.github/workflows/ci.yml`) : lint, types, tests unitaires, d'intégration et E2E sur un Supabase local, puis `supabase db push`. Vercel, connecté au dépôt, ne met la version en production qu'une fois ce job vert (Deployment Checks). Sans la variable de dépôt `SUPABASE_PROJECT_REF`, les migrations sont sautées et la CI reste verte. Pour brancher une copie du dépôt sur son propre Supabase et son propre Vercel : [`docs/DEPLOIEMENT.md`](docs/DEPLOIEMENT.md).

## Conventions

- **Langue** : tout le produit est en français, pour la France uniquement. Dates au format JJ/MM/AAAA, heures sur 24 h, montants au format « 135,00 € ».
- **Nommage** : vocabulaire français du métier pour les routes, tables, colonnes et statuts, sans accents dans le code (`avis`, `conducteur`, `affectation`, `a_traiter`). Le vocabulaire technique reste en anglais (`session`, `webhook`, `cron`).
- **Règles métier** : les règles d'écriture de la flotte (plaque, permis, chevauchement, limites Free) sont définies une seule fois côté serveur et partagées par les écrans, l'import CSV et l'agent.
- **Tests** : tests unitaires des règles métier, et un test E2E par phase sur son parcours démontrable.

## Documentation

- [`docs/PRD.md`](docs/PRD.md) : problème, utilisateur cible, 83 user stories, critères de succès, hors périmètre et décisions d'implémentation
- [`docs/PLAN.md`](docs/PLAN.md) : décisions architecturales, risques ouverts et découpage en 32 phases livrables
- [`docs/DESIGN.md`](docs/DESIGN.md) : système design (typographie, couleurs, composants), avec son rendu de référence `docs/design-preview.html`

## Risques ouverts

- La liste exacte des champs du formulaire de désignation ANTAI reste à vérifier sur un vrai avis.
- Beaucoup d'avis électroniques de l'ANTAI arrivent sous forme de lien, sans pièce jointe : la relève Gmail ne peut pas les traiter.
- L'information des conducteurs (RGPD) et la durée de conservation des données ne sont pas encore cadrées.
- La lecture Gmail demandera une vérification Google (audit CASA) avant le lancement public.

Le détail est dans la section « Risques et points ouverts » de [`docs/PLAN.md`](docs/PLAN.md).
