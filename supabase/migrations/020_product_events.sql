-- Anonymous product telemetry: download clicks, desktop launches.
-- No IP, hostname, serial, or laptop model. Country is set by the API from CDN headers.

create table if not exists product_events (
  id uuid primary key default gen_random_uuid(),
  event_name text not null,
  asset_id text null,
  runtime text not null,
  os text null,
  arch text null,
  app_version text null,
  country text null,
  locale text null,
  timezone text null,
  install_id_hash text null,
  user_agent text null,
  created_at timestamptz not null default now()
);

create index if not exists idx_product_events_created_at
  on product_events (created_at desc);

create index if not exists idx_product_events_name_created
  on product_events (event_name, created_at desc);

create index if not exists idx_product_events_country_created
  on product_events (country, created_at desc)
  where country is not null;

create index if not exists idx_product_events_install_created
  on product_events (install_id_hash, created_at desc)
  where install_id_hash is not null;

alter table product_events enable row level security;
-- No anon/authenticated policies: inserts/reads go through the API (service role).
