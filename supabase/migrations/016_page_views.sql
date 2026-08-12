-- Lightweight product page-view analytics (API-only access)

create table if not exists page_views (
  id uuid primary key default gen_random_uuid(),
  path text not null,
  route_key text not null,
  tournament_id uuid null references tournaments(id) on delete set null,
  live_token_hash text null,
  referrer_host text null,
  user_agent text null,
  created_at timestamptz not null default now()
);

create index if not exists idx_page_views_created_at on page_views (created_at desc);
create index if not exists idx_page_views_route_created on page_views (route_key, created_at desc);

alter table page_views enable row level security;
-- No anon/authenticated policies: inserts/reads go through the API (DATABASE_URL / service role).
