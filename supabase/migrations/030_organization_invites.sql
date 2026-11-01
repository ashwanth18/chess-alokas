-- Staff invitations, plus what the team feature needs on organization_members.
--
-- Access is API-only, as in 028: RLS is on and clients get no grants or policies, so the
-- API (connected as table owner) is the only reader and writer.

create table if not exists public.organization_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null check (email = lower(email) and position('@' in email) > 1),
  role text not null check (role in ('owner', 'admin', 'director', 'arbiter')),
  -- SHA-256 of the link's token. The token itself is never stored.
  token_hash text not null unique,
  invited_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_organization_invites_org
  on public.organization_invites(organization_id, created_at desc);

-- One open invite per address per organization. An expired one is revoked before a new
-- one is created, so the API needs no expiry in this predicate.
create unique index if not exists uq_organization_invites_open
  on public.organization_invites(organization_id, email)
  where accepted_at is null and revoked_at is null;

alter table public.organization_invites enable row level security;
revoke all on public.organization_invites from anon, authenticated;

alter table public.organization_members
  -- The address a member joined with, for the team list and the "already a member" check.
  add column if not exists email text,
  -- When this person's access last changed. Sync pull redelivers an organization's
  -- tournaments after it, since their rows are older than the member's cursor.
  add column if not exists access_changed_at timestamptz not null default now();

create index if not exists idx_organization_members_org_email
  on public.organization_members(organization_id, email);

-- The API treated a creator with no member row as an owner, and such a person would not
-- count when protecting the last owner. Give each of them a real row.
insert into public.organization_members (organization_id, user_id, role)
select o.id, o.created_by, 'owner'
from public.organizations o
where o.created_by is not null
on conflict (organization_id, user_id) do nothing;

update public.organization_members m
set email = lower(u.email)
from auth.users u
where u.id = m.user_id and m.email is null and u.email is not null;
