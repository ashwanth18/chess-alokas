-- Broadcast game_cards changes so the director desk updates yellow/red counts live.

do $$
begin
  if not exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    create publication supabase_realtime;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'game_cards'
  ) then
    alter publication supabase_realtime add table game_cards;
  end if;
end $$;
