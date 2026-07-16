-- Floor arbiter table QR scoring: forfeit results, locks, per-round PIN, table stations.

-- Extend game results for forfeit / absent
alter table games drop constraint if exists games_result_check;
alter table games
  add constraint games_result_check
  check (result in ('1-0', '0-1', '1/2-1/2', 'bye', 'pending', '1-0F', '0-1F', '0-0'));

alter table games
  add column if not exists result_locked_at timestamptz;

alter table tournaments
  add column if not exists arbiter_pin_hash text,
  add column if not exists arbiter_pin_round integer
    check (arbiter_pin_round is null or arbiter_pin_round >= 0),
  add column if not exists table_count integer not null default 0
    check (table_count >= 0);

create table if not exists tournament_tables (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  table_number integer not null check (table_number > 0),
  slug text not null,
  created_at timestamptz not null default now(),
  unique (tournament_id, table_number),
  unique (slug)
);

create index if not exists idx_tournament_tables_tournament
  on tournament_tables(tournament_id);
create index if not exists idx_tournament_tables_slug
  on tournament_tables(slug);
create index if not exists idx_games_tournament_round_board
  on games(tournament_id, round, board)
  where deleted_at is null;

-- Owner-only RLS (service role / API bypasses with secret key)
alter table tournament_tables enable row level security;

create policy tournament_tables_owner_all on tournament_tables
  for all
  using (
    exists (
      select 1 from tournaments t
      where t.id = tournament_tables.tournament_id
        and t.owner_id = auth.uid()
        and t.deleted_at is null
    )
  )
  with check (
    exists (
      select 1 from tournaments t
      where t.id = tournament_tables.tournament_id
        and t.owner_id = auth.uid()
        and t.deleted_at is null
    )
  );
