-- Avis de contravention (phase 7). Le gestionnaire dépose un fichier, l'avis est créé « À traiter »,
-- puis il saisit les champs à côté de l'image. Les champs requis, leur cohérence (envoi pas dans le futur,
-- infraction avant l'envoi) et le statut dérivé vivent dans src/lib/avis/regles.ts.
-- Les 4 statuts sont fixés par le PLAN : la phase 7 n'utilise que « à traiter » et « à valider ».
create type public.statut_avis as enum ('a_traiter', 'a_valider', 'designe', 'classe');
create type public.source_avis as enum ('depot', 'gmail');

create table public.avis (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null default public.mon_entreprise_id()
    references public.entreprise (id) on delete cascade,
  -- Filets de sécurité sur les formes normalisées : 10 chiffres, plaque comme celle d'un véhicule.
  numero text check (numero ~ '^[0-9]{10}$'),
  plaque text constraint plaque_normalisee check (
    plaque ~ '^[A-Z]{2}-[0-9]{3}-[A-Z]{2}$'
    or plaque ~ '^[0-9]{1,4}-[A-Z]{1,3}-([0-9]{2}|2A|2B|97[0-9])$'
  ),
  -- Le véhicule qui porte la plaque, archivé compris ; vide = aucun véhicule de la flotte.
  vehicule_id uuid,
  -- Date et heure de l'infraction, saisies à l'heure de Paris.
  infraction_le timestamptz,
  lieu text check (char_length(lieu) <= 200),
  infraction text check (char_length(infraction) <= 200),
  -- L'amende forfaitaire, en centimes.
  montant_centimes integer check (montant_centimes > 0),
  date_envoi date,
  -- Source de vérité de l'échéance : le tri (phase 8) et les alertes (phase 14) la lisent ici.
  echeance date generated always as (date_envoi + 45) stored,
  statut public.statut_avis not null default 'a_traiter',
  source public.source_avis not null default 'depot',
  -- Chemin dans le bucket « avis » : {entreprise_id}/{uuid}.{pdf|jpg|png}. Un fichier = un avis.
  fichier text not null unique,
  fichier_type text not null check (fichier_type in ('application/pdf', 'image/jpeg', 'image/png')),
  fichier_nom text check (char_length(fichier_nom) <= 255),
  depose_le timestamptz not null default now(),
  -- Comme pour une affectation : la clé étrangère composite ne vise que le véhicule de sa propre entreprise
  -- (sa vérification ignore la RLS). Elle est ignorée quand vehicule_id est vide (MATCH SIMPLE), et refuse
  -- la suppression d'un véhicule qui a des avis (23503) : il ne peut qu'être archivé.
  constraint avis_vehicule_fk foreign key (vehicule_id, entreprise_id)
    references public.vehicule (id, entreprise_id),
  -- Le fichier est rangé dans le dossier de l'entreprise de l'avis.
  constraint fichier_dans_dossier check (split_part(fichier, '/', 1) = entreprise_id::text)
);

create index avis_vehicule_id_idx on public.avis (vehicule_id);

alter table public.avis enable row level security;

-- La table est exposée par défaut (auto_expose_new_tables) : on repart de zéro.
-- entreprise_id n'est ni choisi ni modifiable par le client, il vient du default.
-- Pas de suppression : un avis déposé par erreur se classera (phase 12).
revoke all on public.avis from anon, authenticated;
grant select on public.avis to authenticated;
grant insert (fichier, fichier_type, fichier_nom) on public.avis to authenticated;
grant update (
  numero, plaque, vehicule_id, infraction_le, lieu, infraction, montant_centimes, date_envoi, statut
) on public.avis to authenticated;

create policy "Le gestionnaire voit les avis de son entreprise"
  on public.avis for select
  to authenticated
  using (entreprise_id = (select public.mon_entreprise_id()));

create policy "Le gestionnaire ajoute un avis à son entreprise"
  on public.avis for insert
  to authenticated
  with check (entreprise_id = (select public.mon_entreprise_id()));

create policy "Le gestionnaire modifie les avis de son entreprise"
  on public.avis for update
  to authenticated
  using (entreprise_id = (select public.mon_entreprise_id()))
  with check (entreprise_id = (select public.mon_entreprise_id()));

-- Fichiers des avis : un bucket privé, créé ici plutôt que dans config.toml, car la CI ne fait pas de
-- `config push`. Le HEIC est converti en JPEG dans le navigateur : seuls PDF, JPEG et PNG sont stockés.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avis', 'avis', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png']);

-- Le navigateur envoie le fichier directement au bucket (une server action est limitée à 1 Mo),
-- dans le dossier de son entreprise. Ni remplacement ni suppression : la suppression de compte
-- (phase 20) videra le dossier {entreprise_id}/, fichiers orphelins compris.
create policy "Le gestionnaire dépose un avis dans le dossier de son entreprise"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avis'
    and (storage.foldername(name))[1] = (select public.mon_entreprise_id())::text
  );

create policy "Le gestionnaire lit les avis du dossier de son entreprise"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'avis'
    and (storage.foldername(name))[1] = (select public.mon_entreprise_id())::text
  );
