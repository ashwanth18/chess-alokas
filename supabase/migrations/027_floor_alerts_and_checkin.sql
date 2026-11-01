-- Phase 3: Floor Arbiter Zone Grid, Chief Arbiter Alerts, and Morning Roll-Call Check-In

alter table public.participants
  add column if not exists checked_in boolean not null default false;

create table if not exists public.floor_alerts (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  round integer not null,
  table_number integer not null,
  game_id uuid references public.games(id) on delete set null,
  arbiter_name text,
  reason text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists idx_floor_alerts_tournament_active
  on public.floor_alerts(tournament_id, resolved_at, created_at desc);

alter table public.floor_alerts enable row level security;

drop policy if exists floor_alerts_select_organizer on public.floor_alerts;
create policy floor_alerts_select_organizer on public.floor_alerts
  for select to authenticated
  using (
    exists (
      select 1 from public.tournaments t
      where t.id = floor_alerts.tournament_id
        and (
          t.owner_id = (select auth.uid())
          or exists (
            select 1 from public.organization_members m
            where m.organization_id = t.organization_id
              and m.user_id = (select auth.uid())
              and m.role in ('owner', 'admin', 'director', 'arbiter')
          )
          or exists (
            select 1 from public.organizations o
            where o.id = t.organization_id
              and o.created_by = (select auth.uid())
          )
        )
    )
  );

drop policy if exists floor_alerts_insert_organizer on public.floor_alerts;
create policy floor_alerts_insert_organizer on public.floor_alerts
  for insert to authenticated
  with check (
    exists (
      select 1 from public.tournaments t
      where t.id = floor_alerts.tournament_id
        and (
          t.owner_id = (select auth.uid())
          or exists (
            select 1 from public.organization_members m
            where m.organization_id = t.organization_id
              and m.user_id = (select auth.uid())
              and m.role in ('owner', 'admin', 'director', 'arbiter')
          )
          or exists (
            select 1 from public.organizations o
            where o.id = t.organization_id
              and o.created_by = (select auth.uid())
          )
        )
    )
  );

drop policy if exists floor_alerts_update_organizer on public.floor_alerts;
create policy floor_alerts_update_organizer on public.floor_alerts
  for update to authenticated
  using (
    exists (
      select 1 from public.tournaments t
      where t.id = floor_alerts.tournament_id
        and (
          t.owner_id = (select auth.uid())
          or exists (
            select 1 from public.organization_members m
            where m.organization_id = t.organization_id
              and m.user_id = (select auth.uid())
              and m.role in ('owner', 'admin', 'director', 'arbiter')
          )
          or exists (
            select 1 from public.organizations o
            where o.id = t.organization_id
              and o.created_by = (select auth.uid())
          )
        )
    )
  )
  with check (
    exists (
      select 1 from public.tournaments t
      where t.id = floor_alerts.tournament_id
        and (
          t.owner_id = (select auth.uid())
          or exists (
            select 1 from public.organization_members m
            where m.organization_id = t.organization_id
              and m.user_id = (select auth.uid())
              and m.role in ('owner', 'admin', 'director', 'arbiter')
          )
          or exists (
            select 1 from public.organizations o
            where o.id = t.organization_id
              and o.created_by = (select auth.uid())
          )
        )
    )
  );
