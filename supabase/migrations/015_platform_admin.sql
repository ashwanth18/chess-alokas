-- Platform admin flag for internal ops dashboard

alter table profiles
  add column if not exists is_platform_admin boolean not null default false;

-- Seed founder as platform admin
update profiles p
set is_platform_admin = true,
    updated_at = now()
from auth.users u
where p.id = u.id
  and lower(u.email) = 'ashwanth18@gmail.com';

update auth.users
set raw_app_meta_data =
      coalesce(raw_app_meta_data, '{}'::jsonb) || '{"platform_admin": true}'::jsonb
where lower(email) = 'ashwanth18@gmail.com';
