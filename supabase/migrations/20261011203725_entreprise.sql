-- Une entreprise par gestionnaire, créée à son premier login.
-- Les champs de la fiche (raison sociale, SIREN…) arrivent en phase 2.
create table public.entreprise (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.entreprise enable row level security;

grant select on public.entreprise to authenticated;

create policy "Le gestionnaire voit son entreprise"
  on public.entreprise for select
  to authenticated
  using (user_id = (select auth.uid()));

-- Modèle RLS « par entreprise » des tables suivantes :
--   using (entreprise_id = (select public.mon_entreprise_id()))
create function public.mon_entreprise_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.entreprise where user_id = (select auth.uid())
$$;

revoke execute on function public.mon_entreprise_id() from public, anon;
grant execute on function public.mon_entreprise_id() to authenticated;

-- L'inscription se fait par la connexion : chaque nouvel utilisateur reçoit
-- son entreprise dans la même transaction. La suppression suit par cascade.
create function public.creer_entreprise()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.entreprise (user_id) values (new.id);
  return new;
end;
$$;

revoke execute on function public.creer_entreprise() from public, anon, authenticated;

create trigger creer_entreprise
  after insert on auth.users
  for each row execute function public.creer_entreprise();
