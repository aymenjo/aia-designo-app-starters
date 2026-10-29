-- Email au conducteur (phase 21). Au clic sur « J'ai désigné sur l'ANTAI », le gestionnaire Pro peut prévenir le
-- conducteur : l'email part d'abord, puis l'avis passe « Désigné ». Le contenu de l'email vit dans
-- src/lib/avis/email-conducteur.ts ; l'écriture, dans src/lib/avis/avis.ts.

-- La trace de l'email, datée comme `designe_le` : classer ou rouvrir l'avis l'efface avec elle.
alter table public.avis add column conducteur_prevenu_le timestamptz;

-- Un conducteur n'est prévenu que d'un avis désigné.
alter table public.avis add constraint avis_conducteur_prevenu check (conducteur_prevenu_le is null or statut = 'designe');

-- L'écriture passe sous la session du gestionnaire : la RLS de la table couvre la colonne.
grant update (conducteur_prevenu_le) on public.avis to authenticated;
