-- Participant email for digital certificates
alter table participants add column if not exists email text;

-- Award scope: overall standings vs per category for winners certificates
alter table tournaments
  add column if not exists award_scope text not null default 'per_category'
  check (award_scope in ('overall', 'per_category'));

-- Certificate template metadata (PDF lives in storage / local files)
create table if not exists certificate_templates (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid references tournaments(id) on delete cascade,
  name text not null,
  storage_path text not null,
  layout_json jsonb not null default '{"pageWidth":842,"pageHeight":595,"fields":[]}'::jsonb,
  cert_type text not null default 'participation'
    check (cert_type in ('participation', 'winner')),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Issued digital certificates
create table if not exists certificate_issues (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  participant_id uuid references participants(id) on delete set null,
  type text not null check (type in ('participation', 'winner')),
  rank integer,
  category_id uuid references categories(id) on delete set null,
  recipient_email text,
  recipient_name text not null,
  storage_path text not null,
  content_sha256 text not null,
  byte_size integer not null default 0,
  status text not null default 'pending'
    check (status in ('pending', 'stored', 'emailed', 'failed')),
  emailed_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists idx_certificate_issues_tournament on certificate_issues(tournament_id);
create index if not exists idx_certificate_templates_tournament on certificate_templates(tournament_id);
