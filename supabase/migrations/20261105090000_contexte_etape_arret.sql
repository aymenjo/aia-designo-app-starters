-- Demande à Désigno : contexte de l'écran, étape en cours et « Arrêter » (phase 28, Pro). Chaque demande part avec
-- l'élément de l'écran ouvert (un avis, un véhicule ou un conducteur), enregistré avec elle : l'agent comprend « cet
-- avis », « ce véhicule » et « ce conducteur ». Pendant la recherche, le serveur écrit l'étape en cours sur la
-- conversation, que le panneau relit après une coupure. « Arrêter » pose le verrou de la demande à arrêter ; le serveur
-- le guette, interrompt la session, puis enregistre la mention « Demande arrêtée. ». Les règles et les libellés vivent
-- dans src/lib/agent/regles.ts ; le traitement d'une demande, dans src/lib/agent/demande.ts.
--
-- Seul le serveur écrit, avec la clé secrète, comme pour le reste de la conversation. Ces colonnes partent en cascade
-- avec l'entreprise (suppression de compte, phase 20) et avec la purge à 30 jours ; rien n'est à prévoir pour le retour
-- en Free, où plus aucune demande n'est traitée.

alter table public.conversation
  -- L'étape en cours (« Je consulte le planning de AB-123-CD… ») : écrite à chaque appel d'outil, vidée à la
  -- libération du verrou.
  add column etape text check (char_length(etape) <= 200),
  -- Le verrou (`demande_en_cours_depuis`) de la demande que le gestionnaire a arrêtée. Une nouvelle demande prend un
  -- nouveau verrou : la colonne n'a pas à être remise à zéro.
  add column arret_demande timestamptz;

alter table public.message
  -- L'élément de l'écran au moment de la demande : { "type": "avis", "id": "…", "libelle": "avis n° 1234567890" }.
  -- Sur une demande du gestionnaire seulement.
  add column contexte jsonb check (contexte is null or jsonb_typeof(contexte) = 'object'),
  -- « Demande arrêtée. » : la mention enregistrée à la place de la réponse, sur un message de l'agent seulement.
  add column arret boolean not null default false;

alter table public.message
  drop constraint message_gestionnaire,
  add constraint message_gestionnaire
    check (role = 'agent' or (not erreur and not arret and evenement_id is null and elements_cites = '[]')),
  add constraint message_agent check (role = 'gestionnaire' or contexte is null),
  add constraint message_arret check (not (arret and erreur));

-- Le gestionnaire lit l'étape de sa conversation, sans le verrou de l'arrêt ; le contexte et la mention d'arrêt de ses
-- messages. Toujours aucune écriture sous sa session : « Arrêter » passe par le serveur.
grant select (etape) on public.conversation to authenticated;
grant select (contexte, arret) on public.message to authenticated;
