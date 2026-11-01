-- Phase 2: Tournament Discovery (GPS nearby events), Shareable Registration Forms,
-- 1-Click Family/Player Registration, Payment Receipt Upload, and Organizer Approval Queue

alter table public.tournaments
  add column if not exists public_slug text unique,
  add column if not exists is_published_global boolean not null default false,
  add column if not exists registration_open boolean not null default false,
  add column if not exists registration_deadline timestamptz,
  add column if not exists max_participants integer,
  add column if not exists venue_name text,
  add column if not exists venue_address text,
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists country text default 'Malaysia',
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists poster_storage_path text,
  add column if not exists description_md text,
  add column if not exists rules_md text,
  add column if not exists prize_summary_json jsonb,
  add column if not exists time_control text,
  add column if not exists entry_fee_cents integer not null default 0,
  add column if not exists currency text not null default 'MYR',
  add column if not exists payment_instructions text,
  add column if not exists payment_qr_url text,
  add column if not exists registration_form_schema jsonb not null default '{"collectSchool":true,"collectFideId":true,"collectPhone":true,"customQuestions":[]}'::jsonb;

create index if not exists idx_tournaments_public_slug
  on public.tournaments(lower(public_slug));

create index if not exists idx_tournaments_published_global
  on public.tournaments(is_published_global, registration_open)
  where deleted_at is null;

create table if not exists public.tournament_registrations (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  player_profile_id uuid references public.player_profiles(id) on delete set null,
  submitted_by_user_id uuid references auth.users(id) on delete set null,
  selected_category_id uuid references public.categories(id) on delete set null,
  player_snapshot jsonb not null default '{}'::jsonb,
  custom_answers jsonb not null default '{}'::jsonb,
  payment_status text not null default 'not_required'
    check (payment_status in ('not_required', 'pending_receipt', 'submitted', 'verified', 'refunded')),
  receipt_data_url text,
  amount_cents integer not null default 0,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'waitlisted', 'rejected', 'cancelled')),
  reviewer_note text,
  reviewed_at timestamptz,
  participant_id uuid references public.participants(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tournament_registrations_tournament_status
  on public.tournament_registrations(tournament_id, status);

create index if not exists idx_tournament_registrations_submitted_by
  on public.tournament_registrations(submitted_by_user_id);

create index if not exists idx_tournament_registrations_player_profile
  on public.tournament_registrations(player_profile_id);

create unique index if not exists idx_unique_active_profile_registration
  on public.tournament_registrations(tournament_id, player_profile_id)
  where player_profile_id is not null and status not in ('cancelled', 'rejected');

alter table public.tournament_registrations enable row level security;

drop policy if exists tournament_registrations_select_own_or_organizer on public.tournament_registrations;
create policy tournament_registrations_select_own_or_organizer on public.tournament_registrations
  for select to authenticated
  using (
    submitted_by_user_id = (select auth.uid())
    or exists (
      select 1 from public.player_profiles pp
      where pp.id = tournament_registrations.player_profile_id
        and pp.account_user_id = (select auth.uid())
    )
    or exists (
      select 1 from public.tournaments t
      where t.id = tournament_registrations.tournament_id
        and (
          t.owner_id = (select auth.uid())
          or exists (
            select 1 from public.organization_members m
            where m.organization_id = t.organization_id
              and m.user_id = (select auth.uid())
              and m.role in ('owner', 'admin', 'director')
          )
          or exists (
            select 1 from public.organizations o
            where o.id = t.organization_id
              and o.created_by = (select auth.uid())
          )
        )
    )
  );

drop policy if exists tournament_registrations_insert_authenticated on public.tournament_registrations;
create policy tournament_registrations_insert_authenticated on public.tournament_registrations
  for insert to authenticated
  with check (
    submitted_by_user_id is null
    or submitted_by_user_id = (select auth.uid())
  );

drop policy if exists tournament_registrations_update_own_or_organizer on public.tournament_registrations;
create policy tournament_registrations_update_own_or_organizer on public.tournament_registrations
  for update to authenticated
  using (
    submitted_by_user_id = (select auth.uid())
    or exists (
      select 1 from public.tournaments t
      where t.id = tournament_registrations.tournament_id
        and (
          t.owner_id = (select auth.uid())
          or exists (
            select 1 from public.organization_members m
            where m.organization_id = t.organization_id
              and m.user_id = (select auth.uid())
              and m.role in ('owner', 'admin', 'director')
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
    submitted_by_user_id = (select auth.uid())
    or exists (
      select 1 from public.tournaments t
      where t.id = tournament_registrations.tournament_id
        and (
          t.owner_id = (select auth.uid())
          or exists (
            select 1 from public.organization_members m
            where m.organization_id = t.organization_id
              and m.user_id = (select auth.uid())
              and m.role in ('owner', 'admin', 'director')
          )
          or exists (
            select 1 from public.organizations o
            where o.id = t.organization_id
              and o.created_by = (select auth.uid())
          )
        )
    )
  );
