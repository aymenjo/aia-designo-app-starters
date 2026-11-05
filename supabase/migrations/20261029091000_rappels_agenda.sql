-- Rappels Google Calendar (phase 22). Le gestionnaire Pro connecte son compte Google par Composio : Désigno y crée un
-- agenda « Désigno », et chaque avis ouvert qui a une échéance y a un événement sur la journée à J-2. La synchronisation
-- (src/lib/agenda/synchro.ts) compare les avis ouverts aux événements posés, notés ici, et n'appelle Google que pour les
-- écarts. Les règles et les messages vivent dans src/lib/agenda/regles.ts.
--
-- Tout s'écrit avec la clé secrète : la connexion une fois le compte vérifié chez Composio, les événements par la
-- synchronisation, qui tourne aussi sans session (tâche planifiée, webhooks).

alter table public.connexion_google
  -- L'agenda « Désigno » créé chez Google pour une connexion de l'agenda : ses événements y sont posés.
  add column agenda_id text check (char_length(agenda_id) <= 1024),
  add constraint agenda_du_service check ((service = 'agenda') = (agenda_id is not null)),
  -- Le libellé, le déclencheur et l'email d'interruption n'existent que pour Gmail : l'agenda s'interrompt sans email.
  add constraint releve_gmail_seulement check (
    service = 'gmail' or (libelle_id is null and declencheur_id is null and interruption_signalee_le is null)
  ),
  drop constraint declencheur_date,
  -- Gmail est actif à la création du déclencheur, l'agenda dès sa connexion : « Rappels actifs depuis le … ».
  add constraint declencheur_date check (
    case service
      when 'gmail' then (declencheur_id is null) = (active_depuis is null)
      else active_depuis is not null
    end
  );

-- Les événements posés dans l'agenda « Désigno », un par avis, tels que Google les a reçus : la synchronisation compare
-- leur jour et leur titre à ceux de l'avis. L'id de l'événement chez Google est tiré de l'id de l'avis.
create table public.evenement_agenda (
  -- La cascade suit l'entreprise ; l'agenda lui-même est supprimé chez Google par `deconnecterAgenda` (phase 20).
  entreprise_id uuid not null references public.entreprise (id) on delete cascade,
  -- L'agenda où l'événement est posé : après une reconnexion sur un autre agenda, les lignes de l'ancien sont oubliées.
  agenda_id text not null,
  -- Sans clé étrangère : un avis qui disparaît (un dépôt en double abandonné) garde sa ligne, et la synchronisation
  -- retire alors son événement.
  avis_id uuid not null,
  -- Le jour de l'événement, J-2 de l'échéance.
  jour date not null,
  titre text not null check (char_length(titre) <= 200),
  pose_le timestamptz not null default now(),
  primary key (agenda_id, avis_id)
);

create index evenement_agenda_entreprise_id_idx on public.evenement_agenda (entreprise_id);

-- Seul le serveur y accède, avec la clé secrète, comme `alerte_envoyee` : ni le navigateur ni le gestionnaire.
alter table public.evenement_agenda enable row level security;
revoke all on public.evenement_agenda from anon, authenticated;
