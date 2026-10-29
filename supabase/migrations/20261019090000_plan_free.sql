-- Plan Free (phase 17) : 3 véhicules actifs, et 5 avis par mois calendaire, comptés au dépôt à l'heure de Paris. À partir
-- du 6e, l'avis est « Verrouillé » : la lecture IA, la proposition du conducteur et le récap attendent le 1er du mois
-- suivant. Le client écrit aussi directement par l'API REST : comme la contrainte d'exclusion pour les chevauchements, des
-- triggers garantissent ici les quotas. L'app traduit leur erreur en message (src/lib/flotte/vehicules.ts).
-- Les chiffres 3 et 5 reprennent `LIMITES_FREE` (src/lib/abonnement/plans.ts) : les tests d'intégration les vérifient à
-- partir de cette constante. L'historique limité et le compteur d'usage vivent dans src/lib/abonnement/quotas.ts.
--
-- Toutes les fonctions restent `volatile` (le défaut en plpgsql) : un trigger de ligne voit alors les lignes déjà écrites
-- par la même commande (un tableau d'avis inséré d'un coup), et, une fois le verrou pris, celles qu'une transaction
-- concurrente vient de valider. Le verrou par entreprise est le même partout : pg_advisory_xact_lock(17, hashtext(id)).

-- Le plan de l'entreprise. Seuls les webhooks Stripe (phase 18) l'écrivent, avec la clé secrète : aucun `grant update`.
create type public.plan_entreprise as enum ('free', 'pro');

alter table public.entreprise add column plan public.plan_entreprise not null default 'free';

alter table public.avis
  -- Le 6e avis du mois en Free, et les suivants : déposé, mais ni lu, ni proposé, ni récapitulé.
  add column verrouille boolean not null default false,
  -- Le 1er du mois dont le quota compte l'avis : celui de son dépôt, ou celui de son déverrouillage. Vide tant qu'il est
  -- verrouillé.
  add column mois_quota date,
  -- Le déverrouillage d'un avis jamais lu : sa lecture IA a lieu à son ouverture (src/lib/avis/regles.ts).
  add column deverrouille_le timestamptz;

-- Chaque avis déjà déposé compte dans le quota du mois de son dépôt, à Paris.
update public.avis set mois_quota = date_trunc('month', depose_le at time zone 'Europe/Paris')::date;

alter table public.avis
  add constraint avis_mois_quota check (verrouille = (mois_quota is null)),
  add constraint avis_mois_quota_premier check (extract(day from mois_quota) = 1),
  -- Le filet de sécurité contre une validation, une désignation ou une lecture forcée par l'API : un avis verrouillé
  -- n'a ni conducteur validé, ni date de désignation, ni lecture IA.
  add constraint avis_verrouille_sans_pro check (
    not verrouille or (conducteur_id is null and designe_le is null and lecture_ia is null)
  );

-- Aucun grant sur ces colonnes : seuls les triggers et le déverrouillage les écrivent.

-- Le compteur d'usage (avis du mois) et le décompte du dépôt.
create index avis_mois_quota_idx on public.avis (entreprise_id, mois_quota);
-- Les avis verrouillés, que le déverrouillage parcourt.
create index avis_verrouille_idx on public.avis (entreprise_id) where verrouille;

-- Un véhicule qui devient actif (ajouté, ou réactivé) est refusé en Free quand l'entreprise en a déjà 3 actifs. Les
-- véhicules en trop qui existent déjà ne sont pas touchés : le choix des 3 actifs arrive au retour en Free (phase 19).
create function public.limiter_vehicules_free()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.archive_le is not null or (tg_op = 'UPDATE' and old.archive_le is null) then
    return new;
  end if;

  perform pg_advisory_xact_lock(17, hashtext(new.entreprise_id::text));
  if (select plan from public.entreprise where id = new.entreprise_id) is distinct from 'free' then
    return new;
  end if;
  -- La plaque est déjà dans la flotte : l'index unique refuse l'ajout avec le bon message (« déjà présente »,
  -- « Ouvrir sa fiche »).
  if tg_op = 'INSERT' and exists (
    select 1 from public.vehicule where entreprise_id = new.entreprise_id and plaque = new.plaque
  ) then
    return new;
  end if;
  -- LIMITES_FREE.vehicules
  if (
    select count(*) from public.vehicule
    where entreprise_id = new.entreprise_id and archive_le is null and id <> new.id
  ) >= 3 then
    raise exception using errcode = 'P0001', message = 'limite_vehicules_free';
  end if;
  return new;
end;
$$;

revoke execute on function public.limiter_vehicules_free() from public, anon, authenticated;

create trigger limiter_vehicules_free
  before insert or update of archive_le on public.vehicule
  for each row execute function public.limiter_vehicules_free();

-- Fait entrer dans le quota de `p_mois` (le 1er du mois) les avis ouverts verrouillés d'un mois passé, dans la limite
-- des places qui restent : d'abord ceux sans échéance (aucune alerte ne part pour eux, la lecture IA la leur donnera),
-- puis l'échéance la plus proche. C'est l'ordre de la liste des avis (`trierPourSuivi`). Un avis classé ne prend pas de
-- place : rouvert, il passe au déverrouillage suivant. Idempotente. Interne : l'appelant a pris le verrou.
create function public.deverrouiller_avis(p_entreprise uuid, p_mois date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  places integer;
  deverrouilles integer;
begin
  -- LIMITES_FREE.avisParMois. Une entreprise déjà au-delà n'a aucune place : un `limit` négatif échouerait.
  places := 5 - (select count(*) from public.avis where entreprise_id = p_entreprise and mois_quota = p_mois);
  if places <= 0 then
    return 0;
  end if;

  update public.avis
  set verrouille = false, mois_quota = p_mois, deverrouille_le = now()
  where id in (
    select id from public.avis
    where entreprise_id = p_entreprise
      and verrouille
      and statut in ('a_traiter', 'a_valider')
      and depose_le < (p_mois::timestamp at time zone 'Europe/Paris')
    order by echeance nulls first, depose_le
    limit places
  );
  get diagnostics deverrouilles = row_count;
  return deverrouilles;
end;
$$;

revoke execute on function public.deverrouiller_avis(uuid, date) from public, anon, authenticated;

-- Au dépôt, l'avis compte dans le quota du mois de son dépôt, à Paris. En Free, les verrouillés des mois passés passent
-- d'abord, même si la tâche du 1er a sauté ; puis, à 5 avis dans le mois, le nouveau est verrouillé. En Pro, jamais.
-- Le mois vient de `depose_le` : les tests sèment des mois passés avec la clé secrète.
create function public.compter_avis_au_depot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  mois date := date_trunc('month', new.depose_le at time zone 'Europe/Paris')::date;
begin
  perform pg_advisory_xact_lock(17, hashtext(new.entreprise_id::text));
  new.deverrouille_le := null;

  if (select plan from public.entreprise where id = new.entreprise_id) = 'free' then
    perform public.deverrouiller_avis(new.entreprise_id, mois);
    -- LIMITES_FREE.avisParMois
    if (select count(*) from public.avis where entreprise_id = new.entreprise_id and mois_quota = mois) >= 5 then
      new.verrouille := true;
      new.mois_quota := null;
      return new;
    end if;
  end if;

  new.verrouille := false;
  new.mois_quota := mois;
  return new;
end;
$$;

revoke execute on function public.compter_avis_au_depot() from public, anon, authenticated;

create trigger compter_avis_au_depot
  before insert on public.avis
  for each row execute function public.compter_avis_au_depot();

-- La tâche quotidienne (src/app/api/cron/deverrouillage) : pour chaque entreprise Free qui a des avis ouverts verrouillés
-- d'un mois passé, le déverrouillage du mois de `p_aujourdhui` (à Paris). Idempotente : relancée, elle ne trouve plus de
-- place, ou plus d'avis. Renvoie le nombre d'avis déverrouillés.
create function public.deverrouiller_avis_du_mois(
  p_aujourdhui date default (now() at time zone 'Europe/Paris')::date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  mois date := date_trunc('month', p_aujourdhui::timestamp)::date;
  une_entreprise uuid;
  total integer := 0;
begin
  for une_entreprise in
    select distinct avis.entreprise_id
    from public.avis
    join public.entreprise on entreprise.id = avis.entreprise_id
    where entreprise.plan = 'free'
      and avis.verrouille
      and avis.statut in ('a_traiter', 'a_valider')
      and avis.depose_le < (mois::timestamp at time zone 'Europe/Paris')
  loop
    perform pg_advisory_xact_lock(17, hashtext(une_entreprise::text));
    total := total + public.deverrouiller_avis(une_entreprise, mois);
  end loop;
  return total;
end;
$$;

revoke execute on function public.deverrouiller_avis_du_mois(date) from public, anon, authenticated;
grant execute on function public.deverrouiller_avis_du_mois(date) to service_role;
