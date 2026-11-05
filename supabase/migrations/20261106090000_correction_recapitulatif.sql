-- Récapitulatif : lignes rouges et « Modifier » (phase 30, Pro). Une ligne que les règles des écrans refusent s'enregistre
-- quand même, en rouge, avec le motif des écrans (`refus` dans la ligne, sans avant ni après) : le gestionnaire la voit,
-- et « Confirmer » reste désactivé. « Modifier » envoie une demande marquée du récapitulatif à corriger : le serveur le
-- passe à `remplace`, joint ses lignes à la demande, et l'agent le refait. Les règles et leurs messages restent en
-- TypeScript (src/lib/flotte/regles-recapitulatif.ts) ; le traitement d'une demande, dans src/lib/agent/demande.ts.
--
-- Pas de nouveau statut : un récapitulatif corrigé est `remplace`, comme celui qu'un nouveau récapitulatif remplace. La
-- colonne `message.correction` part en cascade avec le message (purge à 30 jours, suppression de compte, phase 20) ;
-- rien n'est à prévoir pour le retour en Free (phase 19), où plus aucune demande n'est traitée.

alter table public.message
  -- La demande envoyée par « Modifier » : « Corrige le récapitulatif » est rappelé sous sa bulle. Sur une demande du
  -- gestionnaire seulement.
  add column correction boolean not null default false,
  add constraint message_correction check (role = 'gestionnaire' or not correction);

-- Le gestionnaire lit la marque de ses messages ; toujours aucune écriture sous sa session.
grant select (correction) on public.message to authenticated;

-- `appliquer_recapitulatif` (phase 29), avec la garde des lignes rouges avant la boucle ; le reste est inchangé.
create or replace function public.appliquer_recapitulatif(p_id uuid)
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

  -- Phase 30 : une ligne rouge (refusée par les règles des écrans, avec son motif) ne s'applique jamais. « Confirmer »
  -- est désactivé et le serveur refuse avant ; la fonction refuse aussi un appel direct, en nommant la première.
  select ordinality into v_rang
  from jsonb_array_elements(v_lignes) with ordinality
  where value ? 'refus'
  order by ordinality
  limit 1;
  if v_rang is not null then
    raise exception using
      errcode = 'P0001',
      message = 'recapitulatif_ligne_impossible',
      detail = jsonb_build_object('ligne', v_rang)::text;
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
