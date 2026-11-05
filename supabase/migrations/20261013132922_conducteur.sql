-- Conducteurs de la flotte (phase 4). Comme un véhicule, un conducteur n'est jamais supprimé :
-- il est archivé (archive_le), puis peut être réactivé depuis sa fiche.
-- Seuls le prénom et le nom sont obligatoires : une fiche incomplète s'enregistre. La liste des
-- champs requis et les règles fines (dates vraisemblables, catégories) vivent dans src/lib/flotte/regles.ts.
create type public.civilite as enum ('m', 'mme');

create table public.conducteur (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null default public.mon_entreprise_id()
    references public.entreprise (id) on delete cascade,
  civilite public.civilite,
  prenom text not null check (btrim(prenom) <> '' and char_length(prenom) <= 80),
  nom text not null check (btrim(nom) <> '' and char_length(nom) <= 80),
  date_naissance date check (date_naissance >= '1900-01-01'),
  lieu_naissance text check (char_length(lieu_naissance) <= 80),
  adresse text check (char_length(adresse) <= 120),
  adresse_complement text check (char_length(adresse_complement) <= 120),
  code_postal text check (code_postal ~ '^[0-9]{5}$'),
  ville text check (char_length(ville) <= 80),
  -- Filets de sécurité sur les formes normalisées : sans espaces, en majuscules, en minuscules.
  permis_numero text check (permis_numero ~ '^[A-Z0-9]{1,20}$'),
  permis_delivre_le date,
  permis_categories text[] check (
    permis_categories <@ array['AM', 'A1', 'A2', 'A', 'B1', 'B', 'BE', 'C1', 'C1E', 'C', 'CE', 'D1', 'D1E', 'D', 'DE']
  ),
  email text check (char_length(email) <= 254 and email = lower(email)),
  archive_le timestamptz,
  created_at timestamptz not null default now(),
  -- Archivés compris : ressaisir le permis ou l'email d'un conducteur archivé renvoie vers sa fiche.
  -- Nommées : l'écriture reconnaît la contrainte violée pour donner le bon message.
  constraint conducteur_permis_unique unique (entreprise_id, permis_numero),
  constraint conducteur_email_unique unique (entreprise_id, email),
  -- Le permis le plus précoce (AM) se passe à 14 ans.
  constraint delivrance_apres_naissance check (permis_delivre_le >= date_naissance + interval '14 years')
);

alter table public.conducteur enable row level security;

-- La table est exposée par défaut (auto_expose_new_tables) : on repart de zéro.
-- entreprise_id n'est ni choisi ni modifiable par le client, il vient du default. Pas de suppression.
revoke all on public.conducteur from anon, authenticated;
grant select on public.conducteur to authenticated;
grant insert (
  civilite, prenom, nom, date_naissance, lieu_naissance,
  adresse, adresse_complement, code_postal, ville,
  permis_numero, permis_delivre_le, permis_categories, email
) on public.conducteur to authenticated;
grant update (
  civilite, prenom, nom, date_naissance, lieu_naissance,
  adresse, adresse_complement, code_postal, ville,
  permis_numero, permis_delivre_le, permis_categories, email,
  archive_le
) on public.conducteur to authenticated;

create policy "Le gestionnaire voit les conducteurs de son entreprise"
  on public.conducteur for select
  to authenticated
  using (entreprise_id = (select public.mon_entreprise_id()));

create policy "Le gestionnaire ajoute un conducteur à son entreprise"
  on public.conducteur for insert
  to authenticated
  with check (entreprise_id = (select public.mon_entreprise_id()));

create policy "Le gestionnaire modifie les conducteurs de son entreprise"
  on public.conducteur for update
  to authenticated
  using (entreprise_id = (select public.mon_entreprise_id()))
  with check (entreprise_id = (select public.mon_entreprise_id()));
