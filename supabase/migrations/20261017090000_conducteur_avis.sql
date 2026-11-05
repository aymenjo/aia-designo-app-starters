-- Proposition du conducteur (phase 10). Désigno propose le conducteur de l'affectation qui couvre l'infraction ;
-- le gestionnaire le valide lui-même, d'un clic sur « Valider ce conducteur ». La règle qui l'autorise et ses
-- messages vivent dans src/lib/avis/regles.ts ; l'écriture, dans src/lib/avis/avis.ts.

-- Le conducteur validé par le gestionnaire : vide tant qu'il n'a pas validé. Rien ne l'écrit d'office.
-- Le récap ANTAI (phase 11) le lit ici.
alter table public.avis add column conducteur_id uuid;

-- Comme pour le véhicule : la clé étrangère composite ne vise que le conducteur de sa propre entreprise (sa
-- vérification ignore la RLS). Elle est ignorée quand conducteur_id est vide (MATCH SIMPLE), et refuse la
-- suppression d'un conducteur qui a des avis (23503) : il ne peut qu'être archivé.
alter table public.avis add constraint avis_conducteur_fk foreign key (conducteur_id, entreprise_id)
  references public.conducteur (id, entreprise_id);

create index avis_conducteur_id_idx on public.avis (conducteur_id);

-- L'écriture passe sous la session du gestionnaire : la RLS de la table couvre la colonne.
grant update (conducteur_id) on public.avis to authenticated;
