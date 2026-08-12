-- Player profile fields for roster + public live
alter table participants
  add column if not exists school text,
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists country text,
  add column if not exists year_of_birth integer;
