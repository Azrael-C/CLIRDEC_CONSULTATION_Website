-- PB-02: give administrators a controlled catalog of academic units.
-- The catalog is intentionally additive: existing pilot records continue to
-- work while unit foreign keys can be introduced in a later, reviewed scope
-- migration.
begin;

create table if not exists public.academic_units (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  description text not null default '',
  contact_email text,
  office_location text,
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint academic_units_code_format check (code = upper(trim(code)) and code ~ '^[A-Z0-9][A-Z0-9_-]{1,31}$'),
  constraint academic_units_name_not_blank check (length(trim(name)) between 2 and 160),
  constraint academic_units_contact_email check (
    contact_email is null or contact_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  )
);

create unique index if not exists academic_units_code_unique
  on public.academic_units (code);
create unique index if not exists academic_units_name_unique
  on public.academic_units (lower(name));
create index if not exists academic_units_active_idx
  on public.academic_units (active, name);

create or replace function public.set_academic_unit_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists academic_units_updated_at on public.academic_units;
create trigger academic_units_updated_at
before update on public.academic_units
for each row execute function public.set_academic_unit_updated_at();

alter table public.academic_units enable row level security;
drop policy if exists "administrators read academic units" on public.academic_units;
drop policy if exists "administrators create academic units" on public.academic_units;
drop policy if exists "administrators update academic units" on public.academic_units;
create policy "administrators read academic units"
  on public.academic_units for select to authenticated
  using (public.current_role() = 'admin');
create policy "administrators create academic units"
  on public.academic_units for insert to authenticated
  with check (public.current_role() = 'admin' and (created_by is null or created_by = auth.uid()));
create policy "administrators update academic units"
  on public.academic_units for update to authenticated
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

revoke all on public.academic_units from anon, authenticated;
grant select on public.academic_units to authenticated;
grant insert (code, name, description, contact_email, office_location, created_by) on public.academic_units to authenticated;
grant update (code, name, description, contact_email, office_location, active) on public.academic_units to authenticated;

insert into public.academic_units (code, name, description, office_location)
values (
  'CLIRDEC',
  'Central Luzon Interdisciplinary Research and Extension Center',
  'Pilot academic unit for FacultyConnect consultation services.',
  'CLSU · CLIRDEC office'
)
on conflict (code) do nothing;

create or replace function public.audit_academic_unit_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_logs(actor_id, action, resource_type, resource_id, old_data, new_data)
  values (
    auth.uid(),
    lower(tg_op),
    'academic_unit',
    (case when tg_op = 'DELETE' then old.id else new.id end)::text,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists audit_academic_unit_changes on public.academic_units;
create trigger audit_academic_unit_changes
after insert or update on public.academic_units
for each row execute function public.audit_academic_unit_change();
revoke all on function public.audit_academic_unit_change() from public, anon, authenticated;

commit;
