-- Lecture IA (phase 9) : une valeur lue sur l'avis, mais refusée par les règles de la saisie (un n° qui n'a pas
-- 10 chiffres), laisse son champ vide. Elle est gardée ici, avec son motif, pour que l'écran la montre : le
-- gestionnaire voit ce que l'IA a relevé, et pourquoi ce n'est pas repris. Une clé par champ requis, de la forme
-- { "valeur": "…", "motif": "…" } ; elle disparaît dès que le gestionnaire remplit le champ.
alter table public.avis
  add column valeurs_refusees jsonb not null default '{}' check (jsonb_typeof(valeurs_refusees) = 'object');

grant update (valeurs_refusees) on public.avis to authenticated;
