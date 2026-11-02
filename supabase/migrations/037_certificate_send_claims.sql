-- Bulk certificate email claims each certificate before sending it, so two tabs or a double click
-- can't send the same one twice. The claim sets status 'pending' (already allowed by the check
-- constraint) and stamps this column. A claim older than ten minutes is treated as abandoned, for a
-- server that stopped mid-send, and can be taken again. Any final status clears it.

alter table public.certificate_issues
  add column if not exists send_claimed_at timestamptz;
