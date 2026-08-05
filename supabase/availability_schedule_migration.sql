-- Run once in the existing Supabase project before deploying the calendar UI.
create extension if not exists btree_gist;

-- The pilot data contains an open Saturday demonstration slot. Open weekend
-- entries are no longer valid and are removed; requested history is preserved.
delete from public.availability
where is_open=true
  and extract(isodow from starts_at at time zone 'Asia/Manila') in (6,7);

alter table public.availability
  add constraint no_overlapping_faculty_slots exclude using gist (
    faculty_id with =,
    tstzrange(starts_at,ends_at,'[)') with &&
  );

create or replace function public.validate_availability_schedule()
returns trigger
language plpgsql
set search_path=public
as $$
declare
  local_start timestamp := new.starts_at at time zone 'Asia/Manila';
  local_end timestamp := new.ends_at at time zone 'Asia/Manila';
begin
  if extract(isodow from local_start) not between 1 and 5 then
    raise exception 'Consultation availability may only be published from Monday to Friday';
  end if;
  if new.starts_at < now() + interval '24 hours' then
    raise exception 'Publish availability at least 24 hours in advance';
  end if;
  if local_start::date <> local_end::date
     or local_start::time < time '08:00'
     or local_end::time > time '17:00' then
    raise exception 'Availability must stay within 8:00 AMâ€“5:00 PM Philippine time';
  end if;
  return new;
end $$;

create trigger validate_availability_schedule_before_write
before insert or update of starts_at,ends_at on public.availability
for each row execute function public.validate_availability_schedule();