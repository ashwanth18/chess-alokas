-- The registration form builder: NRIC numbers and private file answers on an entry.

alter table public.tournament_registrations
  add column if not exists nric_number text,
  -- [{ id, field, storagePath, contentType, bytes }] in the registration-receipts bucket. Same file
  -- types and size limit as receipts, so the bucket doesn't change.
  add column if not exists private_files jsonb not null default '[]'::jsonb;

-- Nothing reads this table directly: the web and the apps go through the API, which masks the NRIC
-- and leaves storage paths out. Registration policies from 026 and 028 would otherwise let the person
-- who submitted, or a tournament's original owner after a change of role, read both columns.
revoke all on public.tournament_registrations from anon, authenticated;
