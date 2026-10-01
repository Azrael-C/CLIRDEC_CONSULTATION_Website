-- PB-02: assign operational records to an academic unit and enforce the
-- boundary for non-administrative users. Existing pilot data is retained in
-- the seeded CLIRDEC unit; new records inherit the creator's unit.
begin;

alter table public.profiles
  add column if not exists academic_unit_id uuid references public.academic_units(id);
alter table public.faculty_profiles
  add column if not exists academic_unit_id uuid references public.academic_units(id);
alter table public.availability
  add column if not exists academic_unit_id uuid references public.academic_units(id);
alter table public.appointments
  add column if not exists academic_unit_id uuid references public.academic_units(id);
alter table public.faq_entries
  add column if not exists academic_unit_id uuid references public.academic_units(id);
alter table public.consultation_reviews
  add column if not exists academic_unit_id uuid references public.academic_units(id);

create index if not exists profiles_academic_unit_idx
  on public.profiles (academic_unit_id, role);
create index if not exists faculty_profiles_academic_unit_idx
  on public.faculty_profiles (academic_unit_id, active);
create index if not exists availability_academic_unit_idx
  on public.availability (academic_unit_id, starts_at);
create index if not exists appointments_academic_unit_idx
  on public.appointments (academic_unit_id, created_at desc);
create index if not exists faq_entries_academic_unit_idx
  on public.faq_entries (academic_unit_id, status, updated_at desc);
create index if not exists consultation_reviews_academic_unit_idx
  on public.consultation_reviews (academic_unit_id, created_at desc);

do $$
declare default_unit uuid;
begin
  select id into default_unit from public.academic_units where code='CLIRDEC' limit 1;
  if default_unit is null then
    raise exception 'The seeded CLIRDEC academic unit is required before unit scoping can be enabled';
  end if;
  update public.profiles set academic_unit_id=default_unit where academic_unit_id is null;
  update public.faculty_profiles fp
    set academic_unit_id=p.academic_unit_id
    from public.profiles p
    where p.id=fp.user_id and fp.academic_unit_id is null;
  update public.availability a
    set academic_unit_id=p.academic_unit_id
    from public.profiles p
    where p.id=a.faculty_id and a.academic_unit_id is null;
  update public.appointments ap
    set academic_unit_id=a.academic_unit_id
    from public.availability a
    where a.id=ap.availability_id and ap.academic_unit_id is null;
  update public.faq_entries f
    set academic_unit_id=coalesce(p.academic_unit_id, default_unit)
    from public.profiles p
    where p.id=f.created_by and f.academic_unit_id is null;
  update public.faq_entries set academic_unit_id=default_unit where academic_unit_id is null;
  update public.consultation_reviews r
    set academic_unit_id=coalesce(ap.academic_unit_id, default_unit)
    from public.appointments ap
    where ap.id=r.appointment_id and r.academic_unit_id is null;
  update public.consultation_reviews set academic_unit_id=default_unit where academic_unit_id is null;
end;
$$;

create or replace function public.current_academic_unit_id()
returns uuid
language sql stable security definer
set search_path=public
as $$
  select academic_unit_id from public.profiles where id=auth.uid()
$$;

create or replace function public.can_access_academic_unit(target_unit uuid)
returns boolean
language sql stable security definer
set search_path=public
as $$
  select public.current_role()='admin'
    or (target_unit is not null and target_unit=public.current_academic_unit_id())
$$;

revoke all on function public.current_academic_unit_id() from public, anon;
grant execute on function public.current_academic_unit_id() to authenticated;
revoke all on function public.can_access_academic_unit(uuid) from public, anon;
grant execute on function public.can_access_academic_unit(uuid) to authenticated;

create or replace function public.default_academic_unit_for_profile()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.academic_unit_id is null then
    select id into new.academic_unit_id
    from public.academic_units
    where code='CLIRDEC' and active
    limit 1;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_default_academic_unit on public.profiles;
create trigger profiles_default_academic_unit
before insert on public.profiles
for each row execute function public.default_academic_unit_for_profile();

create or replace function public.sync_faculty_academic_unit()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  select academic_unit_id into new.academic_unit_id
  from public.profiles where id=new.user_id;
  return new;
end;
$$;

drop trigger if exists faculty_profiles_sync_academic_unit on public.faculty_profiles;
create trigger faculty_profiles_sync_academic_unit
before insert or update on public.faculty_profiles
for each row execute function public.sync_faculty_academic_unit();

create or replace function public.sync_availability_academic_unit()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  select academic_unit_id into new.academic_unit_id
  from public.profiles where id=new.faculty_id;
  return new;
end;
$$;

drop trigger if exists availability_sync_academic_unit on public.availability;
create trigger availability_sync_academic_unit
before insert or update on public.availability
for each row execute function public.sync_availability_academic_unit();

create or replace function public.sync_appointment_academic_unit()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  select academic_unit_id into new.academic_unit_id
  from public.availability where id=new.availability_id;
  return new;
end;
$$;

drop trigger if exists appointments_sync_academic_unit on public.appointments;
create trigger appointments_sync_academic_unit
before insert or update on public.appointments
for each row execute function public.sync_appointment_academic_unit();

create or replace function public.sync_review_academic_unit()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  select academic_unit_id into new.academic_unit_id
  from public.appointments where id=new.appointment_id;
  return new;
end;
$$;

drop trigger if exists consultation_reviews_sync_academic_unit on public.consultation_reviews;
create trigger consultation_reviews_sync_academic_unit
before insert or update on public.consultation_reviews
for each row execute function public.sync_review_academic_unit();

create or replace function public.admin_assign_user_unit(target_user uuid, target_unit uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare target_role public.user_role;
begin
  if public.current_role() is distinct from 'admin'::public.user_role then
    raise exception 'Administrator access required';
  end if;
  if not exists (select 1 from public.academic_units where id=target_unit and active) then
    raise exception 'Choose an active academic unit';
  end if;
  select role into target_role from public.profiles where id=target_user for update;
  if not found then raise exception 'User profile not found'; end if;
  update public.profiles set academic_unit_id=target_unit where id=target_user;
  if target_role='faculty' then
    update public.faculty_profiles set academic_unit_id=target_unit where user_id=target_user;
    update public.availability set academic_unit_id=target_unit where faculty_id=target_user;
  end if;
  insert into public.audit_logs(actor_id,action,resource_type,resource_id,old_data,new_data)
  values(auth.uid(),'academic_unit_changed','profile',target_user::text,null,jsonb_build_object('academic_unit_id',target_unit));
end;
$$;
revoke all on function public.admin_assign_user_unit(uuid,uuid) from public, anon;
grant execute on function public.admin_assign_user_unit(uuid,uuid) to authenticated;

create or replace function public.can_read_profile(target_user uuid)
returns boolean
language sql stable security definer
set search_path=public
as $$
  select target_user=auth.uid()
    or public.current_role()='admin'
    or (
      public.current_role()='faculty'
      and exists(
        select 1
        from public.profiles target
        join public.appointments ap on ap.student_id=target.id
        join public.availability av on av.id=ap.availability_id
        where target.id=target_user
          and av.faculty_id=auth.uid()
          and target.academic_unit_id=public.current_academic_unit_id()
      )
    )
$$;

create or replace function public.faculty_directory(target_ids uuid[] default null)
returns table(
  id uuid,full_name text,department text,expertise text[],subjects text[],
  consultation_topics text[],research_interests text[],bio text,
  office_location text,profile_completed boolean
)
language sql stable security definer
set search_path=public
as $$
  select p.id,p.full_name,p.department,fp.expertise,fp.subjects,
    fp.consultation_topics,fp.research_interests,coalesce(fp.bio,''),
    coalesce(fp.office_location,''),fp.profile_completed_at is not null
  from public.profiles p
  join public.faculty_profiles fp on fp.user_id=p.id
  where p.role='faculty'
    and fp.active
    and (public.current_role()='admin' or p.academic_unit_id=public.current_academic_unit_id())
    and (target_ids is null or p.id=any(target_ids))
  order by p.full_name
$$;

drop policy if exists "public faculty information" on public.faculty_profiles;
create policy "unit faculty information" on public.faculty_profiles for select to authenticated
using (public.can_access_academic_unit(academic_unit_id));

drop policy if exists "read open or related availability" on public.availability;
create policy "unit open or related availability" on public.availability for select to authenticated
using (
  (is_open and public.can_access_academic_unit(academic_unit_id))
  or faculty_id=auth.uid()
  or public.current_role()='admin'
  or public.can_read_booked_availability(id)
);

drop policy if exists "faculty manages own availability" on public.availability;
create policy "faculty manages own unit availability" on public.availability for all to authenticated
using ((faculty_id=auth.uid() and public.current_role()='faculty') or public.current_role()='admin')
with check (
  ((faculty_id=auth.uid() and public.current_role()='faculty') or public.current_role()='admin')
  and public.can_access_academic_unit(academic_unit_id)
);

drop policy if exists "students create own appointments" on public.appointments;
create policy "students create own unit appointments" on public.appointments for insert to authenticated
with check (student_id=auth.uid() and public.current_role()='student' and public.can_access_academic_unit(academic_unit_id));

drop policy if exists "students cancel own pending appointments" on public.appointments;
create policy "students cancel own pending unit appointments" on public.appointments for update to authenticated
using (student_id=auth.uid() and status='pending' and public.can_access_academic_unit(academic_unit_id))
with check (student_id=auth.uid() and status='cancelled' and public.can_access_academic_unit(academic_unit_id));

drop policy if exists "participants read appointments" on public.appointments;
create policy "unit participants read appointments" on public.appointments for select to authenticated
using (
  public.can_access_academic_unit(academic_unit_id)
  and (student_id=auth.uid() or exists(select 1 from public.availability a where a.id=availability_id and a.faculty_id=auth.uid()) or public.current_role()='admin')
);

drop policy if exists "faculty and admin decide appointments" on public.appointments;
create policy "unit faculty and admin decide appointments" on public.appointments for update to authenticated
using (
  public.can_access_academic_unit(academic_unit_id)
  and (exists(select 1 from public.availability a where a.id=availability_id and a.faculty_id=auth.uid()) or public.current_role()='admin')
)
with check (public.can_access_academic_unit(academic_unit_id));

drop policy if exists "users read approved FAQ entries" on public.faq_entries;
create policy "users read approved unit FAQ entries" on public.faq_entries for select to authenticated
using ((status='approved' and public.can_access_academic_unit(academic_unit_id)) or public.current_role()='admin');

drop policy if exists "admins create FAQ entries" on public.faq_entries;
create policy "admins create unit FAQ entries" on public.faq_entries for insert to authenticated
with check (public.current_role()='admin' and created_by=auth.uid() and exists(select 1 from public.academic_units where id=academic_unit_id and active));

drop policy if exists "admins update FAQ entries" on public.faq_entries;
create policy "admins update unit FAQ entries" on public.faq_entries for update to authenticated
using (public.current_role()='admin')
with check (public.current_role()='admin' and exists(select 1 from public.academic_units where id=academic_unit_id and active));

drop policy if exists "students read own consultation reviews" on public.consultation_reviews;
create policy "unit students and admins read consultation reviews" on public.consultation_reviews for select to authenticated
using ((student_id=auth.uid() and public.can_access_academic_unit(academic_unit_id)) or public.current_role()='admin');

-- The admin workspace reads this key to render assignment controls. Keep the
-- existing column allow-list and add only the unit relationship.
grant select (id,full_name,email,role,department,email_notifications,student_number,college,program,year_level,last_seen_at,created_at,account_status,status_reason,status_changed_at,academic_unit_id)
  on public.profiles to authenticated;

commit;
