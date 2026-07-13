-- 006 set confirmed_rounds = current_round for in-progress events, which locked
-- the active round's results. Prior rounds must be confirmed; the current paired
-- round stays editable until the director confirms it.
update tournaments
set confirmed_rounds = greatest(current_round - 1, 0)
where status is distinct from 'completed'
  and current_round > 0
  and confirmed_rounds = current_round;
