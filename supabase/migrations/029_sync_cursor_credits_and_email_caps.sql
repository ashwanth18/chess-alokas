-- Security and correctness pass on sync, event credits and certificate email.
--
-- 1. Sync pull uses a server-assigned cursor. updated_at comes from the client's
--    clock, so an offline edit pushed hours later was older than other devices'
--    cursors and never reached them.
-- 2. Event Pass credits are charged once per tournament.
-- 3. Certificate email has daily caps, counted in email_sends.
-- 4. certificate_templates with no tournament are no longer visible to every
--    signed-in user. The API does not read this table through a client role.

-- ---------------------------------------------------------------------------
-- 1. Server-assigned sync cursor
-- ---------------------------------------------------------------------------

-- A row stamped in the future by a fast clock could never be overwritten, because
-- sync keeps the newer updated_at and now clamps incoming timestamps to server time.
update public.tournaments set updated_at = now() where updated_at > now();
update public.categories set updated_at = now() where updated_at > now();
update public.participants set updated_at = now() where updated_at > now();
update public.games set updated_at = now() where updated_at > now();

alter table public.tournaments add column if not exists server_updated_at timestamptz;
alter table public.categories add column if not exists server_updated_at timestamptz;
alter table public.participants add column if not exists server_updated_at timestamptz;
alter table public.games add column if not exists server_updated_at timestamptz;

update public.tournaments set server_updated_at = updated_at where server_updated_at is null;
update public.categories set server_updated_at = updated_at where server_updated_at is null;
update public.participants set server_updated_at = updated_at where server_updated_at is null;
update public.games set server_updated_at = updated_at where server_updated_at is null;

alter table public.tournaments
  alter column server_updated_at set default clock_timestamp(),
  alter column server_updated_at set not null;
alter table public.categories
  alter column server_updated_at set default clock_timestamp(),
  alter column server_updated_at set not null;
alter table public.participants
  alter column server_updated_at set default clock_timestamp(),
  alter column server_updated_at set not null;
alter table public.games
  alter column server_updated_at set default clock_timestamp(),
  alter column server_updated_at set not null;

create or replace function public.set_server_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.server_updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists trg_tournaments_server_updated_at on public.tournaments;
create trigger trg_tournaments_server_updated_at
  before insert or update on public.tournaments
  for each row execute function public.set_server_updated_at();

drop trigger if exists trg_categories_server_updated_at on public.categories;
create trigger trg_categories_server_updated_at
  before insert or update on public.categories
  for each row execute function public.set_server_updated_at();

drop trigger if exists trg_participants_server_updated_at on public.participants;
create trigger trg_participants_server_updated_at
  before insert or update on public.participants
  for each row execute function public.set_server_updated_at();

drop trigger if exists trg_games_server_updated_at on public.games;
create trigger trg_games_server_updated_at
  before insert or update on public.games
  for each row execute function public.set_server_updated_at();

create index if not exists idx_tournaments_server_updated_at
  on public.tournaments(server_updated_at);
create index if not exists idx_categories_server_updated_at
  on public.categories(tournament_id, server_updated_at);
create index if not exists idx_participants_server_updated_at
  on public.participants(tournament_id, server_updated_at);
create index if not exists idx_games_server_updated_at
  on public.games(tournament_id, server_updated_at);

-- ---------------------------------------------------------------------------
-- 2. Event Pass credits
-- ---------------------------------------------------------------------------

alter table public.tournaments
  add column if not exists event_credit_consumed_at timestamptz;

-- Events already live on an Event Pass have been paid for: don't charge them again.
update public.tournaments t
set event_credit_consumed_at = now()
from public.organizations o
where o.id = t.organization_id
  and o.plan_tier = 'event_pass'
  and t.is_published_global = true
  and t.event_credit_consumed_at is null;

-- ---------------------------------------------------------------------------
-- 3. Certificate email caps
-- ---------------------------------------------------------------------------

create table if not exists public.email_sends (
  id uuid primary key default gen_random_uuid(),
  scope_key text not null,
  kind text not null check (kind in ('test', 'bulk')),
  tournament_id uuid references public.tournaments(id) on delete set null,
  user_id uuid,
  recipient_count integer not null check (recipient_count > 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_email_sends_scope
  on public.email_sends(scope_key, kind, created_at desc);

-- API-only: no client policies.
alter table public.email_sends enable row level security;
revoke all on table public.email_sends from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Certificate templates
-- ---------------------------------------------------------------------------

drop policy if exists certificate_templates_via_tournament on public.certificate_templates;
create policy certificate_templates_via_tournament on public.certificate_templates
  for all to authenticated
  using (
    exists (
      select 1 from public.tournaments t
      where t.id = certificate_templates.tournament_id
        and t.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.tournaments t
      where t.id = certificate_templates.tournament_id
        and t.owner_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- 5. Neutral certificate serial prefix
-- ---------------------------------------------------------------------------

-- 'ARCC' belonged to one real event. Only the default changes: stored prefixes stay, so
-- serials already issued and tournaments already numbering under a prefix are unaffected.
alter table public.tournaments alter column cert_serial_prefix set default 'CERT';
