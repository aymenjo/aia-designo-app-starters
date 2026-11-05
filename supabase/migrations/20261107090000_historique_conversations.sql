-- Historique des conversations sur 30 jours (phase 32, Pro). Le gestionnaire retrouve dans le panneau ses conversations
-- des 30 derniers jours, avec leur première demande et leurs récapitulatifs appliqués, et les rouvre en lecture seule.
-- Les lignes existent déjà : « Nouvelle conversation » termine la conversation sans l'effacer, et la purge quotidienne
-- ne supprime que ce qui a plus de 30 jours. Il manquait une coupure qui tienne avant le passage de la purge : la RLS
-- ne laisse plus lire une conversation commencée il y a plus de 30 jours, ni ses messages, ni ses récapitulatifs.
--
-- La fenêtre suit CONSERVATION_JOURS (src/lib/agent/regles.ts) et se compte depuis `debut`, comme la purge, la
-- conversation en cours et `appliquer_recapitulatif`. Un récapitulatif d'une conversation de plus de 30 jours ne se lit
-- ni ne s'annule plus : une mise à jour qui le vise passe aussi par la politique de lecture. Le serveur (clé secrète)
-- n'est pas concerné : la demande, la purge et la suppression de compte.
--
-- Aucune donnée nouvelle : la règle d'extension n'ajoute rien à la suppression de compte (phase 20) ni au retour en
-- Free (phase 19).

drop policy "Le gestionnaire voit les conversations de son entreprise" on public.conversation;

create policy "Le gestionnaire voit les conversations de son entreprise depuis 30 jours"
  on public.conversation for select
  to authenticated
  using (entreprise_id = (select public.mon_entreprise_id()) and debut >= now() - interval '30 days');

drop policy "Le gestionnaire voit les messages de son entreprise" on public.message;

create policy "Le gestionnaire voit les messages de son entreprise depuis 30 jours"
  on public.message for select
  to authenticated
  using (
    entreprise_id = (select public.mon_entreprise_id())
    and exists (
      select 1 from public.conversation c
      where c.id = conversation_id and c.debut >= now() - interval '30 days'
    )
  );

drop policy "Le gestionnaire voit les récapitulatifs de son entreprise" on public.recapitulatif;

create policy "Le gestionnaire voit les récapitulatifs de son entreprise depuis 30 jours"
  on public.recapitulatif for select
  to authenticated
  using (
    entreprise_id = (select public.mon_entreprise_id())
    and exists (
      select 1 from public.conversation c
      where c.id = conversation_id and c.debut >= now() - interval '30 days'
    )
  );
