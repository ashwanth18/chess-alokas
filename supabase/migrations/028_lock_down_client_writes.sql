-- Security hardening for Chess Alokas 2.0.
--
-- 1. The privilege guards from 023/024 never fired: inside SECURITY DEFINER,
--    current_user is the function owner, and request.jwt.claim.role is a legacy
--    setting PostgREST no longer populates. They now run as SECURITY INVOKER.
-- 2. Every client write goes through the Fastify API, which connects as the table
--    owner. The only table written directly with the anon key is profiles
--    (display name), so all other direct writes are revoked.
-- 3. Registration receipts move from base64 in Postgres to a private storage bucket.
-- 4. Accounts that already own tournaments keep unlimited private use, without
--    publishing rights, now that accounts with no organization get trial limits.

-- ---------------------------------------------------------------------------
-- 1. Guards that really fire
-- ---------------------------------------------------------------------------

create or replace function public.prevent_profile_admin_self_promotion()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.is_platform_admin := false;
    elsif tg_op = 'UPDATE' then
      new.is_platform_admin := old.is_platform_admin;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.prevent_organization_privilege_escalation()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.verification_status := 'pending_review';
      new.plan_tier := 'trial';
      new.trial_ends_at := now() + interval '14 days';
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

-- ---------------------------------------------------------------------------
-- 2. API-only writes
-- ---------------------------------------------------------------------------

revoke insert, update, delete, truncate, references, trigger
  on all tables in schema public
  from anon, authenticated;

-- Tables added by later migrations start locked down too.
alter default privileges in schema public
  revoke insert, update, delete, truncate, references, trigger on tables
  from anon, authenticated;

-- AuthContext.updateDisplayName upserts these columns and nothing else.
grant insert (id, display_name, updated_at) on public.profiles to authenticated;
grant update (display_name, updated_at) on public.profiles to authenticated;

-- A signed-in user could previously approve their own registration directly.
drop policy if exists tournament_registrations_insert_authenticated on public.tournament_registrations;
drop policy if exists tournament_registrations_update_own_or_organizer on public.tournament_registrations;

-- organizations and organization_members policies referenced each other, so any
-- direct read failed with "infinite recursion detected in policy". A definer
-- function reads organizations without re-entering its policies. Write policies on
-- members go too: writes are API-only and they carried the same recursion.
create or replace function public.is_organization_creator(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organizations o
    where o.id = org_id and o.created_by = auth.uid()
  );
$$;

revoke all on function public.is_organization_creator(uuid) from public, anon;
grant execute on function public.is_organization_creator(uuid) to authenticated;

drop policy if exists organization_members_select_own_or_org on public.organization_members;
create policy organization_members_select_own_or_org on public.organization_members
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_organization_creator(organization_id)
    or exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.is_platform_admin = true
    )
  );

drop policy if exists organization_members_insert_owner on public.organization_members;
drop policy if exists organization_members_update_owner on public.organization_members;
drop policy if exists organization_members_delete_owner on public.organization_members;

-- ---------------------------------------------------------------------------
-- 3. Receipts in private storage
-- ---------------------------------------------------------------------------

alter table public.tournament_registrations
  add column if not exists receipt_storage_path text,
  add column if not exists receipt_content_type text;

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'registration-receipts',
      'registration-receipts',
      false,
      5242880,
      array['image/png', 'image/jpeg', 'image/webp', 'application/pdf']
    )
    on conflict (id) do nothing;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Keep existing organizers working
-- ---------------------------------------------------------------------------

do $$
declare
  owner_row record;
  new_org_id uuid;
begin
  for owner_row in
    select distinct t.owner_id
    from public.tournaments t
    where t.owner_id is not null
      and t.organization_id is null
      and not exists (
        select 1 from public.organization_members m where m.user_id = t.owner_id
      )
  loop
    new_org_id := gen_random_uuid();

    insert into public.organizations (
      id, name, slug, verification_status, plan_tier, trial_ends_at,
      max_tournaments_quota, max_players_per_tournament,
      can_publish_global, can_accept_paid_registrations, created_by
    )
    values (
      new_org_id,
      coalesce(
        nullif(trim((select p.display_name from public.profiles p where p.id = owner_row.owner_id)), ''),
        'Organizer workspace'
      ),
      'org-' || replace(new_org_id::text, '-', ''),
      'pending_review', 'pro', null,
      null, null,
      false, false, owner_row.owner_id
    );

    insert into public.organization_members (organization_id, user_id, role)
    values (new_org_id, owner_row.owner_id, 'owner');

    update public.tournaments
    set organization_id = new_org_id
    where owner_id = owner_row.owner_id and organization_id is null;

    update public.profiles
    set default_organization_id = coalesce(default_organization_id, new_org_id),
        account_role = case when account_role = 'participant' then 'organizer' else account_role end
    where id = owner_row.owner_id;
  end loop;
end;
$$;
