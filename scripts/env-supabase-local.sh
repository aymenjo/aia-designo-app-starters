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
