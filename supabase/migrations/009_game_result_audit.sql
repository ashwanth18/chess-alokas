-- Floor/director result attribution + audit trail.

alter table games
  add column if not exists result_entered_by_name text,
  add column if not exists result_entered_by_role text
    check (result_entered_by_role is null or result_entered_by_role in ('floor', 'director')),
  add column if not exists result_override_count integer not null default 0
    check (result_override_count >= 0);

create table if not exists game_result_events (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  tournament_id uuid not null references tournaments(id) on delete cascade,
  result text not null,
  previous_result text,
  actor_role text not null check (actor_role in ('floor', 'director')),
  actor_name text,
  actor_user_id uuid,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_game_result_events_game
  on game_result_events(game_id, created_at desc);
create index if not exists idx_game_result_events_tournament
  on game_result_events(tournament_id, created_at desc);

alter table game_result_events enable row level security;

drop policy if exists game_result_events_via_tournament on game_result_events;
create policy game_result_events_via_tournament on game_result_events
  for all
  using (
    exists (
      select 1 from tournaments t
      where t.id = game_result_events.tournament_id
        and t.owner_id = (select auth.uid())
        and t.deleted_at is null
    )
  )
  with check (
    exists (
      select 1 from tournaments t
      where t.id = game_result_events.tournament_id
        and t.owner_id = (select auth.uid())
        and t.deleted_at is null
    )
  );

-- Live pairings: broadcast game changes to the director client
do $$
begin
  if not exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    create publication supabase_realtime;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'games'
  ) then
    alter publication supabase_realtime add table games;
  end if;
end $$;
