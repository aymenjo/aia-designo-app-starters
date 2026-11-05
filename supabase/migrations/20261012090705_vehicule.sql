-- Véhicules de la flotte. Un véhicule n'est jamais supprimé en phase 3 :
-- il est archivé (archive_le), puis peut être réactivé depuis sa fiche.
create type public.type_vehicule as enum ('attitre', 'pool');

create table public.vehicule (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null default public.mon_entreprise_id()
    references public.entreprise (id) on delete cascade,
  plaque text not null,
  modele text check (char_length(modele) <= 80),
  type public.type_vehicule not null,
  archive_le timestamptz,
  created_at timestamptz not null default now(),
  -- Archivés compris : ressaisir la plaque d'un véhicule archivé renvoie vers sa fiche.
  unique (entreprise_id, plaque),
  -- Filet de sécurité sur la forme normalisée (AB-123-CD ou 123-ABC-45).
  -- Les règles fines et leurs messages vivent dans src/lib/flotte/regles.ts.
  constraint plaque_normalisee check (
    plaque ~ '^[A-Z]{2}-[0-9]{3}-[A-Z]{2}$'
    or plaque ~ '^[0-9]{1,4}-[A-Z]{1,3}-([0-9]{2}|2A|2B|97[0-9])$'
  )
);

alter table public.vehicule enable row level security;

-- La table est exposée par défaut (auto_expose_new_tables) : on repart de zéro.
-- entreprise_id n'est ni choisi ni modifiable par le client, il vient du default.
revoke all on public.vehicule from anon, authenticated;
grant select on public.vehicule to authenticated;
grant insert (plaque, modele, type) on public.vehicule to authenticated;
grant update (plaque, modele, type, archive_le) on public.vehicule to authenticated;

create policy "Le gestionnaire voit les véhicules de son entreprise"
  on public.vehicule for select
  to authenticated
  using (entreprise_id = (select public.mon_entreprise_id()));

create policy "Le gestionnaire ajoute un véhicule à son entreprise"
  on public.vehicule for insert
  to authenticated
  with check (entreprise_id = (select public.mon_entreprise_id()));

create policy "Le gestionnaire modifie les véhicules de son entreprise"
  on public.vehicule for update
  to authenticated
  using (entreprise_id = (select public.mon_entreprise_id()))
  with check (entreprise_id = (select public.mon_entreprise_id()));
