-- Rappels Google Calendar (phase 22) : l'agenda est le second service d'une connexion Google. Une valeur ajoutée à un
-- énuméré ne peut pas servir dans la transaction qui l'ajoute : les contraintes et la table des événements suivent dans
-- 20261029091000_rappels_agenda.sql.
alter type public.service_google add value 'agenda';
