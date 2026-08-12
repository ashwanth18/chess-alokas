-- FIDE monthly rating list catalog (API-only) + participant fide_id

create extension if not exists pg_trgm;

create table if not exists fide_players (
  fide_id integer primary key,
  name text not null,
  federation text,
  birth_year integer,
  title text,
  sex text,
  standard integer,
  rapid integer,
  blitz integer,
  inactive boolean not null default false
);

create index if not exists idx_fide_players_name on fide_players (name);
create index if not exists idx_fide_players_name_trgm on fide_players using gin (lower(name) gin_trgm_ops);
create index if not exists idx_fide_players_fed_yob on fide_players (federation, birth_year);

create table if not exists fide_players_staging (
  fide_id integer primary key,
  name text not null,
  federation text,
  birth_year integer,
  title text,
  sex text,
  standard integer,
  rapid integer,
  blitz integer,
  inactive boolean not null default false
);

create table if not exists fide_import_meta (
  id integer primary key default 1 check (id = 1),
  imported_at timestamptz,
  player_count integer not null default 0,
  source_url text,
  status text not null default 'idle'
    check (status in ('idle', 'running', 'failed', 'ok')),
  error text,
  updated_at timestamptz not null default now()
);

insert into fide_import_meta (id, status)
values (1, 'idle')
on conflict (id) do nothing;

alter table participants
  add column if not exists fide_id integer;

alter table fide_players enable row level security;
alter table fide_players_staging enable row level security;
alter table fide_import_meta enable row level security;

revoke all on table fide_players from anon, authenticated;
revoke all on table fide_players_staging from anon, authenticated;
revoke all on table fide_import_meta from anon, authenticated;
