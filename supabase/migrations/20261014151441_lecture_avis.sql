-- Lecture IA de l'avis (phase 9). Juste après le dépôt, l'API Claude lit le fichier et pré-remplit les champs,
-- chacun avec un niveau de confiance. Les niveaux, les champs à confirmer et le statut dérivé vivent dans
-- src/lib/avis/regles.ts ; la lecture, dans src/lib/avis/lecture.ts.

-- Vide : l'avis n'a jamais été lu (sans clé d'API, ou déposé avant la phase 9). « en_cours » sert de verrou :
-- un avis n'est lu qu'une fois, même si la lecture est demandée deux fois.
create type public.statut_lecture as enum ('en_cours', 'lue', 'echec');

alter table public.avis
  add column lecture_ia public.statut_lecture,
  -- Niveau de confiance par champ requis : « sur », « a_verifier » ou « non_lu ». Une clé absente veut dire
  -- que le gestionnaire a saisi ou confirmé le champ : aucun indicateur ne s'affiche.
  add column confiances jsonb not null default '{}' check (jsonb_typeof(confiances) = 'object');

-- La lecture écrit sous la session du gestionnaire : la RLS de la table couvre ces colonnes.
grant update (confiances, lecture_ia) on public.avis to authenticated;
