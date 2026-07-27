-- Opt-in public live viewer for parents / participants
alter table tournaments
  add column if not exists public_token text,
  add column if not exists public_enabled boolean not null default false;

create unique index if not exists idx_tournaments_public_token
  on tournaments (public_token)
  where public_token is not null;
