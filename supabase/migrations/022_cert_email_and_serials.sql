-- Certificate mass-email copy + per-tournament serials

alter table tournaments
  add column if not exists cert_email_subject text,
  add column if not exists cert_email_body text,
  add column if not exists cert_serial_prefix text not null default 'ARCC',
  add column if not exists cert_serial_pad integer not null default 3,
  add column if not exists cert_serial_next integer not null default 1;

alter table tournaments
  drop constraint if exists tournaments_cert_serial_pad_check;
alter table tournaments
  add constraint tournaments_cert_serial_pad_check
  check (cert_serial_pad >= 1 and cert_serial_pad <= 8);

alter table tournaments
  drop constraint if exists tournaments_cert_serial_next_check;
alter table tournaments
  add constraint tournaments_cert_serial_next_check
  check (cert_serial_next >= 1);

alter table certificate_issues
  add column if not exists serial text;

create unique index if not exists idx_certificate_issues_tournament_serial
  on certificate_issues (tournament_id, serial)
  where serial is not null;
