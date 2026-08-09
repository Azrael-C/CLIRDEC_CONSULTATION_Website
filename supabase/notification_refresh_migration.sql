-- Adds a stable event timestamp used to order appointment notifications.
alter table public.appointments
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.set_appointment_updated_at()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  new.updated_at=now();
  return new;
end $$;

drop trigger if exists set_appointment_updated_at_before_update on public.appointments;
create trigger set_appointment_updated_at_before_update
before update on public.appointments
for each row execute function public.set_appointment_updated_at();
