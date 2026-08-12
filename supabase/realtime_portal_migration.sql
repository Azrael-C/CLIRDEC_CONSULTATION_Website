-- Publish consultation workflow changes so active student and faculty sessions
-- refresh immediately instead of waiting for the polling fallback.
begin;

alter table public.availability replica identity full;
alter table public.appointments replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname='supabase_realtime'
        and schemaname='public'
        and tablename='availability'
    ) then
      execute 'alter publication supabase_realtime add table public.availability';
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname='supabase_realtime'
        and schemaname='public'
        and tablename='appointments'
    ) then
      execute 'alter publication supabase_realtime add table public.appointments';
    end if;
  end if;
end $$;

commit;
