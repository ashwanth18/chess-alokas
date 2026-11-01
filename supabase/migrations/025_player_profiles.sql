-- Global B2C player profiles & family/student sub-profiles

create table if not exists public.player_profiles (
  id uuid primary key default gen_random_uuid(),
  account_user_id uuid not null references auth.users(id) on delete cascade,
  is_primary boolean not null default false,
  relationship text not null default 'self'
    check (relationship in ('self', 'child', 'student', 'family')),
  username text unique,
  full_name text not null,
  date_of_birth date,
  year_of_birth integer,
  gender text,
  national_id text,
  fide_id integer,
  fide_standard integer,
  fide_rapid integer,
  fide_blitz integer,
  alokas_rating integer not null default 1000,
  school text,
  club text,
  city text,
  state text,
  country text default 'Malaysia',
  email text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_player_profiles_account_user on public.player_profiles(account_user_id);
create index if not exists idx_player_profiles_fide_id on public.player_profiles(fide_id);
create index if not exists idx_player_profiles_email_lower on public.player_profiles(lower(email));

alter table public.participants
  add column if not exists player_profile_id uuid references public.player_profiles(id) on delete set null;

create index if not exists idx_participants_player_profile on public.participants(player_profile_id);

alter table public.player_profiles enable row level security;

drop policy if exists player_profiles_select_own on public.player_profiles;
create policy player_profiles_select_own on public.player_profiles
  for select to authenticated
  using (account_user_id = (select auth.uid()));

drop policy if exists player_profiles_insert_own on public.player_profiles;
create policy player_profiles_insert_own on public.player_profiles
  for insert to authenticated
  with check (account_user_id = (select auth.uid()));

drop policy if exists player_profiles_update_own on public.player_profiles;
create policy player_profiles_update_own on public.player_profiles
  for update to authenticated
  using (account_user_id = (select auth.uid()))
  with check (account_user_id = (select auth.uid()));

drop policy if exists player_profiles_delete_own on public.player_profiles;
create policy player_profiles_delete_own on public.player_profiles
  for delete to authenticated
  using (account_user_id = (select auth.uid()));
