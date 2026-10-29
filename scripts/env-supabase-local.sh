#!/usr/bin/env bash
# Variables d'environnement de l'app pour le Supabase local (`npx supabase start`).
# Local : npm run env:local (écrit .env.local). CI : ajouté à $GITHUB_ENV.
set -euo pipefail

npx supabase status -o env \
  --override-name api.url=NEXT_PUBLIC_SUPABASE_URL \
  --override-name auth.publishable_key=NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \
  --override-name auth.secret_key=SUPABASE_SECRET_KEY \
  --override-name mailpit.url=MAILPIT_URL \
  2>/dev/null \
  | grep -E '^(NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY|SUPABASE_SECRET_KEY|MAILPIT_URL)=' \
  | sed -E 's/^([A-Z_]+)="(.*)"$/\1=\2/'
# Le secret des tâches planifiées (/api/cron/*) : une valeur fixe en local et en CI, lue par le serveur et les E2E.
echo "CRON_SECRET=cron-local"
# Le secret de signature du webhook Stripe (/api/webhooks/stripe) : une valeur fixe en local et en CI, avec laquelle les
# tests signent les événements simulés. La recette avec la Stripe CLI le remplace au lancement de `next dev`.
echo "STRIPE_WEBHOOK_SECRET=whsec_local"
# Le secret de signature du webhook Composio (/api/webhooks/composio), sur le même modèle. La recette avec un tunnel le
# remplace au lancement de `next dev`.
echo "COMPOSIO_WEBHOOK_SECRET=composio-local"
