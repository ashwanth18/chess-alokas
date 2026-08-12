-- Configurable standings tiebreaks + shared places for true performance ties.

alter table tournaments
  add column if not exists tiebreak_order jsonb;

alter table tournaments
  add column if not exists shared_places boolean not null default true;

comment on column tournaments.tiebreak_order is
  'Ordered list of tiebreak keys after score; null = app default';
comment on column tournaments.shared_places is
  'When true, equal performance tiebreaks share a rank (1224 competition ranking)';
