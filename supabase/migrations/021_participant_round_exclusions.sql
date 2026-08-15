-- Per-round absent / withdraw (Swiss-Manager Exclude player).
-- Keep history: never hard-delete a player who has already been paired.

alter table participants
  add column if not exists excluded_rounds integer[] not null default '{}',
  add column if not exists withdrawn_from_round integer;

alter table participants
  drop constraint if exists participants_withdrawn_from_round_check;

alter table participants
  add constraint participants_withdrawn_from_round_check
  check (withdrawn_from_round is null or withdrawn_from_round > 0);
