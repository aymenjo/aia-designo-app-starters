-- Classer et rouvrir un avis (phase 12). Un avis qui ne donne pas lieu à désignation sort du suivi, avec un motif
-- obligatoire ; un avis désigné ou classé par erreur se rouvre. Les motifs et leurs messages vivent dans
-- src/lib/avis/regles.ts ; l'écriture, dans src/lib/avis/avis.ts.

create type public.motif_classement as enum ('conteste', 'vol_usurpation', 'non_soumis', 'autre');

alter table public.avis
  add column motif_classement public.motif_classement,
  -- Le motif en toutes lettres, pour « Autre » seulement.
  add column motif_libre text check (btrim(motif_libre) <> '' and char_length(motif_libre) <= 200),
  -- La date du clic sur « Classer » : rouvrir l'efface.
  add column classe_le timestamptz;

-- Classé ⇔ daté ⇔ motivé : rouvrir efface la date et le motif, classer un avis désigné efface sa date de désignation.
alter table public.avis add constraint avis_classe_le check ((statut = 'classe') = (classe_le is not null));
alter table public.avis add constraint avis_classe_motif check ((statut = 'classe') = (motif_classement is not null));

-- Un texte libre pour « Autre », et pour lui seul. Sans `is not distinct from`, un motif vide donnerait NULL :
-- le CHECK passerait.
alter table public.avis add constraint avis_motif_libre check (
  (motif_classement is not distinct from 'autre') = (motif_libre is not null)
);

-- L'écriture passe sous la session du gestionnaire : la RLS de la table couvre ces colonnes.
grant update (motif_classement, motif_libre, classe_le) on public.avis to authenticated;
