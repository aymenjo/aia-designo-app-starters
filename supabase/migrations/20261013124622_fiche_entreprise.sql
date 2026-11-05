-- Fiche entreprise (phase 2). Tous les champs sont facultatifs en base : une fiche
-- incomplète s'enregistre. La liste des champs requis et les règles fines (clé du SIREN,
-- clé de TVA) vivent dans src/lib/entreprise/regles.ts.
alter table public.entreprise
  add column raison_sociale text check (char_length(raison_sociale) <= 120),
  add column siren text,
  add column tva text,
  add column representant_prenom text check (char_length(representant_prenom) <= 80),
  add column representant_nom text check (char_length(representant_nom) <= 80),
  add column representant_fonction text check (char_length(representant_fonction) <= 80),
  add column siege_adresse text check (char_length(siege_adresse) <= 120),
  add column siege_complement text check (char_length(siege_complement) <= 120),
  add column siege_code_postal text,
  add column siege_ville text check (char_length(siege_ville) <= 80),
  -- Filet de sécurité sur la forme normalisée. Pas d'unicité du SIREN : elle révélerait
  -- qu'un autre compte l'a déclaré, et permettrait de bloquer celui d'une entreprise.
  add constraint siren_normalise check (siren ~ '^[0-9]{9}$'),
  add constraint tva_normalisee check (tva ~ '^FR[0-9]{11}$'),
  add constraint tva_du_siren check (tva is null or siren is null or substr(tva, 5) = siren),
  add constraint siege_code_postal_normalise check (siege_code_postal ~ '^[0-9]{5}$');

-- La phase 1 n'accordait que la lecture, mais la table gardait les droits exposés par défaut
-- (auto_expose_new_tables). On repart de zéro avant d'ouvrir la modification : le gestionnaire
-- ne modifie que les champs de la fiche, jamais id ni user_id.
revoke all on public.entreprise from anon, authenticated;
grant select on public.entreprise to authenticated;
grant update (
  raison_sociale, siren, tva,
  representant_prenom, representant_nom, representant_fonction,
  siege_adresse, siege_complement, siege_code_postal, siege_ville
) on public.entreprise to authenticated;

create policy "Le gestionnaire modifie son entreprise"
  on public.entreprise for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
