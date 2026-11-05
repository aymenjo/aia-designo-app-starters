-- Demande à Désigno (phase 26, Pro). Le gestionnaire pose une question dans un panneau latéral ; un agent Claude
-- Managed Agents la traite avec les outils de lecture de Désigno, exécutés sous la session du gestionnaire (RLS), puis
-- répond en citant les éléments trouvés. Une conversation correspond à une session chez Anthropic. Les règles et les
-- messages vivent dans src/lib/agent/regles.ts ; le traitement d'une demande, dans src/lib/agent/demande.ts.
--
-- Seul le serveur écrit, avec la clé secrète : la route /api/agent, la purge à 30 jours et la suppression de compte. Le
-- gestionnaire lit sa conversation et ses messages, sans voir l'id de la session chez Anthropic.

create table public.conversation (
  id uuid primary key default gen_random_uuid(),
  -- La cascade suit l'entreprise ; la session chez Anthropic est effacée avant, par la suppression de compte (phase 20)
  -- et par la purge à 30 jours (/api/cron/purge-conversations).
  entreprise_id uuid not null references public.entreprise (id) on delete cascade,
  -- La session Managed Agents (sesn_…), créée au premier message : vide avant.
  session_id text unique check (session_id ~ '^sesn_'),
  debut timestamptz not null default now(),
  -- La première demande, pour l'historique (phase 32).
  premiere_demande text check (char_length(premiere_demande) <= 500),
  -- « Nouvelle conversation », ou une conversation de plus de 30 jours remplacée : elle n'est plus la conversation en
  -- cours. Sa session est effacée chez Anthropic juste après, ou par la purge si l'effacement a échoué.
  terminee_le timestamptz,
  session_effacee_le timestamptz,
  -- Le verrou d'une demande en cours : une seule à la fois par conversation. Pris par une mise à jour conditionnelle,
  -- libéré à la fin de la demande ; un verrou plus vieux que la durée maximale de la route est tenu pour mort.
  demande_en_cours_depuis timestamptz,
  -- Les éléments renvoyés par les outils pendant la conversation (« avis:<id> », « vehicule:<id> »…) : seul un lien vers
  -- l'un d'eux reste un lien dans les réponses (src/lib/agent/citations.ts).
  elements_connus text[] not null default '{}',
  -- La cible de la clé étrangère composite des messages.
  unique (id, entreprise_id),
  constraint session_effacee check (session_effacee_le is null or (session_id is not null and terminee_le is not null))
);

-- Une seule conversation en cours par entreprise.
create unique index conversation_en_cours_idx on public.conversation (entreprise_id) where terminee_le is null;
-- La purge : les conversations de plus de 30 jours, et les sessions restées à effacer.
create index conversation_debut_idx on public.conversation (debut);
create index conversation_session_a_effacer_idx on public.conversation (entreprise_id)
  where session_id is not null and session_effacee_le is null;

create type public.role_message as enum ('gestionnaire', 'agent');

create table public.message (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  -- La cascade suit l'entreprise, et la conversation.
  entreprise_id uuid not null references public.entreprise (id) on delete cascade,
  role public.role_message not null,
  -- Du Markdown pour l'agent, nettoyé de tout lien qui ne vise pas un élément connu de la conversation.
  contenu text not null check (char_length(contenu) between 1 and 20000),
  -- Une réponse qui n'a pas pu aboutir (délai, panne) : le panneau l'affiche comme une erreur.
  erreur boolean not null default false,
  -- Les éléments cités : [{ "type": "avis", "id": "…", "lien": "/avis/…" }].
  elements_cites jsonb not null default '[]' check (jsonb_typeof(elements_cites) = 'array'),
  -- Le dernier `agent.message` de la réponse chez Anthropic : une réponse retrouvée après une coupure n'est enregistrée
  -- qu'une fois.
  evenement_id text unique check (evenement_id ~ '^sevt_'),
  cree_le timestamptz not null default now(),
  constraint message_conversation_fk foreign key (conversation_id, entreprise_id)
    references public.conversation (id, entreprise_id) on delete cascade,
  constraint message_gestionnaire check (role = 'agent' or (not erreur and evenement_id is null and elements_cites = '[]'))
);

create index message_conversation_idx on public.message (conversation_id, cree_le);

-- Le gestionnaire lit sa conversation, sans l'id de la session ni les éléments connus ; ses messages, sans l'id de
-- l'événement. Aucune écriture sous sa session.
alter table public.conversation enable row level security;
revoke all on public.conversation from anon, authenticated;
grant select (id, entreprise_id, debut, premiere_demande, terminee_le, demande_en_cours_depuis)
  on public.conversation to authenticated;

create policy "Le gestionnaire voit les conversations de son entreprise"
  on public.conversation for select
  to authenticated
  using (entreprise_id = (select public.mon_entreprise_id()));

alter table public.message enable row level security;
revoke all on public.message from anon, authenticated;
grant select (id, conversation_id, entreprise_id, role, contenu, erreur, elements_cites, cree_le)
  on public.message to authenticated;

create policy "Le gestionnaire voit les messages de son entreprise"
  on public.message for select
  to authenticated
  using (entreprise_id = (select public.mon_entreprise_id()));
