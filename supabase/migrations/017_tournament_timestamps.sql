-- Creation / completion timestamps for admin insights
-- Existing rows: created_at ≈ updated_at (best available history)

alter table tournaments
  add column if not exists created_at timestamptz;

update tournaments
set created_at = coalesce(updated_at, now())
where created_at is null;

alter table tournaments
  alter column created_at set default now();

alter table tournaments
  alter column created_at set not null;

alter table tournaments
  add column if not exists completed_at timestamptz;

update tournaments
set completed_at = updated_at
where status = 'completed'
  and completed_at is null;
