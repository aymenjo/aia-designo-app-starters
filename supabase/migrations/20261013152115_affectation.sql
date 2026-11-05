-- Affectations (phase 5) : qui conduit quel véhicule, et de quand à quand.
-- Une fin vide = le conducteur garde le véhicule. Les règles fines (fin obligatoire sur un véhicule
-- de pool, heure facultative) et leurs messages vivent dans src/lib/flotte/regles.ts.
create extension if not exists btree_gist with schema extensions;

-- Cibles des clés étrangères composites : une affectation ne vise que le véhicule ou le conducteur
-- de sa propre entreprise. La vérification d'une clé étrangère ignore la RLS : sans le composite,
-- un gestionnaire pourrait viser l'id d'une autre entreprise.
alter table public.vehicule add constraint vehicule_id_entreprise unique (id, entreprise_id);
alter table public.conducteur add constraint conducteur_id_entreprise unique (id, entreprise_id);

-- Un véhicule ou un conducteur sans historique se supprime. Avec des affectations, la clé
-- étrangère refuse (23503) : il ne peut qu'être archivé.
grant delete on public.vehicule to authenticated;
grant delete on public.conducteur to authenticated;

create policy "Le gestionnaire supprime les véhicules de son entreprise"
  on public.vehicule for delete
  to authenticated
  using (entreprise_id = (select public.mon_entreprise_id()));

create policy "Le gestionnaire supprime les conducteurs de son entreprise"
  on public.conducteur for delete
  to authenticated
  using (entreprise_id = (select public.mon_entreprise_id()));

create table public.affectation (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null default public.mon_entreprise_id()
    references public.entreprise (id) on delete cascade,
  vehicule_id uuid not null,
  conducteur_id uuid not null,
  debut timestamptz not null,
  fin timestamptz,
  created_at timestamptz not null default now(),
  -- NO ACTION, pas RESTRICT : la suppression d'un véhicule qui a un historique est refusée,
  -- mais la cascade depuis l'entreprise (suppression de compte) passe, car elle vide aussi les affectations.
  -- Nommées : l'écriture reconnaît la contrainte violée pour donner le bon message.
  constraint affectation_vehicule_fk foreign key (vehicule_id, entreprise_id)
    references public.vehicule (id, entreprise_id),
  constraint affectation_conducteur_fk foreign key (conducteur_id, entreprise_id)
    references public.conducteur (id, entreprise_id),
  constraint fin_apres_debut check (fin > debut),
  -- Jamais deux conducteurs sur un même véhicule au même instant. Bornes [) : deux affectations
  -- bout à bout ne se chevauchent pas, et une fin vide vaut l'infini. Un même conducteur peut
  -- cumuler plusieurs véhicules.
  constraint affectation_sans_chevauchement exclude using gist (
    vehicule_id with =,
    tstzrange(debut, fin, '[)') with &&
  )
);

-- Le planning filtré par conducteur et ses fiches. Le véhicule est couvert par l'index de l'exclusion.
create index affectation_conducteur_id_idx on public.affectation (conducteur_id);

alter table public.affectation enable row level security;

-- La table est exposée par défaut (auto_expose_new_tables) : on repart de zéro.
-- entreprise_id n'est ni choisi ni modifiable par le client, il vient du default.
-- Pas de suppression : une affectation se clôture, l'historique reste.
revoke all on public.affectation from anon, authenticated;
grant select on public.affectation to authenticated;
grant insert (vehicule_id, conducteur_id, debut, fin) on public.affectation to authenticated;
grant update (vehicule_id, conducteur_id, debut, fin) on public.affectation to authenticated;

create policy "Le gestionnaire voit les affectations de son entreprise"
  on public.affectation for select
  to authenticated
  using (entreprise_id = (select public.mon_entreprise_id()));

create policy "Le gestionnaire ajoute une affectation à son entreprise"
  on public.affectation for insert
  to authenticated
  with check (entreprise_id = (select public.mon_entreprise_id()));

create policy "Le gestionnaire modifie les affectations de son entreprise"
  on public.affectation for update
  to authenticated
  using (entreprise_id = (select public.mon_entreprise_id()))
  with check (entreprise_id = (select public.mon_entreprise_id()));
