-- Prize podium size: top N places per tournament (optional per-category override)

alter table tournaments
  add column if not exists prize_places integer not null default 3
    check (prize_places >= 1 and prize_places <= 20);

alter table categories
  add column if not exists prize_places integer
    check (prize_places is null or (prize_places >= 1 and prize_places <= 20));
