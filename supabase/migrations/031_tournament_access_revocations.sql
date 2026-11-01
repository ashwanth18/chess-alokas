-- Which tournaments each person has lost access to, so their devices can remove them.
--
-- This has to be recorded. Comparing a device's tournaments with what the current user may see
-- can't tell "lost access" from "another account's copy on a shared computer", and would delete
-- the second. Only someone who really lost access gets a row, and only for that person.
--
-- API-only, as in 028: RLS is on and clients get no grants or policies.

create table if not exists public.tournament_access_revocations (
  user_id uuid not null references auth.users(id) on delete cascade,
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  revoked_at timestamptz not null default now(),
  primary key (user_id, tournament_id)
);

create index if not exists idx_tournament_access_revocations_tournament
  on public.tournament_access_revocations(tournament_id);

alter table public.tournament_access_revocations enable row level security;
revoke all on public.tournament_access_revocations from anon, authenticated;
