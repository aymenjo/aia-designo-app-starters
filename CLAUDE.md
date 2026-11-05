# Désigno
## Stack
Next.js (TypeScript) sur Vercel · Supabase (Postgres, Auth, Storage, RLS) · Stripe · Resend · API Claude et Claude Managed Agents · Composio (Gmail, Calendar) · Tailwind v4.
## Documents projet
Toujours lire ces documents avant de coder :
- @docs/PRD.md — pourquoi et quoi du produit
- @docs/PLAN.md — phases d'implémentation et user stories
- @docs/DESIGN.md — système design et direction visuelle
## Système design
Toujours lire DESIGN.md avant toute décision visuelle ou UI.
Polices, couleurs, espacements et direction esthétique y sont définis.
Ne pas dévier sans validation explicite.
En mode QA, signaler tout code qui ne respecte pas DESIGN.md.
## Conventions
- Code en vocabulaire métier français sans accents (`avis`, `affectation`, `a_traiter`) ; termes techniques en anglais (`webhook`, `cron`, `session`).
- Règles d'écriture de la flotte, champs requis et messages d'erreur : définis une seule fois côté serveur, réutilisés par les écrans, l'import CSV et l'agent.
- Rien d'automatique : `designe` seulement au clic du gestionnaire ; l'agent ne fait que proposer, et « Confirmer » applique tout ou rien. Un refus de l'agent repose sur l'absence d'outil, pas sur une consigne.
- Toute nouvelle donnée ou connexion externe doit être prise en compte par la suppression de compte (phase 20) et le retour en Free (phase 19).
## Commandes utiles
- `npx supabase …` : la CLI Supabase est une dépendance locale du repo, pas une installation globale.
- `/cadre` puis `/planifie` (mode extension) : tout changement de périmètre met à jour le PRD puis le PLAN avant le code.
## Jargon métier
- **Avis** : l'avis de contravention. **Désigner** : déclarer le conducteur sur le site de l'ANTAI dans les 45 jours qui suivent la date d'envoi, sous peine d'une amende de 675 €.
- **Affectation** : qui conduit quel véhicule, et de quand à quand. Un véhicule est **attitré** (fin vide) ou de **pool** (fin obligatoire).
- **Récap ANTAI** ≠ **récapitulatif** : le premier se recopie sur l'ANTAI, le second liste les modifications proposées par l'agent.
