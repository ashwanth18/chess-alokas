-- Ensure clients can read their own is_platform_admin flag (Admin nav).
grant select (id, display_name, is_platform_admin, created_at, updated_at)
  on public.profiles to authenticated, anon;
