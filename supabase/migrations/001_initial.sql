-- Chess Alokas initial schema

create extension if not exists "pgcrypto";

create table if not exists tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  date text,
  style text not null check (style in ('swiss', 'round_robin')),
  rounds integer not null check (rounds > 0),
  status text not null check (status in ('draft', 'ready', 'in_progress', 'completed')),
  current_round integer not null default 0,
  client_id text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  name text not null,
  filter jsonb not null default '{"logic":"and","rules":[]}'::jsonb,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists participants (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  name text not null,
  age integer not null check (age >= 0),
  gender text,
  rating integer,
  club text,
  custom_fields jsonb not null default '{}'::jsonb,
  category_ids uuid[] not null default '{}',
  seed integer,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists games (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  category_id uuid not null references categories(id) on delete cascade,
  round integer not null check (round > 0),
  board integer not null check (board > 0),
  white_id uuid references participants(id),
  black_id uuid references participants(id),
  result text not null check (result in ('1-0', '0-1', '1/2-1/2', 'bye', 'pending')),
  is_bye boolean not null default false,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_categories_tournament on categories(tournament_id);
create index if not exists idx_participants_tournament on participants(tournament_id);
create index if not exists idx_games_tournament_round on games(tournament_id, round);
create index if not exists idx_tournaments_updated on tournaments(updated_at);
create index if not exists idx_categories_updated on categories(updated_at);
create index if not exists idx_participants_updated on participants(updated_at);
create index if not exists idx_games_updated on games(updated_at);
