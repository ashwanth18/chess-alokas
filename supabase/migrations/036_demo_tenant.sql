-- The demo tenant: a fictional organization and accounts for showing the product. See docs/DEMO.md.
--
-- Additive, and needs nothing newer than 032, so it can be applied alone. Nothing changes for any
-- organization or account until the demo command marks one.
--
-- The rules are here as well as in the API so that they hold on an API build that predates them.
-- Such a build shows a generic error where a current one explains. `app.demo_seed` is set only by
-- the demo command, for one transaction.

alter table public.organizations
  add column if not exists is_demo boolean not null default false;

create index if not exists idx_organizations_is_demo
  on public.organizations(is_demo) where is_demo;

-- Which sign-in accounts are demo accounts. A separate table rather than an email pattern, so the
-- check can't be met by someone signing up with a similar address.
create table if not exists public.demo_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  label text not null,
  -- Lets the demo command set a password or delete the account. Null, or past, means locked.
  credentials_unlocked_until timestamptz,
  created_at timestamptz not null default now()
);

alter table public.demo_accounts enable row level security;
revoke all on public.demo_accounts from anon, authenticated;

-- Every tournament that counts as demo, soft-deleted ones included. Metrics exclude these.
create or replace view public.demo_tournament_ids
with (security_invoker = true) as
  select t.id
  from public.tournaments t
  where t.organization_id in (select o.id from public.organizations o where o.is_demo)
     or (
       t.organization_id is null
       and t.owner_id in (select d.user_id from public.demo_accounts d)
     );

revoke all on public.demo_tournament_ids from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Boundaries between demo and real
-- ---------------------------------------------------------------------------

create or replace function public.demo_tournament_flag(p_tournament_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select coalesce(o.is_demo, false)
      or (t.organization_id is null and exists (
        select 1 from public.demo_accounts d where d.user_id = t.owner_id
      ))
    from public.tournaments t
    left join public.organizations o on o.id = t.organization_id
    where t.id = p_tournament_id
  ), false)
$$;

revoke all on function public.demo_tournament_flag(uuid) from public, anon, authenticated;

create or replace function public.enforce_demo_boundaries()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  org_is_demo boolean;
  user_is_demo boolean;
begin
  if current_setting('app.demo_seed', true) = 'on' then
    return new;
  end if;

  if tg_table_name = 'tournament_registrations' then
    user_is_demo := new.submitted_by_user_id is not null and exists (
      select 1 from public.demo_accounts d where d.user_id = new.submitted_by_user_id
    );
    if public.demo_tournament_flag(new.tournament_id) then
      if not user_is_demo then
        raise exception 'This is a demo event, so entries are not accepted.' using errcode = 'P0001';
      end if;
    elsif user_is_demo then
      raise exception 'Demo accounts cannot enter real tournaments.' using errcode = 'P0001';
    end if;

  elsif tg_table_name = 'email_sends' then
    if new.tournament_id is not null and public.demo_tournament_flag(new.tournament_id) then
      raise exception 'Demo tournaments do not send email.' using errcode = 'P0001';
    end if;

  elsif tg_table_name = 'organization_invites' then
    select o.is_demo into org_is_demo from public.organizations o where o.id = new.organization_id;
    if coalesce(org_is_demo, false) then
      raise exception 'The demo organization does not send invites.' using errcode = 'P0001';
    end if;

  elsif tg_table_name = 'organization_members' then
    select o.is_demo into org_is_demo from public.organizations o where o.id = new.organization_id;
    user_is_demo := exists (select 1 from public.demo_accounts d where d.user_id = new.user_id);
    if coalesce(org_is_demo, false) <> user_is_demo then
      raise exception 'Demo accounts and demo organizations only mix with each other.'
        using errcode = 'P0001';
    end if;

  elsif tg_table_name = 'organizations' then
    if not new.is_demo and new.created_by is not null and exists (
      select 1 from public.demo_accounts d where d.user_id = new.created_by
    ) then
      raise exception 'Demo accounts cannot create organizations.' using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

-- A trigger function: fires without this, and nobody needs to be able to call it.
revoke all on function public.enforce_demo_boundaries() from public, anon, authenticated;

drop trigger if exists trg_demo_boundaries on public.tournament_registrations;
create trigger trg_demo_boundaries
  before insert on public.tournament_registrations
  for each row execute function public.enforce_demo_boundaries();

drop trigger if exists trg_demo_boundaries on public.email_sends;
create trigger trg_demo_boundaries
  before insert on public.email_sends
  for each row execute function public.enforce_demo_boundaries();

drop trigger if exists trg_demo_boundaries on public.organization_invites;
create trigger trg_demo_boundaries
  before insert on public.organization_invites
  for each row execute function public.enforce_demo_boundaries();

drop trigger if exists trg_demo_boundaries on public.organization_members;
create trigger trg_demo_boundaries
  before insert on public.organization_members
  for each row execute function public.enforce_demo_boundaries();

drop trigger if exists trg_demo_boundaries on public.organizations;
create trigger trg_demo_boundaries
  before insert on public.organizations
  for each row execute function public.enforce_demo_boundaries();

-- ---------------------------------------------------------------------------
-- Shared accounts can't be taken over
-- ---------------------------------------------------------------------------

-- A visitor signed in to a shared demo account could otherwise call Supabase directly and change
-- its password or email, locking everyone else out. Hiding the form wouldn't stop that. Accounts
-- not in demo_accounts return at the first check.
--
-- to_jsonb because these columns belong to Supabase: a renamed column should stop protecting the
-- demo accounts, not break every sign-in on the platform.
create or replace function public.protect_demo_account_credentials()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  was jsonb;
  now_is jsonb;
begin
  if not exists (
    select 1 from public.demo_accounts d
    where d.user_id = old.id
      and (d.credentials_unlocked_until is null or d.credentials_unlocked_until < now())
  ) then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Demo accounts cannot be deleted.' using errcode = 'P0001';
  end if;

  was := to_jsonb(old);
  now_is := to_jsonb(new);
  if (was->>'encrypted_password') is distinct from (now_is->>'encrypted_password')
     or (was->>'email') is distinct from (now_is->>'email')
     or (was->>'phone') is distinct from (now_is->>'phone')
     or (
       coalesce(now_is->>'email_change', '') <> ''
       and (was->>'email_change') is distinct from (now_is->>'email_change')
     )
     or (
       coalesce(now_is->>'phone_change', '') <> ''
       and (was->>'phone_change') is distinct from (now_is->>'phone_change')
     )
  then
    raise exception 'Demo accounts cannot change their password, email or phone.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.protect_demo_account_credentials() from public, anon, authenticated;

-- Supabase owns this table and may refuse. Everything above is still worth having, so this warns
-- rather than failing the migration. `pnpm demo:seed --dry-run` reports whether the lock is on.
do $$
begin
  drop trigger if exists trg_protect_demo_account_credentials on auth.users;
  create trigger trg_protect_demo_account_credentials
    before update or delete on auth.users
    for each row execute function public.protect_demo_account_credentials();
exception when insufficient_privilege then
  raise warning 'Could not add the demo account lock to auth.users: %', sqlerrm;
end;
$$;
