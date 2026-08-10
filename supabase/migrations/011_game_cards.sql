-- Yellow (warning) / red (illegal move) cards per game player.

create table if not exists game_cards (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  tournament_id uuid not null references tournaments(id) on delete cascade,
  player_id uuid not null references participants(id) on delete cascade,
  card_type text not null check (card_type in ('illegal_move', 'warning')),
  note text,
  actor_role text not null check (actor_role in ('floor', 'director')),
  actor_name text,
  actor_user_id uuid,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_game_cards_game
  on game_cards(game_id, created_at asc);
create index if not exists idx_game_cards_tournament
  on game_cards(tournament_id, created_at desc);
create index if not exists idx_game_cards_game_player_type
  on game_cards(game_id, player_id, card_type)
  where deleted_at is null;

alter table game_cards enable row level security;

drop policy if exists game_cards_via_tournament on game_cards;
create policy game_cards_via_tournament on game_cards
  for all
  using (
    exists (
      select 1 from tournaments t
      where t.id = game_cards.tournament_id
        and t.owner_id = (select auth.uid())
        and t.deleted_at is null
    )
  )
  with check (
    exists (
      select 1 from tournaments t
      where t.id = game_cards.tournament_id
        and t.owner_id = (select auth.uid())
        and t.deleted_at is null
    )
  );
