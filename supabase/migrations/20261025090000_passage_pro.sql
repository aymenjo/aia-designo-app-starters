-- Passage en Pro (phase 18). Stripe Checkout encaisse l'abonnement, et le webhook signé (src/lib/abonnement/webhook.ts)
-- recopie ici l'état de l'abonnement, d'après l'objet reçu : le plan en découle. Le choix d'appliquer ou non un événement
-- (ordre, abonnement suivi) vit dans src/lib/abonnement/regles.ts.

-- L'abonnement de l'entreprise, tel que Stripe l'a décrit dans le dernier événement appliqué. Comme `plan`, seule la clé
-- secrète écrit ces colonnes : aucun `grant update`. Le gestionnaire les lit, pour l'écran Abonnement.
alter table public.entreprise
  -- Le client Stripe, créé au premier « Passer en Pro » : il porte la raison sociale, l'adresse et le SIREN des factures.
  add column stripe_client_id text unique check (stripe_client_id ~ '^cus_'),
  -- L'abonnement suivi : un autre abonnement du même client n'est appliqué que si celui-ci est vide ou remplaçable.
  add column stripe_abonnement_id text check (stripe_abonnement_id ~ '^sub_'),
  add column abonnement_statut text check (
    abonnement_statut in (
      'incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused'
    )
  ),
  -- La fin de la période payée : le prochain prélèvement, ou la fin de l'abonnement si l'annulation est programmée.
  add column fin_periode timestamptz,
  add column annulation_programmee boolean not null default false,
  -- `created` du dernier événement appliqué : un événement plus ancien, livré en retard, est ignoré.
  add column stripe_evenement_le timestamptz;

-- Les factures envoyées par email (sur `invoice.paid`). Stripe relance un webhook pendant 3 jours, alors que Resend ne
-- garde sa clé d'idempotence que 24 h : la réservation se fait ici avant l'envoi, comme `alerte_envoyee`.
create table public.facture_envoyee (
  facture_id text primary key check (facture_id ~ '^in_'),
  -- La cascade suit l'entreprise : la suppression de compte (phase 20) emporte les réservations.
  entreprise_id uuid not null references public.entreprise (id) on delete cascade,
  envoyee_le timestamptz not null default now()
);

create index facture_envoyee_entreprise_id_idx on public.facture_envoyee (entreprise_id);

-- Seul le webhook y accède, avec la clé secrète : ni le navigateur ni le gestionnaire n'y lisent ou n'y écrivent.
alter table public.facture_envoyee enable row level security;
revoke all on public.facture_envoyee from anon, authenticated;

-- En Pro, aucun avis n'est verrouillé : au passage de Free à Pro, les avis verrouillés de l'entreprise comptent dans le
-- mois de leur dépôt, à Paris (ce qu'ils auraient eu sans quota), et leur lecture IA a lieu à leur ouverture
-- (`aLireApresDeverrouillage`). Le verrou est celui du dépôt : un avis déposé pendant le passage est compté avant, ou
-- après, mais jamais verrouillé en Pro.
create function public.deverrouiller_au_passage_pro()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(17, hashtext(new.id::text));
  update public.avis
  set verrouille = false,
      mois_quota = date_trunc('month', depose_le at time zone 'Europe/Paris')::date,
      deverrouille_le = now()
  where entreprise_id = new.id and verrouille;
  return null;
end;
$$;

revoke execute on function public.deverrouiller_au_passage_pro() from public, anon, authenticated;

create trigger deverrouiller_au_passage_pro
  after update of plan on public.entreprise
  for each row
  when (old.plan = 'free' and new.plan = 'pro')
  execute function public.deverrouiller_au_passage_pro();
