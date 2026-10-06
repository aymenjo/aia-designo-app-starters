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

Le cadrage et le plan d'implémentation sont terminés. **Le développement n'a pas encore commencé** : la prochaine étape est la phase 1 (socle, inscription et connexion par lien magique).

| Phases | Bloc |
|---|---|
| 1–2 | Socle : connexion par lien magique, fiche entreprise |
| 3–6 | Flotte : véhicules, conducteurs, affectations et planning, import CSV |
| 7–13 | Avis et désignation : dépôt, lecture IA, proposition du conducteur, récap ANTAI |
| 14–16 | Suivi : alertes email, tableau de bord, landing page |
| 17–20 | Abonnement : quotas Free, passage en Pro, retour en Free, suppression de compte |
| 21–25 | Fonctions Pro : email au conducteur, Google Calendar, relève Gmail, export CSV, rapport mensuel |
| 26–32 | Demande à Désigno : questions, limite mensuelle, récapitulatifs de modifications, refus hors rôle, historique |

Le détail de chaque phase (user stories, livrable, critères d'acceptation, dépendances) est dans [`docs/PLAN.md`](docs/PLAN.md).

## Stack prévue

- **Application** : Next.js (TypeScript), hébergée sur Vercel, avec les tâches planifiées Vercel (alertes, rapport mensuel, purge des conversations)
- **Données** : Supabase (Postgres, Auth, Storage), isolation par entreprise avec RLS
- **Paiement** : Stripe (Checkout, Billing, factures, portail client)
- **Emails** : Resend, y compris le lien de connexion via le SMTP Supabase
- **Lecture des avis** : API Claude (vision, sortie structurée avec confiance par champ)
- **Gmail et Google Calendar** : Composio
- **Demande à Désigno** : Claude Managed Agents, sans outils intégrés, avec uniquement des outils définis et exécutés par Désigno

## Conventions

- **Langue** : tout le produit est en français, pour la France uniquement. Dates au format JJ/MM/AAAA, heures sur 24 h, montants au format « 135,00 € ».
- **Nommage** : vocabulaire français du métier pour les routes, tables, colonnes et statuts, sans accents dans le code (`avis`, `conducteur`, `affectation`, `a_traiter`). Le vocabulaire technique reste en anglais (`session`, `webhook`, `cron`).
- **Règles métier** : les règles d'écriture de la flotte (plaque, permis, chevauchement, limites Free) sont définies une seule fois côté serveur et partagées par les écrans, l'import CSV et l'agent.
- **Tests** : tests unitaires des règles métier, et un test E2E par phase sur son parcours démontrable.

## Documentation

- [`docs/PRD.md`](docs/PRD.md) : problème, utilisateur cible, 83 user stories, critères de succès, hors périmètre et décisions d'implémentation
- [`docs/PLAN.md`](docs/PLAN.md) : décisions architecturales, risques ouverts et découpage en 32 phases livrables

## Risques ouverts

- La liste exacte des champs du formulaire de désignation ANTAI reste à vérifier sur un vrai avis.
- Beaucoup d'avis électroniques de l'ANTAI arrivent sous forme de lien, sans pièce jointe : la relève Gmail ne peut pas les traiter.
- L'information des conducteurs (RGPD) et la durée de conservation des données ne sont pas encore cadrées.
- La lecture Gmail demandera une vérification Google (audit CASA) avant le lancement public.

Le détail est dans la section « Risques et points ouverts » de [`docs/PLAN.md`](docs/PLAN.md).
