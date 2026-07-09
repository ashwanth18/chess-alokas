-- Allow optional mixed-category pairing (default: separate pools)

alter table tournaments
  add column if not exists mix_categories boolean not null default false;
