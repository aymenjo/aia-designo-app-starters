-- Récapitulatif de modifications (phase 29, Pro). Le gestionnaire décrit un changement à Désigno ; l'agent ne fait que
-- le proposer : son outil `proposer_modifications` vérifie chaque ligne avec les règles des écrans, sur la flotte simulée
-- après les lignes précédentes (src/lib/flotte/regles-recapitulatif.ts), puis le serveur enregistre le récapitulatif.
-- Rien ne change avant « Confirmer » : le serveur revérifie tout sur la flotte du moment, puis `appliquer_recapitulatif`
-- écrit les lignes stockées, dans l'ordre, en une seule transaction. Toute erreur annule l'ensemble.
--
-- Seul le serveur crée un récapitulatif, avec la clé secrète. Le gestionnaire le lit, l'annule, et l'applique par la
-- fonction, sous sa session : la RLS et les grants des tables de la flotte s'appliquent à chaque écriture. Les règles et
-- leurs messages restent en TypeScript ; la base garde ses contraintes (chevauchement, unicités, clés étrangères) comme
-- filet, et ne porte ici aucune règle métier.
--
-- Le verrou par entreprise reste pg_advisory_xact_lock(17, hashtext(id)) : il sérialise la proposition, l'application
-- et le retour en Free.

create type public.statut_recapitulatif as enum ('propose', 'applique', 'annule', 'remplace', 'expire');

create table public.recapitulatif (
  id uuid primary key default gen_random_uuid(),
  -- La cascade suit l'entreprise (suppression de compte), et la conversation (purge à 30 jours).
  entreprise_id uuid not null references public.entreprise (id) on delete cascade,
  conversation_id uuid not null,
  -- La réponse de l'agent qui présente le récapitulatif : vide pendant le tour, rattachée une fois la réponse enregistrée.
  message_id uuid references public.message (id) on delete set null,
  -- Un seul `propose` par conversation : un nouveau récapitulatif remplace l'ancien.
  statut public.statut_recapitulatif not null default 'propose',
  -- Les lignes, dans l'ordre d'application : { operation, cible, avant, apres, affichage }. `avant` ne garde que les
  -- champs modifiés, tels que lus à la proposition ; `apres`, les valeurs prêtes pour la base. Une ligne vise le véhicule
  -- ou le conducteur créé par une ligne précédente par { "ligne": n }.
  lignes jsonb not null check (
    case when jsonb_typeof(lignes) = 'array' then jsonb_array_length(lignes) between 1 and 20 else false end
  ),
  -- Les éléments créés, par numéro de ligne ({ "2": "<id>" }) : écrits par la seule application.
  crees jsonb not null default '{}' check (jsonb_typeof(crees) = 'object'),
  applique_le timestamptz,
  cree_le timestamptz not null default now(),
  -- Le sort du récapitulatif (appliqué, annulé, expiré) a été signalé à l'agent, joint à la demande suivante.
  sort_signale_le timestamptz,
  constraint recapitulatif_conversation_fk foreign key (conversation_id, entreprise_id)
    references public.conversation (id, entreprise_id) on delete cascade,
  constraint recapitulatif_applique check ((statut = 'applique') = (applique_le is not null))
);

create unique index recapitulatif_propose_idx on public.recapitulatif (conversation_id) where statut = 'propose';
create index recapitulatif_conversation_idx on public.recapitulatif (conversation_id, cree_le);
create index recapitulatif_message_idx on public.recapitulatif (message_id) where message_id is not null;
-- Le retour en Free expire les récapitulatifs en attente de l'entreprise.
create index recapitulatif_entreprise_propose_idx on public.recapitulatif (entreprise_id) where statut = 'propose';

-- Le gestionnaire lit les récapitulatifs de son entreprise, sans savoir ce qui a été signalé à l'agent. Il ne fait que
-- passer un `propose` à `annule`, ou à `applique` par la fonction : le trigger de garde refuse tout autre passage.
alter table public.recapitulatif enable row level security;
revoke all on public.recapitulatif from anon, authenticated;
grant select (id, entreprise_id, conversation_id, message_id, statut, lignes, crees, applique_le, cree_le)
  on public.recapitulatif to authenticated;
grant update (statut, crees) on public.recapitulatif to authenticated;

create policy "Le gestionnaire voit les récapitulatifs de son entreprise"
  on public.recapitulatif for select
  to authenticated
  using (entreprise_id = (select public.mon_entreprise_id()));

create policy "Le gestionnaire applique ou annule un récapitulatif en attente"
  on public.recapitulatif for update
  to authenticated
  using (entreprise_id = (select public.mon_entreprise_id()) and statut = 'propose')
  with check (entreprise_id = (select public.mon_entreprise_id()) and statut in ('applique', 'annule'));

-- La garde : un récapitulatif ne quitte `propose` qu'une fois, ses lignes ne changent jamais, et seul
-- `appliquer_recapitulatif` le passe à `applique`, en signant sa transaction. Un PATCH de l'API ne peut donc pas afficher
-- un faux « Appliqué le … », ni écrire les éléments créés. La date d'application est celle de la base.
create function public.garder_recapitulatif()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.statut is distinct from old.statut and old.statut <> 'propose' then
    raise exception using errcode = '23514', message = 'recapitulatif_statut_final';
  end if;
  if new.lignes is distinct from old.lignes
    or new.conversation_id is distinct from old.conversation_id
    or new.entreprise_id is distinct from old.entreprise_id then
    raise exception using errcode = '23514', message = 'recapitulatif_lignes_figees';
  end if;

  if new.statut = 'applique' and old.statut <> 'applique' then
    if current_setting('designo.recapitulatif', true) is distinct from new.id::text then
      raise exception using errcode = '42501', message = 'recapitulatif_application_reservee';
    end if;
    new.applique_le := now();
  else
    if new.crees is distinct from old.crees then
      raise exception using errcode = '42501', message = 'recapitulatif_application_reservee';
    end if;
    new.applique_le := old.applique_le;
  end if;
  return new;
end;
$$;

revoke execute on function public.garder_recapitulatif() from public, anon, authenticated;

create trigger garder_recapitulatif
  before update on public.recapitulatif
  for each row execute function public.garder_recapitulatif();

-- À l'enregistrement d'une proposition, l'éventuel `propose` précédent de la conversation est remplacé ; hors Pro, ou sur
-- une conversation terminée, la proposition naît expirée. Le verrou sérialise deux propositions d'un même tour, et une
-- proposition qui croiserait une application ou le retour en Free.
create function public.proposer_recapitulatif()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(17, hashtext(new.entreprise_id::text));
  new.applique_le := null;
  new.crees := '{}';
  if new.statut <> 'propose' then
    return new;
  end if;
  if (select plan from public.entreprise where id = new.entreprise_id) is distinct from 'pro'
    or not exists (select 1 from public.conversation where id = new.conversation_id and terminee_le is null) then
    new.statut := 'expire';
    return new;
  end if;
  update public.recapitulatif set statut = 'remplace'
  where conversation_id = new.conversation_id and statut = 'propose';
  return new;
end;
$$;

revoke execute on function public.proposer_recapitulatif() from public, anon, authenticated;

create trigger proposer_recapitulatif
  before insert on public.recapitulatif
  for each row execute function public.proposer_recapitulatif();

-- « Nouvelle conversation », ou une conversation de plus de 30 jours remplacée : ses récapitulatifs en attente expirent.
create function public.expirer_recapitulatifs_de_la_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.recapitulatif set statut = 'expire' where conversation_id = new.id and statut = 'propose';
  return null;
end;
$$;

revoke execute on function public.expirer_recapitulatifs_de_la_conversation() from public, anon, authenticated;

create trigger expirer_recapitulatifs_de_la_conversation
  after update of terminee_le on public.conversation
  for each row
  when (old.terminee_le is null and new.terminee_le is not null)
  execute function public.expirer_recapitulatifs_de_la_conversation();

-- Au retour en Free, aucun récapitulatif en attente ne reste applicable.
create function public.expirer_recapitulatifs_au_retour_free()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(17, hashtext(new.id::text));
  update public.recapitulatif set statut = 'expire' where entreprise_id = new.id and statut = 'propose';
  return null;
end;
$$;

revoke execute on function public.expirer_recapitulatifs_au_retour_free() from public, anon, authenticated;

create trigger expirer_recapitulatifs_au_retour_free
  after update of plan on public.entreprise
  for each row
  when (old.plan = 'pro' and new.plan = 'free')
  execute function public.expirer_recapitulatifs_au_retour_free();

-- « Confirmer » : applique les lignes d'un récapitulatif en attente, dans l'ordre, sous la session du gestionnaire. Le
-- serveur les a revérifiées juste avant (src/lib/flotte/recapitulatif.ts) ; la fonction ne fait qu'écrire, avec des
-- gardes : l'élément visé n'a pas changé depuis la proposition (« avant »), n'est pas archivé, une affectation à clôturer
-- est encore ouverte, et un véhicule en lecture seule ne se modifie pas. Une garde qui échoue lève
-- `recapitulatif_ligne_perimee` ; toute erreur, une contrainte comprise, est relevée avec la ligne en cause dans son
-- détail ({"ligne": n, "contrainte": …}), et annule toute la transaction. Renvoie { applique_le, crees }.
create function public.appliquer_recapitulatif(p_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_entreprise uuid := public.mon_entreprise_id();
  v_lignes jsonb;
  v_ligne jsonb;
  v_rang bigint;
  v_cible uuid;
  v_avant jsonb;
  v_apres jsonb;
  v_champ text;
  v_ref jsonb;
  v_id uuid;
  v_crees jsonb := '{}';
  v_applique_le timestamptz;
  v_etat text;
  v_message text;
  v_contrainte text;
begin
  if v_entreprise is null then
    raise exception using errcode = 'P0001', message = 'recapitulatif_plus_applicable';
  end if;
  perform pg_advisory_xact_lock(17, hashtext(v_entreprise::text));
  if (select plan from public.entreprise where id = v_entreprise) is distinct from 'pro' then
    raise exception using errcode = 'P0001', message = 'recapitulatif_pro';
  end if;

  -- CONSERVATION_JOURS (src/lib/agent/regles.ts) : une conversation de plus de 30 jours n'est plus consultable.
  select r.lignes into v_lignes
  from public.recapitulatif r
  join public.conversation c on c.id = r.conversation_id
  where r.id = p_id
    and r.statut = 'propose'
    and c.terminee_le is null
    and c.debut >= now() - interval '30 days'
  for update of r;
  if v_lignes is null then
    raise exception using errcode = 'P0001', message = 'recapitulatif_plus_applicable';
  end if;

  for v_ligne, v_rang in select value, ordinality from jsonb_array_elements(v_lignes) with ordinality loop
    begin
      v_cible := (v_ligne ->> 'cible')::uuid;
      v_avant := coalesce(v_ligne -> 'avant', '{}');
      v_apres := coalesce(v_ligne -> 'apres', '{}');
      -- Le véhicule et le conducteur d'une affectation : un élément existant ({"id"}), ou celui qu'une ligne précédente
      -- vient de créer ({"ligne"}).
      foreach v_champ in array array['vehicule_id', 'conducteur_id'] loop
        v_ref := v_apres -> v_champ;
        if jsonb_typeof(v_ref) = 'object' then
          v_apres := v_apres || jsonb_build_object(v_champ, coalesce(v_crees ->> (v_ref ->> 'ligne'), v_ref ->> 'id'));
        end if;
      end loop;

      case v_ligne ->> 'operation'
        when 'creer_vehicule' then
          insert into public.vehicule (plaque, modele, type)
          select r.plaque, r.modele, r.type from jsonb_populate_record(null::public.vehicule, v_apres) r
          returning id into v_id;
          v_crees := v_crees || jsonb_build_object(v_rang::text, v_id);

        when 'modifier_vehicule' then
          update public.vehicule v
          set (plaque, modele, type) = (select r.plaque, r.modele, r.type from jsonb_populate_record(v, v_apres) r)
          where v.id = v_cible
            and v.archive_le is null
            and v.lecture_seule_le is null
            and jsonb_populate_record(v, v_avant) is not distinct from v;
          if not found then
            raise exception using errcode = 'P0001', message = 'recapitulatif_ligne_perimee';
          end if;

        when 'archiver_vehicule' then
          update public.vehicule set archive_le = now() where id = v_cible and archive_le is null;
          if not found then
            raise exception using errcode = 'P0001', message = 'recapitulatif_ligne_perimee';
          end if;

        when 'creer_conducteur' then
          insert into public.conducteur (
            civilite, prenom, nom, date_naissance, lieu_naissance, adresse, adresse_complement, code_postal, ville,
            permis_numero, permis_delivre_le, permis_categories, email
          )
          select
            r.civilite, r.prenom, r.nom, r.date_naissance, r.lieu_naissance, r.adresse, r.adresse_complement,
            r.code_postal, r.ville, r.permis_numero, r.permis_delivre_le, r.permis_categories, r.email
          from jsonb_populate_record(null::public.conducteur, v_apres) r
          returning id into v_id;
          v_crees := v_crees || jsonb_build_object(v_rang::text, v_id);

        when 'modifier_conducteur' then
          update public.conducteur c
          set (
            civilite, prenom, nom, date_naissance, lieu_naissance, adresse, adresse_complement, code_postal, ville,
            permis_numero, permis_delivre_le, permis_categories, email
          ) = (
            select
              r.civilite, r.prenom, r.nom, r.date_naissance, r.lieu_naissance, r.adresse, r.adresse_complement,
              r.code_postal, r.ville, r.permis_numero, r.permis_delivre_le, r.permis_categories, r.email
            from jsonb_populate_record(c, v_apres) r
          )
          where c.id = v_cible
            and c.archive_le is null
            and jsonb_populate_record(c, v_avant) is not distinct from c;
          if not found then
            raise exception using errcode = 'P0001', message = 'recapitulatif_ligne_perimee';
          end if;

        when 'archiver_conducteur' then
          update public.conducteur set archive_le = now() where id = v_cible and archive_le is null;
          if not found then
            raise exception using errcode = 'P0001', message = 'recapitulatif_ligne_perimee';
          end if;

        when 'creer_affectation' then
          insert into public.affectation (vehicule_id, conducteur_id, debut, fin)
          select r.vehicule_id, r.conducteur_id, r.debut, r.fin
          from jsonb_populate_record(null::public.affectation, v_apres) r;

        when 'modifier_affectation' then
          update public.affectation a
          set (vehicule_id, conducteur_id, debut, fin) = (
            select r.vehicule_id, r.conducteur_id, r.debut, r.fin from jsonb_populate_record(a, v_apres) r
          )
          where a.id = v_cible
            and jsonb_populate_record(a, v_avant) is not distinct from a
            and not exists (
              select 1 from public.vehicule v where v.id = a.vehicule_id and v.lecture_seule_le is not null
            );
          if not found then
            raise exception using errcode = 'P0001', message = 'recapitulatif_ligne_perimee';
          end if;

        when 'cloturer_affectation' then
          update public.affectation set fin = (v_apres ->> 'fin')::timestamptz where id = v_cible and fin is null;
          if not found then
            raise exception using errcode = 'P0001', message = 'recapitulatif_ligne_perimee';
          end if;

        else
          raise exception using errcode = 'P0001', message = 'recapitulatif_operation_inconnue';
      end case;
    exception when others then
      get stacked diagnostics v_etat = returned_sqlstate, v_message = message_text, v_contrainte = constraint_name;
      raise exception using
        errcode = v_etat,
        message = v_message,
        detail = jsonb_build_object('ligne', v_rang, 'contrainte', nullif(v_contrainte, ''))::text;
    end;
  end loop;

  perform set_config('designo.recapitulatif', p_id::text, true);
  update public.recapitulatif set statut = 'applique', crees = v_crees where id = p_id
  returning applique_le into v_applique_le;
  return jsonb_build_object('applique_le', v_applique_le, 'crees', v_crees);
end;
$$;

revoke execute on function public.appliquer_recapitulatif(uuid) from public, anon;
grant execute on function public.appliquer_recapitulatif(uuid) to authenticated;
