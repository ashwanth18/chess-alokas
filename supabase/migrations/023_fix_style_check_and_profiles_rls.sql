-- Allow 'dutch' in tournaments_style_check and prevent non-admin users from
-- self-promoting is_platform_admin on public.profiles.

alter table public.tournaments
  drop constraint if exists tournaments_style_check;

alter table public.tournaments
  add constraint tournaments_style_check
  check (style in ('swiss', 'dutch', 'round_robin'));

create or replace function public.prevent_profile_admin_self_promotion()
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
      new.is_platform_admin := false;
    elsif tg_op = 'UPDATE' then
      new.is_platform_admin := old.is_platform_admin;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_profile_admin_self_promotion on public.profiles;
create trigger trg_prevent_profile_admin_self_promotion
  before insert or update on public.profiles
  for each row
  execute function public.prevent_profile_admin_self_promotion();
