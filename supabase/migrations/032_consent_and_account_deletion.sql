-- Guardian consent records, and what account deletion needs to finish the job later.

-- ---------------------------------------------------------------------------
-- 1. Consent. Timestamps come from the API, never from a client.
-- ---------------------------------------------------------------------------

alter table public.tournament_registrations
  add column if not exists guardian_consent_at timestamptz,
  add column if not exists guardian_consent_notice_version text,
  add column if not exists guardian_consent_by_user_id uuid references auth.users(id) on delete set null;

alter table public.player_profiles
  add column if not exists guardian_consent_at timestamptz,
  add column if not exists guardian_consent_notice_version text,
  add column if not exists guardian_consent_by_user_id uuid references auth.users(id) on delete set null;

-- An organizer confirming they hold consent for a roster they import. API-only, as in 028.
create table if not exists public.roster_consent_confirmations (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  confirmed_by_user_id uuid references auth.users(id) on delete set null,
  -- When the organizer ticked the box. An import can happen offline, so this can be earlier than:
  confirmed_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  notice_version text not null,
  -- Sync sends the same confirmation again until the row settles, so it is recorded once.
  unique (tournament_id, confirmed_at)
);

alter table public.roster_consent_confirmations enable row level security;
revoke all on public.roster_consent_confirmations from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Account deletion: work the scheduled purge finishes later
-- ---------------------------------------------------------------------------

alter table public.tournament_registrations
  add column if not exists receipt_purge_after timestamptz;

create index if not exists idx_tournament_registrations_receipt_purge
  on public.tournament_registrations(receipt_purge_after)
  where receipt_purge_after is not null;

alter table public.tournaments
  add column if not exists purge_after timestamptz;

create index if not exists idx_tournaments_purge_after
  on public.tournaments(purge_after)
  where purge_after is not null;

alter table public.organizations
  add column if not exists closed_at timestamptz,
  add column if not exists anonymise_after timestamptz;

create index if not exists idx_organizations_anonymise_after
  on public.organizations(anonymise_after)
  where anonymise_after is not null;

-- ---------------------------------------------------------------------------
-- 3. Links in usage statistics
-- ---------------------------------------------------------------------------

-- A live link is a credential: anyone holding it sees the page. live_token_hash already records
-- which link was used, so the path needs neither the link nor any query string.
update public.page_views
set path = regexp_replace(
  regexp_replace(path, '[?#].*$', ''),
  '/(live|t|invite)/[^/]+',
  '/\1/[redacted]',
  'g'
)
where path ~ '[?#]' or path ~ '/(live|t|invite)/[^/]+';
