-- Relève Gmail (phase 23). Le gestionnaire Pro connecte sa boîte Gmail par Composio et choisit un libellé : chaque email
-- qui y arrive est relevé par le webhook (/api/webhooks/composio), et chaque pièce jointe PDF, JPG ou PNG devient un avis.
-- Les emails dont une pièce jointe n'a pas donné d'avis, ou sans pièce jointe, sont « non exploitables ». Les règles et
-- les messages vivent dans src/lib/gmail/regles.ts ; la relève, dans src/lib/gmail/webhook.ts.
--
-- La relève écrit avec la clé secrète : le webhook n'a pas de session. Le gestionnaire lit tout, mais n'écrit que ce que
-- ses écrans demandent : « Ignorer » et « Déposer manuellement » un email non exploitable. La connexion s'écrit côté
-- serveur, avec la clé secrète, une fois le compte vérifié chez Composio (src/lib/gmail/connexion.ts).

-- Les comptes Google connectés par Composio. Gmail d'abord ; l'agenda (phase 22) s'ajoutera à l'énuméré.
create type public.service_google as enum ('gmail');

create table public.connexion_google (
  id uuid primary key default gen_random_uuid(),
  -- La cascade suit l'entreprise ; la révocation chez Composio passe par `deconnecterGmail` (phase 20).
  entreprise_id uuid not null references public.entreprise (id) on delete cascade,
  service public.service_google not null,
  -- Le compte connecté chez Composio (ca_…), dont l'utilisateur Composio est l'id de l'entreprise.
  compte_id text not null unique check (compte_id ~ '^ca_'),
  -- L'adresse de la boîte, lue par l'API Gmail : le lien « Ouvrir dans Gmail » en dépend.
  email_compte text,
  -- Le libellé choisi par le gestionnaire, parmi ceux qu'il a créés : son id Gmail (Label_…) et son nom, pour l'écran.
  libelle_id text,
  libelle_nom text,
  -- Le déclencheur de la relève (ti_…), vide tant que le libellé n'est pas choisi. Un événement d'un autre déclencheur est
  -- ignoré : celui d'avant un changement de libellé ou une reconnexion.
  declencheur_id text unique check (declencheur_id ~ '^ti_'),
  -- La création du déclencheur : seuls les emails arrivés depuis sont relevés.
  active_depuis timestamptz,
  -- La connexion interrompue (compte expiré, ou téléchargement refusé), jusqu'à la reconnexion : le bandeau rouge.
  interrompue_le timestamptz,
  -- L'email au gestionnaire, un seul par interruption : réservé avant l'envoi, libéré s'il échoue.
  interruption_signalee_le timestamptz,
  cree_le timestamptz not null default now(),
  unique (entreprise_id, service),
  constraint libelle_complet check ((libelle_id is null) = (libelle_nom is null)),
  constraint declencheur_sur_libelle check (declencheur_id is null or libelle_id is not null),
  constraint declencheur_date check ((declencheur_id is null) = (active_depuis is null)),
  constraint signalement_interruption check (interruption_signalee_le is null or interrompue_le is not null)
);

alter table public.connexion_google enable row level security;
revoke all on public.connexion_google from anon, authenticated;
grant select on public.connexion_google to authenticated;

create policy "Le gestionnaire voit les connexions de son entreprise"
  on public.connexion_google for select
  to authenticated
  using (entreprise_id = (select public.mon_entreprise_id()));

-- Les emails relevés, un par message Gmail : la référence de l'avis (bloc « Reçu par Gmail »), et la liste « Emails non
-- exploitables ». Le corps de l'email n'est pas stocké.
create type public.etat_email_gmail as enum ('releve', 'non_exploitable', 'ignore', 'depose');

create table public.email_gmail (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references public.entreprise (id) on delete cascade,
  -- L'id du message chez Gmail : un même email reçu deux fois par le webhook n'est relevé qu'une fois.
  message_id text not null check (char_length(message_id) <= 64),
  -- La boîte qui l'a reçu, pour le lien « Ouvrir dans Gmail », même après une déconnexion.
  boite text check (char_length(boite) <= 320),
  expediteur text check (char_length(expediteur) <= 320),
  objet text check (char_length(objet) <= 500),
  recu_le timestamptz,
  releve_le timestamptz not null default now(),
  etat public.etat_email_gmail not null,
  -- Les pièces jointes écartées : [{ "nom": "avis.heic", "motif": "heic" }]. Les motifs sont dans MOTIFS_ECART
  -- (src/lib/gmail/regles.ts). Vide sur un email non exploitable : il n'avait aucune pièce jointe.
  ecarts jsonb not null default '[]' check (jsonb_typeof(ecarts) = 'array'),
  -- « Ignorer » ou « Déposer manuellement ».
  traite_le timestamptz,
  constraint email_gmail_message_unique unique (entreprise_id, message_id),
  -- La cible de la clé étrangère composite des avis.
  unique (id, entreprise_id),
  constraint email_gmail_traite check ((etat in ('ignore', 'depose')) = (traite_le is not null))
);

-- La liste et le compteur « Emails non exploitables · n ».
create index email_gmail_non_exploitable_idx on public.email_gmail (entreprise_id, releve_le desc)
  where etat = 'non_exploitable';

alter table public.email_gmail enable row level security;
revoke all on public.email_gmail from anon, authenticated;
grant select on public.email_gmail to authenticated;
-- « Ignorer » et « Déposer manuellement » : un email non exploitable sort de la liste, et rien d'autre ne change.
grant update (etat, traite_le) on public.email_gmail to authenticated;

create policy "Le gestionnaire voit les emails de son entreprise"
  on public.email_gmail for select
  to authenticated
  using (entreprise_id = (select public.mon_entreprise_id()));

create policy "Le gestionnaire ignore ou dépose un email non exploitable"
  on public.email_gmail for update
  to authenticated
  using (entreprise_id = (select public.mon_entreprise_id()) and etat = 'non_exploitable')
  with check (entreprise_id = (select public.mon_entreprise_id()) and etat in ('ignore', 'depose'));

alter table public.avis
  -- L'email d'où vient l'avis : relevé par le webhook, ou déposé à la main depuis un email non exploitable.
  add column email_gmail_id uuid,
  -- La pièce jointe d'où vient un avis relevé : un même email relevé deux fois ne donne pas deux avis.
  add column piece_jointe text check (char_length(piece_jointe) <= 200),
  -- Comme pour le véhicule : la clé étrangère composite ne vise que l'email de sa propre entreprise.
  add constraint avis_email_gmail_fk foreign key (email_gmail_id, entreprise_id)
    references public.email_gmail (id, entreprise_id),
  add constraint avis_piece_jointe_unique unique (email_gmail_id, piece_jointe),
  add constraint avis_piece_jointe_releve check (
    piece_jointe is null or (source = 'gmail' and email_gmail_id is not null)
  );

create index avis_email_gmail_id_idx on public.avis (email_gmail_id);

-- Le dépôt manuel d'un email non exploitable rattache l'avis à l'email (bloc « Reçu par Gmail »).
grant insert (email_gmail_id) on public.avis to authenticated;

-- Le dépôt en double (phase 8) s'abandonne aussi sous la clé secrète : la lecture IA d'un avis relevé tourne dans le
-- webhook, sans session. Le doublon est cherché dans l'entreprise de l'avis visé : sous la session du gestionnaire,
-- c'est la sienne ; sous la clé secrète, celle de l'avis.
create or replace function public.abandonner_depot_en_double(p_avis uuid, p_numero text)
returns text
language sql
security definer
set search_path = ''
as $$
  delete from public.avis
  where id = p_avis
    and (
      entreprise_id = (select public.mon_entreprise_id())
      or (select auth.jwt() ->> 'role') = 'service_role'
    )
    and numero is null
    and statut = 'a_traiter'
    and exists (
      select 1 from public.avis existant
      where existant.entreprise_id = avis.entreprise_id
        and existant.numero = p_numero
    )
  returning fichier
$$;

grant execute on function public.abandonner_depot_en_double(uuid, text) to service_role;
