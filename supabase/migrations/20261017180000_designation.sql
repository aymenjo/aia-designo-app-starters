-- Récap ANTAI et passage en « Désigné » (phase 11). Seul le clic du gestionnaire sur « J'ai désigné sur l'ANTAI »
-- passe un avis en `designe`. Les règles et leurs messages vivent dans src/lib/avis/recap.ts ; l'écriture, dans
-- src/lib/avis/avis.ts.

-- La date du clic, d'où les euros évités (phase 15) : 675 € par avis désigné au plus tard le jour de son échéance.
alter table public.avis add column designe_le timestamptz;

-- Désigné ⇔ daté : rouvrir ou classer (phase 12) effacera la date.
alter table public.avis add constraint avis_designe_le check ((statut = 'designe') = (designe_le is not null));

-- Un avis n'est jamais désigné sans conducteur validé.
alter table public.avis add constraint avis_designe_conducteur check (statut <> 'designe' or conducteur_id is not null);

-- L'écriture passe sous la session du gestionnaire : la RLS de la table couvre la colonne.
grant update (designe_le) on public.avis to authenticated;
