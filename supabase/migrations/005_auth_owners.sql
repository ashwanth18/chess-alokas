-- Per-manager ownership + profiles for Chess Alokas Auth

alter table tournaments
  add column if not exists owner_id uuid references auth.users(id) on delete set null;

create index if not exists idx_tournaments_owner on tournaments(owner_id);

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table tournaments enable row level security;
alter table categories enable row level security;
alter table participants enable row level security;
alter table games enable row level security;
alter table certificate_templates enable row level security;
alter table certificate_issues enable row level security;
alter table profiles enable row level security;

drop policy if exists profiles_select_own on profiles;
create policy profiles_select_own on profiles
  for select to authenticated
  using ((select auth.uid()) = id);

drop policy if exists profiles_insert_own on profiles;
create policy profiles_insert_own on profiles
  for insert to authenticated
  with check ((select auth.uid()) = id);

drop policy if exists profiles_update_own on profiles;
create policy profiles_update_own on profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists tournaments_owner_all on tournaments;
create policy tournaments_owner_all on tournaments
  for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

drop policy if exists categories_via_tournament on categories;
create policy categories_via_tournament on categories
  for all to authenticated
  using (
    exists (
      select 1 from tournaments t
      where t.id = categories.tournament_id and t.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from tournaments t
      where t.id = categories.tournament_id and t.owner_id = (select auth.uid())
    )
  );

drop policy if exists participants_via_tournament on participants;
create policy participants_via_tournament on participants
  for all to authenticated
  using (
    exists (
      select 1 from tournaments t
      where t.id = participants.tournament_id and t.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from tournaments t
      where t.id = participants.tournament_id and t.owner_id = (select auth.uid())
    )
  );

drop policy if exists games_via_tournament on games;
create policy games_via_tournament on games
  for all to authenticated
  using (
    exists (
      select 1 from tournaments t
      where t.id = games.tournament_id and t.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from tournaments t
      where t.id = games.tournament_id and t.owner_id = (select auth.uid())
    )
  );

drop policy if exists certificate_templates_via_tournament on certificate_templates;
create policy certificate_templates_via_tournament on certificate_templates
  for all to authenticated
  using (
    tournament_id is null
    or exists (
      select 1 from tournaments t
      where t.id = certificate_templates.tournament_id and t.owner_id = (select auth.uid())
    )
  )
  with check (
    tournament_id is null
    or exists (
      select 1 from tournaments t
      where t.id = certificate_templates.tournament_id and t.owner_id = (select auth.uid())
    )
  );

drop policy if exists certificate_issues_via_tournament on certificate_issues;
create policy certificate_issues_via_tournament on certificate_issues
  for all to authenticated
  using (
    exists (
      select 1 from tournaments t
      where t.id = certificate_issues.tournament_id and t.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from tournaments t
      where t.id = certificate_issues.tournament_id and t.owner_id = (select auth.uid())
    )
  );

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
