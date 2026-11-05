-- Échec de paiement et retour en Free (phase 19). Un impayé est daté par le webhook (src/lib/abonnement/webhook.ts) ;
-- au-delà de 7 jours, la tâche /api/cron/impayes annule l'abonnement chez Stripe, et le webhook repasse le compte en
-- Free. Au retour en Free, au-delà de 3 véhicules actifs, tous passent en lecture seule jusqu'au choix des 3 qui restent
-- actifs (/flotte/vehicules-actifs). Un avis déposé sur un véhicule en lecture seule est compté et lu, puis bloqué : ni
-- conducteur validé, ni désignation, jusqu'à ce que le véhicule redevienne actif. Repasser en Pro lève tout.
--
-- Comme au plan Free : toutes les fonctions sont `volatile`, et le verrou par entreprise reste
-- pg_advisory_xact_lock(17, hashtext(id)). Aucune des nouvelles colonnes n'a de grant d'écriture : seuls les triggers, la
-- RPC et le webhook les écrivent. Le gestionnaire les lit, le grant de SELECT portant sur les tables entières.
--
-- Interblocage accepté : `reactiverVehicule` verrouille la ligne du véhicule, puis attend le verrou 17 dans le trigger
-- de la limite Free, quand le passage en Pro, au même moment, tient ce verrou et met à jour ce véhicule. Postgres annule
-- alors l'une des deux transactions : le webhook répond 500 et Stripe relance, ou la réactivation affiche son message
-- d'erreur générique.

-- L'entrée de l'abonnement en `past_due` : le `created` de l'événement, gardé tant que l'impayé dure, vide sinon. La date
-- limite en découle : le jour de l'échec, à Paris, plus 7 jours (src/lib/abonnement/regles.ts).
alter table public.entreprise add column paiement_echoue_le timestamptz;

update public.entreprise set paiement_echoue_le = stripe_evenement_le where abonnement_statut = 'past_due';

-- Vide quand le véhicule est actif. Remplie au retour en Free, elle délimite les nouveaux avis : ceux déposés depuis sont
-- bloqués ; ceux d'avant restent traitables. Archiver le véhicule la garde : seul le rendre actif, ou le réactiver, la lève.
alter table public.vehicule add column lecture_seule_le timestamptz;

alter table public.avis
  -- Ouvert, et déposé depuis le passage de son véhicule en lecture seule. Recalculé à chaque rattachement et à chaque
  -- changement de statut (classer puis rouvrir) ; levé quand le véhicule redevient actif.
  add column vehicule_lecture_seule boolean not null default false,
  -- Le filet de sécurité contre une validation ou une désignation forcée par l'API.
  add constraint avis_vehicule_lecture_seule check (
    not vehicule_lecture_seule or (conducteur_id is null and designe_le is null)
  );

-- Les emails d'impayé, un par facture (le premier échec) : la réservation se fait ici avant l'envoi, comme
-- `facture_envoyee`, car Stripe relance un webhook pendant 3 jours.
create table public.impaye_signale (
  facture_id text primary key check (facture_id ~ '^in_'),
  -- La cascade suit l'entreprise : la suppression de compte (phase 20) emporte les réservations.
  entreprise_id uuid not null references public.entreprise (id) on delete cascade,
  signale_le timestamptz not null default now()
);

create index impaye_signale_entreprise_id_idx on public.impaye_signale (entreprise_id);

-- Seul le webhook y accède, avec la clé secrète.
alter table public.impaye_signale enable row level security;
revoke all on public.impaye_signale from anon, authenticated;

-- Les véhicules en lecture seule d'une entreprise, que la limite Free et l'écran de choix parcourent.
create index vehicule_lecture_seule_idx on public.vehicule (entreprise_id) where lecture_seule_le is not null;
-- Les avis bloqués, que le déblocage parcourt.
create index avis_vehicule_lecture_seule_idx on public.avis (vehicule_id) where vehicule_lecture_seule;

-- La limite Free (phase 17), sur les véhicules actifs : ni archivés, ni en lecture seule. Une réactivation (archivé → non
-- archivé) rend le véhicule actif : elle lève aussi sa lecture seule, et compte dans la limite. Un véhicule qui ne devient
-- pas actif (archivé, passé en lecture seule, ou déjà actif) passe sans contrôle.
create or replace function public.limiter_vehicules_free()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.archive_le is not null and new.archive_le is null then
    new.lecture_seule_le := null;
  end if;
  if new.archive_le is not null
    or new.lecture_seule_le is not null
    or (tg_op = 'UPDATE' and old.archive_le is null and old.lecture_seule_le is null) then
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
    where entreprise_id = new.entreprise_id and archive_le is null and lecture_seule_le is null and id <> new.id
  ) >= 3 then
    raise exception using errcode = 'P0001', message = 'limite_vehicules_free';
  end if;
  return new;
end;
$$;

drop trigger limiter_vehicules_free on public.vehicule;

create trigger limiter_vehicules_free
  before insert or update of archive_le, lecture_seule_le on public.vehicule
  for each row execute function public.limiter_vehicules_free();

-- Au retour en Free (abonnement annulé ou impayé), au-delà de 3 véhicules actifs, tous les véhicules non archivés passent
-- en lecture seule : l'écran de choix en rend 3 actifs. À 3 ou moins, rien ne change.
create function public.passer_en_lecture_seule_au_retour_free()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(17, hashtext(new.id::text));
  -- LIMITES_FREE.vehicules
  if (
    select count(*) from public.vehicule
    where entreprise_id = new.id and archive_le is null and lecture_seule_le is null
  ) > 3 then
    update public.vehicule
    set lecture_seule_le = now()
    where entreprise_id = new.id and archive_le is null and lecture_seule_le is null;
  end if;
  return null;
end;
$$;

revoke execute on function public.passer_en_lecture_seule_au_retour_free() from public, anon, authenticated;

create trigger passer_en_lecture_seule_au_retour_free
  after update of plan on public.entreprise
  for each row
  when (old.plan = 'pro' and new.plan = 'free')
  execute function public.passer_en_lecture_seule_au_retour_free();

-- En Pro, aucun avis n'est verrouillé ni bloqué, et aucun véhicule n'est en lecture seule : au passage de Free à Pro, les
-- avis verrouillés comptent dans le mois de leur dépôt, à Paris, et leur lecture IA a lieu à leur ouverture
-- (`aLireApresDeverrouillage`) ; tous les véhicules, archivés compris, redeviennent actifs ou simplement archivés. Le
-- verrou est celui du dépôt : un avis déposé pendant le passage est compté avant, ou après, mais jamais verrouillé en Pro.
create or replace function public.deverrouiller_au_passage_pro()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(17, hashtext(new.id::text));
  update public.avis
  set verrouille = false,
      mois_quota = date_trunc('month', depose_le at time zone 'Europe/Paris')::date,
      deverrouille_le = now()
  where entreprise_id = new.id and verrouille;
  update public.vehicule set lecture_seule_le = null where entreprise_id = new.id and lecture_seule_le is not null;
  update public.avis set vehicule_lecture_seule = false where entreprise_id = new.id and vehicule_lecture_seule;
  return null;
end;
$$;

-- Un avis ouvert rattaché à un véhicule en lecture seule, et déposé depuis, est bloqué : son conducteur validé est
-- effacé. Recalculé au rattachement (`ecrire` renvoie toujours `vehicule_id`) et à chaque changement de statut : un avis
-- classé n'est plus bloqué, et rouvert il l'est de nouveau. Un avis bloqué ne passe jamais « Désigné » : sans ce refus,
-- le recalcul, qui ne bloque qu'un avis ouvert, laisserait passer une désignation forcée par l'API.
-- Aucun verrou consultatif : `deverrouiller_avis*` tiennent le verrou 17 puis mettent à jour des avis, ce qui pourrait
-- s'interbloquer. Une course entre un rattachement et une réactivation se corrige au prochain enregistrement de l'avis.
create function public.bloquer_avis_vehicule_lecture_seule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  depuis timestamptz;
begin
  if tg_op = 'UPDATE' and old.vehicule_lecture_seule and new.statut = 'designe' then
    raise exception using errcode = '23514', message = 'avis_vehicule_lecture_seule';
  end if;

  select lecture_seule_le into depuis from public.vehicule where id = new.vehicule_id;
  new.vehicule_lecture_seule := new.statut in ('a_traiter', 'a_valider')
    and depuis is not null
    and new.depose_le >= depuis;
  if new.vehicule_lecture_seule then
    new.conducteur_id := null;
  end if;
  return new;
end;
$$;

revoke execute on function public.bloquer_avis_vehicule_lecture_seule() from public, anon, authenticated;

create trigger bloquer_avis_vehicule_lecture_seule
  before insert or update of vehicule_id, statut on public.avis
  for each row execute function public.bloquer_avis_vehicule_lecture_seule();

-- Le véhicule redevient actif (rendu actif, réactivé, ou passage en Pro) : ses avis bloqués se débloquent. Sans liste de
-- colonnes : la réactivation lève la lecture seule dans un trigger, et non dans son `set`.
create function public.debloquer_avis_du_vehicule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.avis set vehicule_lecture_seule = false where vehicule_id = new.id and vehicule_lecture_seule;
  return null;
end;
$$;

revoke execute on function public.debloquer_avis_du_vehicule() from public, anon, authenticated;

create trigger debloquer_avis_du_vehicule
  after update on public.vehicule
  for each row
  when (old.lecture_seule_le is not null and new.lecture_seule_le is null)
  execute function public.debloquer_avis_du_vehicule();

-- Le déverrouillage du mois (phase 17) écarte les avis bloqués par un véhicule en lecture seule : aucune place du quota
-- ne revient à un avis qui resterait bloqué. Débloqué plus tard, il passe au déverrouillage suivant.
create or replace function public.deverrouiller_avis(p_entreprise uuid, p_mois date)
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
      and not vehicule_lecture_seule
      and statut in ('a_traiter', 'a_valider')
      and depose_le < (p_mois::timestamp at time zone 'Europe/Paris')
    order by echeance nulls first, depose_le
    limit places
  );
  get diagnostics deverrouilles = row_count;
  return deverrouilles;
end;
$$;

-- « Garder ces 3 véhicules » et « Rendre actif » : les véhicules demandés de l'entreprise du gestionnaire, non archivés et
-- en lecture seule, redeviennent actifs. La limite Free reste garantie par le trigger, qui refuse le 4e et annule toute
-- l'instruction. Renvoie le nombre de véhicules rendus actifs : 0 pour une sélection périmée.
create function public.rendre_vehicules_actifs(p_vehicules uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  entreprise uuid := public.mon_entreprise_id();
  rendus integer;
begin
  if entreprise is null then
    return 0;
  end if;

  perform pg_advisory_xact_lock(17, hashtext(entreprise::text));
  update public.vehicule
  set lecture_seule_le = null
  where entreprise_id = entreprise
    and id = any (p_vehicules)
    and archive_le is null
    and lecture_seule_le is not null;
  get diagnostics rendus = row_count;
  return rendus;
end;
$$;

revoke execute on function public.rendre_vehicules_actifs(uuid[]) from public, anon;
grant execute on function public.rendre_vehicules_actifs(uuid[]) to authenticated;

-- Une entreprise Free qui a plus de 3 véhicules actifs, tolérés en phase 17 : ses véhicules non archivés passent en
-- lecture seule, et l'écran de choix s'affiche à sa prochaine visite. Les avis déjà déposés restent traitables.
update public.vehicule
set lecture_seule_le = now()
where archive_le is null
  and entreprise_id in (
    select entreprise.id
    from public.entreprise
    where entreprise.plan = 'free'
      and (
        select count(*) from public.vehicule actif
        where actif.entreprise_id = entreprise.id and actif.archive_le is null
      ) > 3
  );
