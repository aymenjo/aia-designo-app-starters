-- Limite de Demande à Désigno (phase 27, Pro) : 100 demandes par mois calendaire, à l'heure de Paris. Une demande compte
-- dès qu'elle est acceptée, c'est-à-dire dès que le message du gestionnaire entre dans la conversation, même si Désigno
-- échoue ensuite. Le compteur vit à part des messages : la purge des conversations à 30 jours ne le touche pas. La limite
-- est définie une seule fois, dans src/lib/abonnement/plans.ts (DEMANDES_AGENT_PAR_MOIS), et passée à la fonction.
--
-- Seul le serveur compte, avec la clé secrète (src/lib/agent/usage.ts). Le gestionnaire lit sa ligne, sans pouvoir
-- l'écrire : un appel direct à l'API ne remet pas le compteur à zéro. La ligne reste au retour en Free : repasser en Pro
-- dans le même mois ne rend pas de demandes. Elle part en cascade avec l'entreprise (suppression de compte, phase 20).

create table public.usage_agent (
  entreprise_id uuid not null references public.entreprise (id) on delete cascade,
  -- Le mois calendaire, par son 1er jour (à Paris).
  mois date not null check (extract(day from mois) = 1),
  demandes integer not null check (demandes >= 0),
  primary key (entreprise_id, mois)
);

alter table public.usage_agent enable row level security;
revoke all on public.usage_agent from anon, authenticated;
grant select on public.usage_agent to authenticated;

create policy "Le gestionnaire voit l'usage de son entreprise"
  on public.usage_agent for select
  to authenticated
  using (entreprise_id = (select public.mon_entreprise_id()));

-- Compte une demande, en un seul upsert : deux demandes simultanées à la limite n'en acceptent qu'une. Renvoie le nouveau
-- total, ou `null` si la limite est déjà atteinte : la demande est refusée, et rien n'est compté.
create function public.compter_demande_agent(p_entreprise_id uuid, p_mois date, p_limite integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_demandes integer;
begin
  if p_limite < 1 then
    return null;
  end if;
  insert into public.usage_agent as u (entreprise_id, mois, demandes)
  values (p_entreprise_id, p_mois, 1)
  on conflict (entreprise_id, mois) do update
    set demandes = u.demandes + 1
    where u.demandes < p_limite
  returning u.demandes into v_demandes;
  return v_demandes;
end;
$$;

revoke execute on function public.compter_demande_agent(uuid, date, integer) from public, anon, authenticated;
grant execute on function public.compter_demande_agent(uuid, date, integer) to service_role;
