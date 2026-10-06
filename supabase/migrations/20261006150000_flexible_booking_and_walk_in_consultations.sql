-- Allow any future published consultation time and preserve a separate,
-- audited history for consultations held in person without a web booking.
begin;

create table if not exists public.walk_in_consultations (
  id uuid primary key default gen_random_uuid(),
  academic_unit_id uuid not null references public.academic_units(id) on delete restrict,
  student_id uuid not null references public.profiles(id) on delete restrict,
  faculty_id uuid not null references public.profiles(id) on delete restrict,
  topic text not null check (char_length(trim(topic)) between 5 and 240),
  notes text check (notes is null or char_length(notes) <= 2000),
  occurred_at timestamptz not null,
  location text not null default 'In person' check (char_length(location) between 1 and 160),
  recorded_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint walk_in_consultations_distinct_participants check (student_id <> faculty_id)
);

create index if not exists walk_in_consultations_unit_date_idx
  on public.walk_in_consultations(academic_unit_id, occurred_at desc);
create index if not exists walk_in_consultations_student_date_idx
  on public.walk_in_consultations(student_id, occurred_at desc);
create index if not exists walk_in_consultations_faculty_date_idx
  on public.walk_in_consultations(faculty_id, occurred_at desc);

do $$
begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname='supabase_realtime' and schemaname='public'
         and tablename='walk_in_consultations'
     ) then
    execute 'alter publication supabase_realtime add table public.walk_in_consultations';
  end if;
end;
$$;

alter table public.walk_in_consultations enable row level security;
revoke all on table public.walk_in_consultations from anon, authenticated;
grant select on table public.walk_in_consultations to authenticated;
create policy "participants read in-person consultation logs"
  on public.walk_in_consultations for select to authenticated
  using (
    public.can_access_academic_unit(academic_unit_id)
    and (student_id=auth.uid() or faculty_id=auth.uid() or public.current_role()='admin')
  );

-- This narrowly scoped search returns only the name and id of active students
-- in the caller's academic unit; faculty cannot browse other units or emails.
create or replace function public.search_walk_in_students(search_text text)
returns table(id uuid, full_name text)
language plpgsql stable security definer set search_path=public
as $$
declare
  actor_unit uuid;
  safe_query text;
begin
  if auth.uid() is null or public.current_role() is distinct from 'faculty'::public.user_role then
    raise exception 'Faculty access required';
  end if;
  if char_length(trim(coalesce(search_text,''))) < 2 or char_length(trim(search_text)) > 80 then
    raise exception 'Enter 2 to 80 characters to search for a student';
  end if;
  select p.academic_unit_id into actor_unit
  from public.profiles p
  join public.faculty_profiles fp on fp.user_id=p.id and fp.active
  where p.id=auth.uid() and p.role='faculty' and p.account_status='active';
  if actor_unit is null then raise exception 'Active faculty access required'; end if;
  safe_query := replace(replace(trim(search_text), E'\\', E'\\\\'), '%', E'\\%');
  safe_query := replace(safe_query, '_', E'\\_');
  return query
    select p.id,p.full_name
    from public.profiles p
    where p.role='student'
      and p.account_status='active'
      and p.academic_unit_id=actor_unit
      and p.full_name ilike '%' || safe_query || '%' escape E'\\'
    order by p.full_name
    limit 25;
end;
$$;
revoke all on function public.search_walk_in_students(text) from public, anon;
grant execute on function public.search_walk_in_students(text) to authenticated;

create or replace function public.record_walk_in_consultation(
  target_student uuid,
  consultation_topic text,
  consultation_notes text default null,
  consultation_occurred_at timestamptz default null,
  consultation_location text default null
)
returns uuid
language plpgsql security definer set search_path=public
as $$
declare
  actor_unit uuid;
  created_id uuid;
  cleaned_topic text := trim(coalesce(consultation_topic,''));
  cleaned_notes text := nullif(trim(coalesce(consultation_notes,'')), '');
  clean_location text := coalesce(nullif(trim(coalesce(consultation_location,'')),''),'In person');
begin
  if auth.uid() is null or public.current_role() is distinct from 'faculty'::public.user_role then
    raise exception 'Faculty access required';
  end if;
  select p.academic_unit_id into actor_unit
  from public.profiles p
  join public.faculty_profiles fp on fp.user_id=p.id and fp.active
  where p.id=auth.uid() and p.role='faculty' and p.account_status='active';
  if actor_unit is null then raise exception 'Active faculty access required'; end if;
  if char_length(cleaned_topic) < 5 or char_length(cleaned_topic) > 240 then
    raise exception 'Consultation topic must be between 5 and 240 characters';
  end if;
  if cleaned_notes is not null and char_length(cleaned_notes) > 2000 then
    raise exception 'Consultation notes may contain at most 2000 characters';
  end if;
  if char_length(clean_location) > 160 then raise exception 'Location may contain at most 160 characters'; end if;
  if consultation_occurred_at is null or consultation_occurred_at > now() then
    raise exception 'In-person consultation date and time must be in the past';
  end if;
  if not exists (
    select 1 from public.profiles s
    where s.id=target_student and s.role='student' and s.account_status='active'
      and s.academic_unit_id=actor_unit
  ) then raise exception 'Choose an active student from your academic unit'; end if;

  insert into public.walk_in_consultations(
    academic_unit_id,student_id,faculty_id,topic,notes,occurred_at,location,recorded_by
  ) values (
    actor_unit,target_student,auth.uid(),cleaned_topic,cleaned_notes,
    consultation_occurred_at,clean_location,auth.uid()
  ) returning id into created_id;

  insert into public.audit_logs(actor_id,action,resource_type,resource_id,new_data)
  values (
    auth.uid(),'walk_in_consultation_recorded','walk_in_consultation',created_id::text,
    jsonb_build_object('academic_unit_id',actor_unit,'student_id',target_student,
      'faculty_id',auth.uid(),'occurred_at',consultation_occurred_at)
  );
  return created_id;
end;
$$;
revoke all on function public.record_walk_in_consultation(uuid,text,text,timestamptz,text) from public, anon;
grant execute on function public.record_walk_in_consultation(uuid,text,text,timestamptz,text) to authenticated;

-- Publication and booking remain time-safe, but no longer impose a fixed
-- 24-hour lead time. Slots at or before the current instant remain invalid.
create or replace function public.validate_availability_schedule()
returns trigger language plpgsql set search_path=public
as $$
declare
  local_start timestamp := new.starts_at at time zone 'Asia/Manila';
  local_end timestamp := new.ends_at at time zone 'Asia/Manila';
begin
  if extract(isodow from local_start) not between 1 and 5 then
    raise exception 'Consultation availability may only be published from Monday to Friday';
  end if;
  if new.starts_at <= now() then raise exception 'Availability must start in the future'; end if;
  if local_start::date <> local_end::date
     or local_start::time < time '08:00'
     or local_end::time > time '17:00' then
    raise exception 'Availability must stay within 8:00 AM–5:00 PM Philippine time';
  end if;
  return new;
end;
$$;

create or replace function public.book_consultation(
  target_availability uuid,
  consultation_topic text,
  consultation_notes text default null
) returns uuid
language plpgsql security definer set search_path=public
as $$
declare selected_slot public.availability%rowtype; created_id uuid;
begin
  if auth.uid() is null or public.current_role()<>'student' then raise exception 'Student access required'; end if;
  if length(trim(consultation_topic))<5 then raise exception 'Consultation topic is too short'; end if;
  select * into selected_slot from public.availability where id=target_availability for update;
  if not found or not selected_slot.is_open then raise exception 'This consultation slot is no longer available'; end if;
  if selected_slot.starts_at<=now() then raise exception 'Consultation time must be in the future'; end if;
  insert into public.appointments(availability_id,student_id,topic,notes)
  values(target_availability,auth.uid(),trim(consultation_topic),nullif(trim(consultation_notes),''))
  returning id into created_id;
  return created_id;
end;
$$;

create or replace function public.close_slot_after_booking()
returns trigger language plpgsql security definer set search_path=public
as $$
declare slot_start timestamptz;
begin
  if length(trim(new.topic))<5 then raise exception 'Consultation topic is too short'; end if;
  select starts_at into slot_start from public.availability
  where id=new.availability_id and is_open=true for update;
  if not found then raise exception 'This consultation slot is no longer available'; end if;
  if slot_start<=now() then raise exception 'Consultation time must be in the future'; end if;
  update public.availability set is_open=false where id=new.availability_id;
  return new;
end;
$$;

create or replace function public.reschedule_consultation(
  target_appointment uuid,
  new_availability uuid
) returns uuid
language plpgsql security definer set search_path=public
as $$
declare
  previous_status public.appointment_status;
  previous_availability uuid;
  previous_topic text;
  previous_notes text;
  previous_start timestamptz;
  replacement public.availability%rowtype;
  created_id uuid;
begin
  select ap.status,ap.availability_id,ap.topic,ap.notes,av.starts_at
  into previous_status,previous_availability,previous_topic,previous_notes,previous_start
  from public.appointments ap join public.availability av on av.id=ap.availability_id
  where ap.id=target_appointment and ap.student_id=auth.uid() for update of ap,av;
  if not found then raise exception 'Consultation request not found'; end if;
  if previous_status not in ('pending','confirmed') then raise exception 'Only active consultations may be rescheduled'; end if;
  if previous_start<=now() then raise exception 'Past consultations cannot be rescheduled'; end if;
  if previous_availability=new_availability then raise exception 'Choose a different consultation time'; end if;
  select * into replacement from public.availability where id=new_availability for update;
  if not found or not replacement.is_open then raise exception 'This consultation slot is no longer available'; end if;
  if replacement.starts_at<=now() then raise exception 'Consultation time must be in the future'; end if;
  update public.appointments set status='cancelled' where id=target_appointment;
  insert into public.appointments(availability_id,student_id,topic,notes)
  values(new_availability,auth.uid(),previous_topic,previous_notes)
  returning id into created_id;
  return created_id;
end;
$$;

create or replace function public.reopen_slot_after_inactive_appointment()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
  if old.status in ('pending','confirmed') and new.status in ('cancelled','declined') then
    update public.availability set is_open=(starts_at>now()) where id=new.availability_id;
  end if;
  return new;
end;
$$;

-- Permit a faculty member to read the name of a same-unit student after a
-- walk-in is recorded, while preserving the existing booking-based rule.
create or replace function public.can_read_profile(target_user uuid)
returns boolean language sql stable security definer set search_path=public
as $$
  select target_user=auth.uid()
    or public.current_role()='admin'
    or (
      public.current_role()='faculty'
      and (
        exists(
          select 1
          from public.profiles target
          join public.appointments ap on ap.student_id=target.id
          join public.availability av on av.id=ap.availability_id
          where target.id=target_user and av.faculty_id=auth.uid()
            and target.academic_unit_id=public.current_academic_unit_id()
        )
        or exists(
          select 1 from public.walk_in_consultations wc
          where wc.student_id=target_user and wc.faculty_id=auth.uid()
            and wc.academic_unit_id=public.current_academic_unit_id()
        )
      )
    )
$$;
revoke all on function public.can_read_profile(uuid) from public, anon;
grant execute on function public.can_read_profile(uuid) to authenticated;

commit;
