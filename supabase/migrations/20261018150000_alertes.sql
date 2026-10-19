-- Alertes email J-15, J-7, J-2 (phase 14). La tâche quotidienne (src/app/api/cron/alertes) réserve ici chaque seuil
-- d'un avis avant d'envoyer l'email : une relance le même jour ne réserve rien, donc n'envoie rien. Le choix des avis
-- (ouverts, échéance sur un seuil du jour) vit dans src/lib/avis/alertes.ts.
create table public.alerte_envoyee (
  -- La cascade suit l'avis, donc l'entreprise : la suppression de compte (phase 20) emporte les alertes.
  avis_id uuid not null references public.avis (id) on delete cascade,
  seuil smallint not null check (seuil in (15, 7, 2)),
  envoyee_le timestamptz not null default now(),
  primary key (avis_id, seuil)
);

-- Seule la tâche y accède, avec la clé secrète : ni le navigateur ni le gestionnaire n'y lisent ou n'y écrivent.
alter table public.alerte_envoyee enable row level security;
revoke all on public.alerte_envoyee from anon, authenticated;
