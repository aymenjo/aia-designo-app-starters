-- Suivi des avis (phase 8) : un n° d'avis est unique dans l'entreprise, et un second avis n'est jamais créé.

-- Les NULL sont distincts : plusieurs dépôts encore sans n° coexistent.
-- Le nom de la contrainte sert à reconnaître le doublon (src/lib/avis/avis.ts).
alter table public.avis add constraint avis_numero_unique unique (entreprise_id, numero);

-- Un avis ne se supprime pas, sauf un dépôt pas encore identifié (sans n°, « À traiter ») dont le n° saisi
-- est déjà celui d'un avis de l'entreprise : il est abandonné. Toujours aucun `grant delete` sur la table :
-- c'est cette fonction qui vérifie tout. Renvoie le fichier du dépôt abandonné, ou NULL si rien n'est supprimé.
-- Reprise par la lecture IA (phase 9) et la relève Gmail (phase 23).
create function public.abandonner_depot_en_double(p_avis uuid, p_numero text)
returns text
language sql
security definer
set search_path = ''
as $$
  delete from public.avis
  where id = p_avis
    and entreprise_id = (select public.mon_entreprise_id())
    and numero is null
    and statut = 'a_traiter'
    and exists (
      select 1 from public.avis existant
      where existant.entreprise_id = (select public.mon_entreprise_id())
        and existant.numero = p_numero
    )
  returning fichier
$$;

revoke execute on function public.abandonner_depot_en_double(uuid, text) from public, anon;
grant execute on function public.abandonner_depot_en_double(uuid, text) to authenticated;

-- Le fichier d'un dépôt abandonné se supprime avec lui. Un fichier ne se supprime qu'une fois qu'aucun avis
-- ne le vise : celui d'un avis enregistré reste intouchable. Le fichier d'un avis est toujours rangé dans le
-- dossier de son entreprise (fichier_dans_dossier) : la RLS de la table suffit à le retrouver.
create policy "Le gestionnaire supprime un fichier qu'aucun avis ne vise"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avis'
    and (storage.foldername(name))[1] = (select public.mon_entreprise_id())::text
    and not exists (select 1 from public.avis where avis.fichier = objects.name)
  );
