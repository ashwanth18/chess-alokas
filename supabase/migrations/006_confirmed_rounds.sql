-- Highest round the director has explicitly confirmed as finished.
-- Next round pairing requires confirmed_rounds >= next_round - 1.
alter table tournaments
  add column if not exists confirmed_rounds integer not null default 0
  check (confirmed_rounds >= 0);

-- Existing in-progress tournaments: treat prior rounds as confirmed so pairing
-- is not blocked, but leave the current paired round editable until confirmed.
update tournaments
set confirmed_rounds = greatest(current_round - 1, 0)
where confirmed_rounds = 0
  and current_round > 0;
