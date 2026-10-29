-- Rapport mensuel PDF (phase 25, Pro). Le 1er du mois, ou le premier matin qui suit, la tâche /api/cron/rapport-mensuel
-- produit le bilan de flotte du mois écoulé, le fige dans le bucket `rapports` et l'envoie aux adresses « direction »,
-- avec le gestionnaire en copie. Les chiffres et les règles vivent dans src/lib/rapport/, les règles de saisie des
-- adresses dans src/lib/entreprise/regles.ts.

-- Les adresses « direction » : sans compte, elles reçoivent le rapport. Le gestionnaire les saisit dans la fiche
-- entreprise ; elles n'entrent pas dans « fiche complète ». Filet de sécurité sur la forme enregistrée par l'écran.
create function public.emails_direction_valides(emails text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select cardinality(emails) <= 3
    and array_position(emails, null) is null
    and (select count(distinct email) from unnest(emails) as email) = cardinality(emails)
    and coalesce(
      (select bool_and(char_length(email) <= 254 and email = lower(email) and email like '_%@_%') from unnest(emails) as email),
      true
    )
$$;

alter table public.entreprise
  add column emails_direction text[] not null default '{}',
  add constraint emails_direction_valides check (public.emails_direction_valides(emails_direction));

grant update (emails_direction) on public.entreprise to authenticated;

-- Un rapport par entreprise et par mois, figé à sa génération : le téléchargement rend le fichier envoyé.
create table public.rapport_mensuel (
  -- La cascade suit l'entreprise ; le fichier, lui, est effacé par la suppression de compte (phase 20).
  entreprise_id uuid not null references public.entreprise (id) on delete cascade,
  -- Le mois du rapport, par son 1er jour.
  mois date not null check (extract(day from mois) = 1),
  -- Le PDF dans le bucket `rapports`, à un chemin fixe : régénérer le même mois remplace le même fichier.
  fichier text not null,
  genere_le timestamptz not null default now(),
  -- L'email parti : vides tant qu'il n'est pas parti. L'envoi est réservé en datant `envoye_le`, puis libéré s'il échoue.
  envoye_le timestamptz,
  -- Les adresses en « À », puis le gestionnaire en « Cc » : à qui le rapport est parti.
  envoye_a text[],
  primary key (entreprise_id, mois),
  constraint fichier_du_mois check (fichier = entreprise_id::text || '/' || to_char(mois, 'YYYY-MM') || '.pdf'),
  constraint envoi_date check ((envoye_le is null) = (envoye_a is null))
);

-- Le gestionnaire lit les rapports de son entreprise ; seul le serveur les écrit, avec la clé secrète.
alter table public.rapport_mensuel enable row level security;
revoke all on public.rapport_mensuel from anon, authenticated;
grant select on public.rapport_mensuel to authenticated;

create policy "Le gestionnaire voit les rapports de son entreprise"
  on public.rapport_mensuel for select
  to authenticated
  using (entreprise_id = (select public.mon_entreprise_id()));

-- Les PDF des rapports : un bucket privé, créé ici comme celui des avis, car la CI ne fait pas de `config push`.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('rapports', 'rapports', false, 5242880, array['application/pdf']);

-- Le gestionnaire télécharge les rapports du dossier de son entreprise. Aucune écriture sous sa session : la tâche dépose
-- les fichiers avec la clé secrète, et la suppression de compte (phase 20) vide le dossier {entreprise_id}/.
create policy "Le gestionnaire lit les rapports du dossier de son entreprise"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'rapports'
    and (storage.foldername(name))[1] = (select public.mon_entreprise_id())::text
  );
