-- Organization-aware database rules.
--
-- Until now the core tables checked only the personal owner_id, so:
--   (a) nothing in the database separated one organization from another except that check;
--   (b) an invited director who didn't create a tournament got no browser live updates, because
--       Supabase Realtime applies these policies for the subscriber's role.
--
-- After this migration a tournament is readable by the people the API's role table allows:
--   tournaments, tournament_tables, floor_alerts: owner_id, organization owner/admin/director, arbiter
--   everything else tournament-owned:             owner_id, organization owner/admin/director
-- Platform admins have no direct rule for tournament data today, so none is added: their dashboard
-- reads aggregates through the API. They keep reading organizations and members as before.
--
-- Client access stays select-only, as 028 established. The one exception stays too: a user's own
-- profiles.display_name.

-- ---------------------------------------------------------------------------
-- 1. The helper
-- ---------------------------------------------------------------------------

-- Returns ids rather than deciding one row at a time. A policy written as
-- `tournament_id in (select public.readable_tournament_ids())` runs this once per statement and
-- then hash-probes, instead of calling a function for every row of a large games table. Each branch
-- starts from an indexed column: idx_tournaments_owner, idx_organization_members_user,
-- idx_organizations_created_by, then idx_tournaments_organization.
--
-- SECURITY DEFINER reads tournaments and membership without re-entering their policies, so the
-- policies below can't recurse. The search path is empty and every name is qualified.
create or replace function public.readable_tournament_ids(include_arbiter boolean default false)
returns setof uuid
language sql
stable
security definer
set search_path = ''
rows 50
as $$
  select t.id
  from public.tournaments t
  where t.owner_id = auth.uid()
    and t.deleted_at is null
  union
  select t.id
  from public.organization_members m
  join public.tournaments t on t.organization_id = m.organization_id
  where m.user_id = auth.uid()
    and t.deleted_at is null
    and (m.role in ('owner', 'admin', 'director') or (include_arbiter and m.role = 'arbiter'))
  union
  -- The API treats a creator with no member row as an owner. A member row, if any, decides.
  select t.id
  from public.organizations o
  join public.tournaments t on t.organization_id = o.id
  where o.created_by = auth.uid()
    and t.deleted_at is null
    and not exists (
      select 1 from public.organization_members m
      where m.organization_id = o.id and m.user_id = auth.uid()
    )
$$;

revoke all on function public.readable_tournament_ids(boolean) from public, anon;
grant execute on function public.readable_tournament_ids(boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Read policies
-- ---------------------------------------------------------------------------

drop policy if exists tournaments_owner_all on public.tournaments;
drop policy if exists tournaments_read_by_staff on public.tournaments;
create policy tournaments_read_by_staff on public.tournaments
  for select to authenticated
  using (id in (select public.readable_tournament_ids(true)));

drop policy if exists tournament_tables_owner_all on public.tournament_tables;
drop policy if exists tournament_tables_read_by_staff on public.tournament_tables;
create policy tournament_tables_read_by_staff on public.tournament_tables
  for select to authenticated
  using (tournament_id in (select public.readable_tournament_ids(true)));

drop policy if exists floor_alerts_select_organizer on public.floor_alerts;
drop policy if exists floor_alerts_read_by_staff on public.floor_alerts;
create policy floor_alerts_read_by_staff on public.floor_alerts
  for select to authenticated
  using (tournament_id in (select public.readable_tournament_ids(true)));

drop policy if exists categories_via_tournament on public.categories;
drop policy if exists categories_read_by_managers on public.categories;
create policy categories_read_by_managers on public.categories
  for select to authenticated
  using (tournament_id in (select public.readable_tournament_ids()));

drop policy if exists participants_via_tournament on public.participants;
drop policy if exists participants_read_by_managers on public.participants;
create policy participants_read_by_managers on public.participants
  for select to authenticated
  using (tournament_id in (select public.readable_tournament_ids()));

-- apps/web/src/lib/gamesRealtime.ts needs this one.
drop policy if exists games_via_tournament on public.games;
drop policy if exists games_read_by_managers on public.games;
create policy games_read_by_managers on public.games
  for select to authenticated
  using (tournament_id in (select public.readable_tournament_ids()));

-- apps/web/src/lib/gameCardsRealtime.ts needs this one.
drop policy if exists game_cards_via_tournament on public.game_cards;
drop policy if exists game_cards_read_by_managers on public.game_cards;
create policy game_cards_read_by_managers on public.game_cards
  for select to authenticated
  using (tournament_id in (select public.readable_tournament_ids()));

drop policy if exists game_result_events_via_tournament on public.game_result_events;
drop policy if exists game_result_events_read_by_managers on public.game_result_events;
create policy game_result_events_read_by_managers on public.game_result_events
  for select to authenticated
  using (tournament_id in (select public.readable_tournament_ids()));

drop policy if exists certificate_issues_via_tournament on public.certificate_issues;
drop policy if exists certificate_issues_read_by_managers on public.certificate_issues;
create policy certificate_issues_read_by_managers on public.certificate_issues
  for select to authenticated
  using (tournament_id in (select public.readable_tournament_ids()));

-- A template with no tournament matches nothing, as in 029.
drop policy if exists certificate_templates_via_tournament on public.certificate_templates;
drop policy if exists certificate_templates_read_by_managers on public.certificate_templates;
create policy certificate_templates_read_by_managers on public.certificate_templates
  for select to authenticated
  using (tournament_id in (select public.readable_tournament_ids()));

-- A policy only narrows a grant. These come from Supabase's defaults and 028 left them, but Realtime
-- quietly sends nothing without them, so they are stated rather than assumed.
grant select on
  public.tournament_tables,
  public.floor_alerts,
  public.categories,
  public.participants,
  public.games,
  public.game_cards,
  public.game_result_events,
  public.certificate_issues,
  public.certificate_templates
to authenticated;

-- ---------------------------------------------------------------------------
-- 3. No write policies, and no write grants
-- ---------------------------------------------------------------------------

-- These did nothing once 028 revoked the grants, but they would come back to life with any grant.
drop policy if exists organizations_insert_own on public.organizations;
drop policy if exists organizations_update_member_or_admin on public.organizations;
drop policy if exists floor_alerts_insert_organizer on public.floor_alerts;
drop policy if exists floor_alerts_update_organizer on public.floor_alerts;
drop policy if exists player_profiles_insert_own on public.player_profiles;
drop policy if exists player_profiles_update_own on public.player_profiles;
drop policy if exists player_profiles_delete_own on public.player_profiles;

revoke insert, update, delete, truncate, references, trigger
  on all tables in schema public
  from anon, authenticated;

-- Revoking a table privilege also removes its column grants, so these are restated from 028.
grant insert (id, display_name, updated_at) on public.profiles to authenticated;
grant update (display_name, updated_at) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Reads that nobody should have
-- ---------------------------------------------------------------------------

-- Nothing signed out reads a table directly: public pages all go through the API.
revoke select on all tables in schema public from anon;
alter default privileges in schema public revoke select on tables from anon;

-- API-only tables. RLS with no policy already returned nothing; now they refuse outright.
revoke all on public.page_views from anon, authenticated;
revoke all on public.product_events from anon, authenticated;
revoke all on public.fide_players from anon, authenticated;
revoke all on public.fide_players_staging from anon, authenticated;
revoke all on public.fide_import_meta from anon, authenticated;

-- Entries hold children's details and paths to payment receipts, and every reader goes through the
-- API, which masks them. Migration 034 reaches the same place for its new columns.
drop policy if exists tournament_registrations_select_own_or_organizer on public.tournament_registrations;
revoke all on public.tournament_registrations from anon, authenticated;

-- Staff can now read tournaments directly, and a six-digit PIN's hash is easy to brute-force offline.
-- Table-level select would override a column revoke, so it goes, and every other column is granted.
-- A column added later starts unreadable by clients, which is the safe way round.
revoke select on public.tournaments from anon, authenticated;
do $$
declare
  readable text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
  into readable
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'tournaments'
    and column_name not in ('arbiter_pin_hash', 'public_token');
  execute format('grant select (%s) on public.tournaments to authenticated', readable);
end;
$$;

-- A trigger function: fires without this, and nobody needs to be able to call it.
revoke all on function public.handle_new_user() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Live updates
-- ---------------------------------------------------------------------------

-- 009 and 012 did this. Repeated so the two tables that gamesRealtime.ts and gameCardsRealtime.ts
-- subscribe to are known to be published, whatever happened to the publication since.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'games'
  ) then
    alter publication supabase_realtime add table public.games;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'game_cards'
  ) then
    alter publication supabase_realtime add table public.game_cards;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Indexes the policies lean on
-- ---------------------------------------------------------------------------

create index if not exists idx_floor_alerts_tournament on public.floor_alerts(tournament_id);

-- ---------------------------------------------------------------------------
-- 7. Storage
-- ---------------------------------------------------------------------------

-- The API alone reads and writes these two buckets, with the service key: certificates through
-- /certificates/:issueId/download and receipts through the organizer and player routes. Clients get
-- no storage policy. Nothing in this repo uses a public URL for either, so both stay private however
-- the bucket was first created. The certificates bucket was made by hand, not by a migration.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    execute $sql$
      update storage.buckets set public = false
      where id in ('certificates', 'registration-receipts') and public
    $sql$;
  end if;
exception
  when insufficient_privilege then
    raise warning 'Could not check the storage buckets. See the check in deploy/DOKPLOY.md.';
end;
$$;
