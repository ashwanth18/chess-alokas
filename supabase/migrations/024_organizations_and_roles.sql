-- Multi-tenant B2B organizations, organization memberships, and account roles

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  logo_url text,
  description text,
  website text,
  contact_email text,
  contact_phone text,
  city text,
  state text,
  country text default 'Malaysia',
  verification_status text not null default 'pending_review'
    check (verification_status in ('pending_review', 'verified', 'rejected', 'suspended')),
  plan_tier text not null default 'trial'
    check (plan_tier in ('trial', 'event_pass', 'pro', 'enterprise')),
  trial_ends_at timestamptz default (now() + interval '14 days'),
  max_tournaments_quota integer default 1,
  max_players_per_tournament integer default 24,
  event_credits_remaining integer not null default 0,
  can_publish_global boolean not null default false,
  can_accept_paid_registrations boolean not null default false,
  payment_instructions text,
  payment_qr_storage_path text,
  created_by uuid references auth.users(id) on delete set null,
  verified_at timestamptz,
  verified_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_organizations_created_by on public.organizations(created_by);
create index if not exists idx_organizations_verification_status on public.organizations(verification_status);

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner'
    check (role in ('owner', 'admin', 'director', 'arbiter')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create index if not exists idx_organization_members_user on public.organization_members(user_id);

alter table public.profiles
  add column if not exists account_role text not null default 'participant'
    check (account_role in ('participant', 'organizer', 'both')),
  add column if not exists default_organization_id uuid references public.organizations(id) on delete set null;

alter table public.tournaments
  add column if not exists organization_id uuid references public.organizations(id) on delete set null;

create index if not exists idx_tournaments_organization on public.tournaments(organization_id);

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;

drop policy if exists organizations_select_member_or_admin on public.organizations;
create policy organizations_select_member_or_admin on public.organizations
  for select to authenticated
  using (
    created_by = (select auth.uid())
    or exists (
      select 1 from public.organization_members m
      where m.organization_id = organizations.id
        and m.user_id = (select auth.uid())
    )
    or exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.is_platform_admin = true
    )
  );

drop policy if exists organizations_insert_own on public.organizations;
create policy organizations_insert_own on public.organizations
  for insert to authenticated
  with check (created_by = (select auth.uid()));

drop policy if exists organizations_update_member_or_admin on public.organizations;
create policy organizations_update_member_or_admin on public.organizations
  for update to authenticated
  using (
    created_by = (select auth.uid())
    or exists (
      select 1 from public.organization_members m
      where m.organization_id = organizations.id
        and m.user_id = (select auth.uid())
        and m.role in ('owner', 'admin')
    )
    or exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.is_platform_admin = true
    )
  )
  with check (
    created_by = (select auth.uid())
    or exists (
      select 1 from public.organization_members m
      where m.organization_id = organizations.id
        and m.user_id = (select auth.uid())
        and m.role in ('owner', 'admin')
    )
    or exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.is_platform_admin = true
    )
  );

drop policy if exists organization_members_select_own_or_org on public.organization_members;
create policy organization_members_select_own_or_org on public.organization_members
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.organizations o
      where o.id = organization_members.organization_id
        and o.created_by = (select auth.uid())
    )
    or exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.is_platform_admin = true
    )
  );

drop policy if exists organization_members_insert_owner on public.organization_members;
create policy organization_members_insert_owner on public.organization_members
  for insert to authenticated
  with check (
    exists (
      select 1 from public.organizations o
      where o.id = organization_members.organization_id
        and o.created_by = (select auth.uid())
    )
    or exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.is_platform_admin = true
    )
  );

drop policy if exists organization_members_update_owner on public.organization_members;
create policy organization_members_update_owner on public.organization_members
  for update to authenticated
  using (
    exists (
      select 1 from public.organizations o
      where o.id = organization_members.organization_id
        and o.created_by = (select auth.uid())
    )
    or exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.is_platform_admin = true
    )
  )
  with check (
    exists (
      select 1 from public.organizations o
      where o.id = organization_members.organization_id
        and o.created_by = (select auth.uid())
    )
    or exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.is_platform_admin = true
    )
  );

drop policy if exists organization_members_delete_owner on public.organization_members;
create policy organization_members_delete_owner on public.organization_members
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.organizations o
      where o.id = organization_members.organization_id
        and o.created_by = (select auth.uid())
    )
    or exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.is_platform_admin = true
    )
  );

-- Prevent authenticated/anon users from self-upgrading privileged quota & verification columns
create or replace function public.prevent_organization_privilege_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon')
     or coalesce(current_setting('request.jwt.claim.role', true), '') in ('authenticated', 'anon')
  then
    if tg_op = 'INSERT' then
      new.verification_status := 'pending_review';
      new.plan_tier := 'trial';
      new.trial_ends_at := coalesce(new.trial_ends_at, now() + interval '14 days');
      new.max_tournaments_quota := 1;
      new.max_players_per_tournament := 24;
      new.event_credits_remaining := 0;
      new.can_publish_global := false;
      new.can_accept_paid_registrations := false;
      new.verified_at := null;
      new.verified_by := null;
    elsif tg_op = 'UPDATE' then
      new.verification_status := old.verification_status;
      new.plan_tier := old.plan_tier;
      new.trial_ends_at := old.trial_ends_at;
      new.max_tournaments_quota := old.max_tournaments_quota;
      new.max_players_per_tournament := old.max_players_per_tournament;
      new.event_credits_remaining := old.event_credits_remaining;
      new.can_publish_global := old.can_publish_global;
      new.can_accept_paid_registrations := old.can_accept_paid_registrations;
      new.verified_at := old.verified_at;
      new.verified_by := old.verified_by;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_organization_privilege_escalation on public.organizations;
create trigger trg_prevent_organization_privilege_escalation
  before insert or update on public.organizations
  for each row
  execute function public.prevent_organization_privilege_escalation();
