create extension if not exists pgcrypto;
create extension if not exists btree_gist;

create type public.user_role as enum ('student','faculty','admin');
create type public.appointment_status as enum ('pending','confirmed','completed','cancelled','declined');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null,
  role public.user_role not null default 'student',
  department text,
  student_number text,
  college text,
  program text,
  year_level text check (
    year_level is null or year_level in (
      '1st year','2nd year','3rd year','4th year',
      '5th year or higher','Graduate student'
    )
  ),
  email_notifications boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index profiles_student_number_unique
on public.profiles (upper(student_number))
where student_number is not null;
create table public.faculty_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  expertise text[] not null default '{}',
  bio text,
  active boolean not null default true
);
create table public.availability (
  id uuid primary key default gen_random_uuid(),
  faculty_id uuid not null references public.profiles(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  location text,
  consultation_mode text not null default 'in_person' check (consultation_mode in ('in_person','online')),
  is_open boolean not null default true,
  constraint valid_slot check (ends_at > starts_at),
  constraint one_faculty_slot unique(faculty_id, starts_at, ends_at),
  constraint no_overlapping_faculty_slots exclude using gist (
    faculty_id with =,
    tstzrange(starts_at,ends_at,'[)') with &&
  )
);
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  availability_id uuid not null references public.availability(id),
  student_id uuid not null references public.profiles(id),
  topic text not null,
  notes text,
  status public.appointment_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index one_active_appointment_per_slot
  on public.appointments(availability_id)
  where status in ('pending','confirmed');

create function public.set_appointment_updated_at()
returns trigger language plpgsql set search_path=public as $$
begin
  new.updated_at=now();
  return new;
end $$;

-- Transactional email outbox is created before the notification functions
-- that write to it. A guarded declaration appears again below so older schema
-- snapshots can continue to be applied safely.
create table public.email_notifications (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid references public.appointments(id) on delete cascade,
  availability_id uuid references public.availability(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null check (event_type in ('availability_published','request_submitted','request_approved','request_declined','schedule_changed','appointment_cancelled','appointment_reminder','reminder_60_minutes','reminder_30_minutes')),
  subject text not null,
  body text not null,
  status text not null default 'queued' check (status in ('queued','processing','sent','failed')),
  attempts integer not null default 0,
  processing_started_at timestamptz,
  last_error text,
  scheduled_for timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

-- Complete notification coverage: availability confirmations, both
-- participants on lifecycle changes, and scheduled 60/30-minute reminders.
create or replace function public.queue_availability_email()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into email_notifications(availability_id,recipient_id,event_type,subject,body)
  select new.id,new.faculty_id,'availability_published','Availability published',
    'Your consultation availability was published successfully and is now visible to eligible students.'
  where exists(select 1 from profiles where id=new.faculty_id and email_notifications)
  on conflict do nothing;
  return new;
end $$;
create trigger queue_availability_email_after_insert
after insert on public.availability
for each row execute function public.queue_availability_email();

create or replace function public.queue_appointment_email()
returns trigger language plpgsql security definer set search_path=public as $$
declare faculty_user uuid; slot_start timestamptz; event_name text;
mail_subject text; mail_body text; recipient uuid;
begin
  select faculty_id,starts_at into faculty_user,slot_start
  from availability where id=new.availability_id;
  if tg_op='INSERT' then
    insert into email_notifications(appointment_id,availability_id,recipient_id,event_type,subject,body)
    select new.id,new.availability_id,new.student_id,'request_submitted','Consultation request received','Your consultation request was received and is pending faculty approval.'
    where exists(select 1 from profiles where id=new.student_id and email_notifications)
    on conflict do nothing;
    insert into email_notifications(appointment_id,availability_id,recipient_id,event_type,subject,body)
    select new.id,new.availability_id,faculty_user,'request_submitted','New consultation request','A student submitted a consultation request for your review.'
    where exists(select 1 from profiles where id=faculty_user and email_notifications)
    on conflict do nothing;
  elsif new.status is distinct from old.status then
    event_name := case new.status when 'confirmed' then 'request_approved' when 'declined' then 'request_declined' when 'cancelled' then 'appointment_cancelled' else null end;
    mail_subject := case new.status when 'confirmed' then 'Consultation request approved' when 'declined' then 'Consultation request declined' when 'cancelled' then 'Consultation cancelled' else null end;
    mail_body := case new.status when 'confirmed' then 'The faculty consultation request was approved. Open FacultyConnect to review the confirmed time and location.' when 'declined' then 'The consultation request was declined. Open FacultyConnect to review the status and official next steps.' when 'cancelled' then 'The consultation was cancelled. Open FacultyConnect to review the updated schedule.' else null end;
    if event_name is not null then
      foreach recipient in array array[new.student_id,faculty_user] loop
        insert into email_notifications(appointment_id,availability_id,recipient_id,event_type,subject,body)
        select new.id,new.availability_id,recipient,event_name,mail_subject,mail_body
        where exists(select 1 from profiles where id=recipient and email_notifications)
        on conflict do nothing;
      end loop;
    end if;
    if new.status='confirmed' then
      foreach recipient in array array[new.student_id,faculty_user] loop
        insert into email_notifications(appointment_id,availability_id,recipient_id,event_type,subject,body,scheduled_for)
        select new.id,new.availability_id,recipient,'reminder_60_minutes','Consultation in 1 hour','Your confirmed faculty consultation begins in approximately one hour. Open FacultyConnect to review the time and location.',slot_start-interval '1 hour'
        where slot_start>now()+interval '1 hour' and exists(select 1 from profiles where id=recipient and email_notifications)
        on conflict do nothing;
        insert into email_notifications(appointment_id,availability_id,recipient_id,event_type,subject,body,scheduled_for)
        select new.id,new.availability_id,recipient,'reminder_30_minutes','Consultation in 30 minutes','Your confirmed faculty consultation begins in approximately 30 minutes. Please prepare and open FacultyConnect for the approved details.',slot_start-interval '30 minutes'
        where slot_start>now()+interval '30 minutes' and exists(select 1 from profiles where id=recipient and email_notifications)
        on conflict do nothing;
      end loop;
    elsif new.status in ('declined','cancelled') then
      delete from email_notifications where appointment_id=new.id
        and event_type in ('appointment_reminder','reminder_60_minutes','reminder_30_minutes')
        and status='queued';
    end if;
  end if;
  return new;
end $$;

create or replace function public.queue_due_appointment_reminders()
returns integer language plpgsql security definer set search_path=public as $$
declare queued_count integer;
begin
  with due as (
    select ap.id appointment_id,ap.student_id,av.id availability_id,av.faculty_id,av.starts_at
    from appointments ap join availability av on av.id=ap.availability_id
    where ap.status='confirmed' and av.starts_at>now()+interval '25 minutes'
  ), recipients as (
    select appointment_id,availability_id,student_id recipient_id,starts_at from due
    union all select appointment_id,availability_id,faculty_id,starts_at from due
  ), reminder_rows as (
    select appointment_id,availability_id,recipient_id,'reminder_60_minutes'::text event_type,'Consultation in 1 hour'::text subject,'Your confirmed faculty consultation begins in approximately one hour. Open FacultyConnect to review the time and location.'::text body,starts_at-interval '1 hour' scheduled_for from recipients where starts_at>now()+interval '1 hour'
    union all
    select appointment_id,availability_id,recipient_id,'reminder_30_minutes','Consultation in 30 minutes','Your confirmed faculty consultation begins in approximately 30 minutes. Please prepare and open FacultyConnect for the approved details.',starts_at-interval '30 minutes' from recipients where starts_at>now()+interval '30 minutes'
  ), inserted as (
    insert into email_notifications(appointment_id,availability_id,recipient_id,event_type,subject,body,scheduled_for)
    select r.appointment_id,r.availability_id,r.recipient_id,r.event_type,r.subject,r.body,r.scheduled_for
    from reminder_rows r join profiles p on p.id=r.recipient_id and p.email_notifications
    on conflict do nothing returning 1
  ) select count(*) into queued_count from inserted;
  return queued_count;
end $$;
revoke all on function public.queue_availability_email() from public,anon,authenticated;
revoke all on function public.queue_appointment_email() from public,anon,authenticated;
revoke all on function public.queue_due_appointment_reminders() from public,anon,authenticated;
grant execute on function public.queue_due_appointment_reminders() to service_role;
create trigger set_appointment_updated_at_before_update
before update on public.appointments
for each row execute function public.set_appointment_updated_at();

-- Transactional email outbox. A scheduled server-side function sends queued
-- messages to the user's registered address (Gmail and CLSU email supported).
create table if not exists public.email_notifications (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid references public.appointments(id) on delete cascade,
  availability_id uuid references public.availability(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null check (event_type in ('availability_published','request_submitted','request_approved','request_declined','schedule_changed','appointment_cancelled','appointment_reminder','reminder_60_minutes','reminder_30_minutes')),
  subject text not null,
  body text not null,
  status text not null default 'queued' check (status in ('queued','processing','sent','failed')),
  attempts integer not null default 0,
  processing_started_at timestamptz,
  last_error text,
  scheduled_for timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index one_email_event_per_recipient on public.email_notifications(appointment_id,recipient_id,event_type);
create unique index one_availability_email_event_per_recipient
  on public.email_notifications(availability_id,recipient_id,event_type)
  where availability_id is not null and appointment_id is null;

-- Product Owner-approved knowledge used by the NLP service. Draft and review
-- entries remain invisible to students until an administrator approves them.
create table public.faq_entries (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  answer text not null,
  category text not null,
  source_reference text not null,
  status text not null default 'draft' check (status in ('draft','review','approved','archived')),
  created_by uuid not null references public.profiles(id),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint approval_metadata check (
    (status='approved' and approved_by is not null and approved_at is not null)
    or status<>'approved'
  )
);

-- Append-only evidence for security-sensitive administrative actions.
create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id),
  action text not null,
  resource_type text not null,
  resource_id text not null,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

-- Retained for backward compatibility with early pilot records. New student
-- registration is domain-based and no longer reads this legacy table.
create table public.registration_allowlist (
  email text primary key check (email=lower(trim(email))),
  active boolean not null default true,
  added_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.faculty_profiles enable row level security;
alter table public.availability enable row level security;
alter table public.appointments enable row level security;
alter table public.email_notifications enable row level security;
alter table public.faq_entries enable row level security;
alter table public.audit_logs enable row level security;
alter table public.registration_allowlist enable row level security;

-- Realtime keeps active role portals synchronized across devices. The guarded
-- publication changes make the canonical schema safe to re-run.
alter table public.availability replica identity full;
alter table public.appointments replica identity full;
do $$
begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='availability') then
      execute 'alter publication supabase_realtime add table public.availability';
    end if;
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='appointments') then
      execute 'alter publication supabase_realtime add table public.appointments';
    end if;
  end if;
end $$;

create function public.current_role() returns public.user_role language sql stable security definer set search_path=public as $$ select role from profiles where id=auth.uid() $$;
-- Students must retain access to the closed availability slot attached to
-- their own request. A security-definer helper avoids recursive RLS checks
-- between availability and appointments.
create function public.can_read_booked_availability(slot_id uuid)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists(
    select 1 from appointments
    where availability_id=slot_id and student_id=auth.uid()
  )
$$;
revoke all on function public.can_read_booked_availability(uuid) from public,anon;
grant execute on function public.can_read_booked_availability(uuid) to authenticated;
create function public.can_read_profile(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select target_user=auth.uid()
    or public.current_role()='admin'
    or (
      public.current_role()='faculty'
      and exists(
        select 1
        from appointments ap
        join availability av on av.id=ap.availability_id
        where ap.student_id=target_user and av.faculty_id=auth.uid()
      )
    )
$$;
revoke all on function public.can_read_profile(uuid) from public,anon;
grant execute on function public.can_read_profile(uuid) to authenticated;

create function public.faculty_directory(target_ids uuid[] default null)
returns table(id uuid,full_name text,department text,expertise text[],bio text)
language sql
stable
security definer
set search_path=public
as $$
  select p.id,p.full_name,p.department,fp.expertise,coalesce(fp.bio,'')
  from profiles p
  join faculty_profiles fp on fp.user_id=p.id
  where p.role='faculty'
    and fp.active
    and (target_ids is null or p.id=any(target_ids))
  order by p.full_name
$$;
revoke all on function public.faculty_directory(uuid[]) from public,anon;
grant execute on function public.faculty_directory(uuid[]) to authenticated;

create policy "read permitted profiles" on public.profiles for select to authenticated using (public.can_read_profile(id));
create policy "update own profile" on public.profiles for update to authenticated using (id=auth.uid()) with check (id=auth.uid());
create policy "public faculty information" on public.faculty_profiles for select to authenticated using (true);
create policy "faculty update own information" on public.faculty_profiles for update to authenticated
using (user_id=auth.uid() and public.current_role()='faculty')
with check (user_id=auth.uid() and public.current_role()='faculty');
create policy "read open or related availability" on public.availability for select to authenticated using (is_open or faculty_id=auth.uid() or public.current_role()='admin' or public.can_read_booked_availability(id));
create policy "faculty manages own availability" on public.availability for all to authenticated
using ((faculty_id=auth.uid() and public.current_role()='faculty') or public.current_role()='admin')
with check ((faculty_id=auth.uid() and public.current_role()='faculty') or public.current_role()='admin');
create policy "students create own appointments" on public.appointments for insert to authenticated with check (student_id=auth.uid() and public.current_role()='student');
create policy "participants read appointments" on public.appointments for select to authenticated using (student_id=auth.uid() or exists(select 1 from availability a where a.id=availability_id and a.faculty_id=auth.uid()) or public.current_role()='admin');
create policy "students cancel own pending appointments" on public.appointments for update to authenticated
using (student_id=auth.uid() and status='pending')
with check (student_id=auth.uid() and status='cancelled');
create policy "faculty and admin decide appointments" on public.appointments for update to authenticated
using (exists(select 1 from availability a where a.id=availability_id and a.faculty_id=auth.uid()) or public.current_role()='admin')
with check (exists(select 1 from availability a where a.id=availability_id and a.faculty_id=auth.uid()) or public.current_role()='admin');
create policy "users read own email history" on public.email_notifications for select to authenticated using (recipient_id=auth.uid() or public.current_role()='admin');
create policy "users read approved FAQ entries" on public.faq_entries for select to authenticated using (status='approved' or public.current_role()='admin');
create policy "admins create FAQ entries" on public.faq_entries for insert to authenticated with check (public.current_role()='admin' and created_by=auth.uid());
create policy "admins update FAQ entries" on public.faq_entries for update to authenticated using (public.current_role()='admin') with check (public.current_role()='admin');
create policy "admins archive FAQ entries" on public.faq_entries for delete to authenticated using (public.current_role()='admin');
create policy "admins read audit logs" on public.audit_logs for select to authenticated using (public.current_role()='admin');
create policy "admins manage registration allowlist" on public.registration_allowlist for all to authenticated
using (public.current_role()='admin')
with check (public.current_role()='admin' and (added_by is null or added_by=auth.uid()));
grant select,insert,update,delete on public.registration_allowlist to authenticated;

-- Availability follows CLSU's weekday pilot window in Philippine Standard Time.
-- Updating only is_open (when a student books) does not re-run this validation.
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
    raise exception 'Availability must stay within 8:00 AM–5:00 PM Philippine time';
  end if;
  return new;
end $$;
create trigger validate_availability_schedule_before_write
before insert or update of starts_at,ends_at on public.availability
for each row execute function public.validate_availability_schedule();

-- Browser roles receive only the operations used by the portal. RLS remains
-- the row-level ownership boundary for every granted operation.
revoke all on table public.profiles from anon,authenticated;
revoke all on table public.faculty_profiles from anon,authenticated;
revoke all on table public.availability from anon,authenticated;
revoke all on table public.appointments from anon,authenticated;
revoke all on table public.email_notifications from anon,authenticated;
revoke all on table public.faq_entries from anon,authenticated;
revoke all on table public.audit_logs from anon,authenticated;
revoke all on table public.registration_allowlist from anon,authenticated;

grant update (full_name,department,email_notifications,college,program,year_level) on public.profiles to authenticated;
grant select (id,full_name,role,department,email_notifications,student_number,college,program,year_level) on public.profiles to authenticated;
grant select on public.faculty_profiles to authenticated;
grant update (expertise,bio) on public.faculty_profiles to authenticated;
grant select,insert on public.availability to authenticated;
grant select on public.appointments to authenticated;
grant select on public.email_notifications to authenticated;
grant select,insert,update,delete on public.faq_entries to authenticated;
grant select on public.audit_logs to authenticated;
grant select,insert,update,delete on public.registration_allowlist to authenticated;

revoke all on function public.current_role() from public,anon;
grant execute on function public.current_role() to authenticated;

-- Only trusted administrators can assign faculty or administrator roles. The
-- browser cannot directly update the role column.
create or replace function public.admin_set_user_role(target_user uuid, new_role public.user_role)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare previous_role public.user_role;
begin
  if public.current_role()<>'admin' then raise exception 'Administrator access required'; end if;
  if target_user=auth.uid() and new_role<>'admin' then raise exception 'Administrators cannot remove their own access'; end if;
  select role into previous_role from profiles where id=target_user for update;
  if not found then raise exception 'User profile not found'; end if;
  update profiles set role=new_role where id=target_user;
  if new_role='faculty' then
    insert into faculty_profiles(user_id,active) values(target_user,true)
    on conflict (user_id) do update set active=true;
  else
    update faculty_profiles set active=false where user_id=target_user;
    update availability set is_open=false
    where faculty_id=target_user and is_open=true;
  end if;
  insert into audit_logs(actor_id,action,resource_type,resource_id,old_data,new_data)
  values(auth.uid(),'role_changed','profile',target_user::text,jsonb_build_object('role',previous_role),jsonb_build_object('role',new_role));
end $$;
revoke all on function public.admin_set_user_role(uuid,public.user_role) from public,anon;
grant execute on function public.admin_set_user_role(uuid,public.user_role) to authenticated;

create or replace function public.audit_faq_change()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  insert into audit_logs(actor_id,action,resource_type,resource_id,old_data,new_data)
  values(auth.uid(),lower(tg_op),'faq_entry',(case when tg_op='DELETE' then old.id else new.id end)::text,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end);
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger audit_faq_entry_changes after insert or update or delete on public.faq_entries
for each row execute function public.audit_faq_change();

-- Atomically claims a batch for the email worker. SKIP LOCKED prevents two
-- concurrent invocations from sending the same queued notification.
create or replace function public.claim_email_notifications(batch_size integer default 25)
returns setof public.email_notifications
language plpgsql
security definer
set search_path=public
as $$
begin
  update public.email_notifications
  set status='queued',
      processing_started_at=null,
      scheduled_for=now(),
      last_error=coalesce(last_error,'Email worker lease expired before completion')
  where status='processing'
    and processing_started_at<now()-interval '15 minutes'
    and attempts<4;

  return query
  update public.email_notifications as notification
  set status='processing',
      attempts=notification.attempts+1,
      processing_started_at=now()
  where notification.id in (
    select candidate.id
    from public.email_notifications as candidate
    where candidate.status='queued'
      and candidate.scheduled_for<=now()
      and candidate.attempts<4
    order by candidate.scheduled_for, candidate.created_at
    for update skip locked
    limit greatest(1,least(batch_size,100))
  )
  returning notification.*;
end $$;
revoke all on function public.claim_email_notifications(integer) from public,anon,authenticated;
grant execute on function public.claim_email_notifications(integer) to service_role;

create function public.close_slot_after_booking() returns trigger language plpgsql security definer set search_path=public as $$ begin update availability set is_open=false where id=new.availability_id and is_open=true; if not found then raise exception 'This consultation slot is no longer available'; end if; return new; end $$;
create trigger prevent_double_booking before insert on public.appointments for each row execute function public.close_slot_after_booking();

-- New public registrations are always students. Faculty and administrator roles
-- must be assigned through a trusted administrative process.
create function public.create_profile() returns trigger language plpgsql security definer set search_path=public as $$
declare normalized_email text := lower(trim(coalesce(new.email,'')));
begin
  if normalized_email !~ '^[^@[:space:]]+@(gmail\.com|clsu2\.edu\.ph)$' then
    raise exception 'Student registration requires a gmail.com or clsu2.edu.ph email address';
  end if;
  insert into profiles(
    id,full_name,email,role,student_number,college,program,year_level,department
  )
  values(
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name','New user'),
    normalized_email,
    'student',
    nullif(trim(new.raw_user_meta_data->>'student_number'),''),
    nullif(trim(new.raw_user_meta_data->>'college'),''),
    nullif(trim(new.raw_user_meta_data->>'program'),''),
    nullif(trim(new.raw_user_meta_data->>'year_level'),''),
    concat_ws(' · ',
      nullif(trim(new.raw_user_meta_data->>'program'),''),
      nullif(trim(new.raw_user_meta_data->>'year_level'),'')
    )
  );
  return new;
end $$;
create trigger create_profile_after_signup after insert on auth.users for each row execute function public.create_profile();

create function public.queue_appointment_email() returns trigger language plpgsql security definer set search_path=public as $$
declare faculty_user uuid; event_name text; mail_subject text; mail_body text;
begin
  select faculty_id into faculty_user from availability where id=new.availability_id;
  if tg_op='INSERT' then
    insert into email_notifications(appointment_id,recipient_id,event_type,subject,body)
    select new.id,new.student_id,'request_submitted','Consultation request received','Your consultation request was received and is pending faculty approval.'
    where exists(select 1 from profiles where id=new.student_id and email_notifications);
    insert into email_notifications(appointment_id,recipient_id,event_type,subject,body)
    select new.id,faculty_user,'request_submitted','New consultation request','A student submitted a consultation request for your review.'
    where exists(select 1 from profiles where id=faculty_user and email_notifications);
  elsif new.status is distinct from old.status then
    event_name := case new.status when 'confirmed' then 'request_approved' when 'declined' then 'request_declined' when 'cancelled' then 'appointment_cancelled' else null end;
    mail_subject := case new.status when 'confirmed' then 'Consultation request approved' when 'declined' then 'Consultation request declined' when 'cancelled' then 'Consultation cancelled' else null end;
    mail_body := case new.status when 'confirmed' then 'Your faculty consultation request was approved. Sign in to view the confirmed details.' when 'declined' then 'Your consultation request was not approved. Sign in to view the status and official next steps.' when 'cancelled' then 'A consultation was cancelled. Sign in to review the updated information.' else null end;
    if event_name is not null then
      insert into email_notifications(appointment_id,recipient_id,event_type,subject,body)
      select new.id,new.student_id,event_name,mail_subject,mail_body
      where exists(select 1 from profiles where id=new.student_id and email_notifications)
      on conflict (appointment_id,recipient_id,event_type) do nothing;
    end if;
  end if;
  return new;
end $$;
create trigger queue_appointment_email_after_insert after insert on public.appointments for each row execute function public.queue_appointment_email();
create trigger queue_appointment_email_after_status after update of status on public.appointments for each row execute function public.queue_appointment_email();

revoke all on function public.set_appointment_updated_at() from public,anon,authenticated;
revoke all on function public.validate_availability_schedule() from public,anon,authenticated;
revoke all on function public.close_slot_after_booking() from public,anon,authenticated;
revoke all on function public.create_profile() from public,anon,authenticated;
revoke all on function public.queue_appointment_email() from public,anon,authenticated;
revoke all on function public.audit_faq_change() from public,anon,authenticated;

-- Post-consultation reviews are available only after a faculty member marks a
-- consultation completed. Demographic snapshots support historical reports.
create table if not exists public.consultation_reviews (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null unique references public.appointments(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  faculty_id uuid not null references public.profiles(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text check (comment is null or char_length(comment) <= 1000),
  year_level text,
  college text,
  program text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists consultation_reviews_faculty_idx on public.consultation_reviews(faculty_id,created_at desc);
create index if not exists consultation_reviews_demographics_idx on public.consultation_reviews(college,program,year_level);
alter table public.consultation_reviews enable row level security;
create policy "students read own consultation reviews" on public.consultation_reviews for select to authenticated
using (student_id=auth.uid() or public.current_role()='admin');
revoke all on public.consultation_reviews from anon,authenticated;
grant select on public.consultation_reviews to authenticated;

create or replace function public.submit_consultation_review(target_appointment uuid,review_rating integer,review_comment text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare review_id uuid; target_faculty uuid; student_year text; student_college text; student_program text;
cleaned_comment text := nullif(trim(coalesce(review_comment,'')),'');
begin
  if public.current_role()<>'student' then raise exception 'Only students may submit consultation reviews'; end if;
  if review_rating not between 1 and 5 then raise exception 'Choose a rating from 1 to 5 stars'; end if;
  if char_length(coalesce(cleaned_comment,''))>1000 then raise exception 'Review comments may contain at most 1000 characters'; end if;
  select av.faculty_id,p.year_level,p.college,p.program into target_faculty,student_year,student_college,student_program
  from appointments ap join availability av on av.id=ap.availability_id join profiles p on p.id=ap.student_id
  where ap.id=target_appointment and ap.student_id=auth.uid() and ap.status='completed';
  if not found then raise exception 'Only your completed consultations may be reviewed'; end if;
  insert into consultation_reviews(appointment_id,student_id,faculty_id,rating,comment,year_level,college,program)
  values(target_appointment,auth.uid(),target_faculty,review_rating,cleaned_comment,student_year,student_college,student_program)
  on conflict(appointment_id) do update set rating=excluded.rating,comment=excluded.comment,year_level=excluded.year_level,college=excluded.college,program=excluded.program,updated_at=now()
  returning id into review_id;
  return review_id;
end $$;
revoke all on function public.submit_consultation_review(uuid,integer,text) from public,anon;
grant execute on function public.submit_consultation_review(uuid,integer,text) to authenticated;

-- Core consultation workflow. Security-definer RPCs keep multi-table changes
-- atomic and ensure browser clients cannot bypass ownership or status rules.
create or replace function public.book_consultation(
  target_availability uuid,
  consultation_topic text,
  consultation_notes text default null
) returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare selected_slot availability%rowtype; created_id uuid;
begin
  if auth.uid() is null or public.current_role()<>'student' then
    raise exception 'Student access required';
  end if;
  if length(trim(consultation_topic))<5 then raise exception 'Consultation topic is too short'; end if;
  select * into selected_slot from availability where id=target_availability for update;
  if not found or not selected_slot.is_open then raise exception 'This consultation slot is no longer available'; end if;
  if selected_slot.starts_at<now()+interval '24 hours' then raise exception 'Appointments require at least 24 hours notice'; end if;
  insert into appointments(availability_id,student_id,topic,notes)
  values(target_availability,auth.uid(),trim(consultation_topic),nullif(trim(consultation_notes),''))
  returning id into created_id;
  return created_id;
end $$;

create or replace function public.close_slot_after_booking()
returns trigger language plpgsql security definer set search_path=public
as $$
declare slot_start timestamptz;
begin
  if length(trim(new.topic))<5 then raise exception 'Consultation topic is too short'; end if;
  select starts_at into slot_start from availability
  where id=new.availability_id and is_open=true for update;
  if not found then raise exception 'This consultation slot is no longer available'; end if;
  if slot_start<now()+interval '24 hours' then raise exception 'Appointments require at least 24 hours notice'; end if;
  update availability set is_open=false where id=new.availability_id;
  return new;
end $$;

create or replace function public.cancel_consultation(target_appointment uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare current_status appointment_status; slot_start timestamptz;
begin
  select ap.status,av.starts_at into current_status,slot_start
  from appointments ap join availability av on av.id=ap.availability_id
  where ap.id=target_appointment and ap.student_id=auth.uid() for update of ap,av;
  if not found then raise exception 'Consultation request not found'; end if;
  if current_status not in ('pending','confirmed') then raise exception 'Only pending or confirmed consultations may be cancelled'; end if;
  if slot_start<=now() then raise exception 'Past consultations cannot be cancelled'; end if;
  update appointments set status='cancelled' where id=target_appointment;
end $$;

create or replace function public.reschedule_consultation(
  target_appointment uuid,
  new_availability uuid
) returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  previous_status appointment_status;
  previous_availability uuid;
  previous_topic text;
  previous_notes text;
  previous_start timestamptz;
  replacement availability%rowtype;
  created_id uuid;
begin
  select ap.status,ap.availability_id,ap.topic,ap.notes,av.starts_at
  into previous_status,previous_availability,previous_topic,previous_notes,previous_start
  from appointments ap join availability av on av.id=ap.availability_id
  where ap.id=target_appointment and ap.student_id=auth.uid() for update of ap,av;
  if not found then raise exception 'Consultation request not found'; end if;
  if previous_status not in ('pending','confirmed') then raise exception 'Only active consultations may be rescheduled'; end if;
  if previous_start<=now() then raise exception 'Past consultations cannot be rescheduled'; end if;
  if previous_availability=new_availability then raise exception 'Choose a different consultation time'; end if;
  select * into replacement from availability where id=new_availability for update;
  if not found or not replacement.is_open then raise exception 'This consultation slot is no longer available'; end if;
  if replacement.starts_at<now()+interval '24 hours' then raise exception 'Appointments require at least 24 hours notice'; end if;
  update appointments set status='cancelled' where id=target_appointment;
  insert into appointments(availability_id,student_id,topic,notes)
  values(new_availability,auth.uid(),previous_topic,previous_notes)
  returning id into created_id;
  return created_id;
end $$;

create or replace function public.decide_consultation(target_appointment uuid, decision text)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare owner_id uuid; current_status appointment_status; slot_start timestamptz;
begin
  if decision not in ('confirmed','declined') then raise exception 'Invalid consultation decision'; end if;
  select av.faculty_id,ap.status,av.starts_at into owner_id,current_status,slot_start
  from appointments ap join availability av on av.id=ap.availability_id
  where ap.id=target_appointment for update of ap,av;
  if not found then raise exception 'Consultation request not found'; end if;
  if auth.uid()<>owner_id and public.current_role()<>'admin' then raise exception 'Faculty access required'; end if;
  if current_status<>'pending' then raise exception 'Only pending requests may be decided'; end if;
  if slot_start<=now() then raise exception 'This consultation time has already passed'; end if;
  update appointments set status=decision::appointment_status where id=target_appointment;
end $$;

create or replace function public.complete_consultation(target_appointment uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare owner_id uuid; current_status appointment_status; slot_end timestamptz;
begin
  select av.faculty_id,ap.status,av.ends_at into owner_id,current_status,slot_end
  from appointments ap join availability av on av.id=ap.availability_id
  where ap.id=target_appointment for update of ap,av;
  if not found then raise exception 'Consultation request not found'; end if;
  if auth.uid()<>owner_id and public.current_role()<>'admin' then raise exception 'Faculty access required'; end if;
  if current_status<>'confirmed' then raise exception 'Only confirmed consultations may be completed'; end if;
  if slot_end>now() then raise exception 'The consultation has not ended yet'; end if;
  update appointments set status='completed' where id=target_appointment;
end $$;

create or replace function public.withdraw_availability(target_availability uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare owner_id uuid;
begin
  select faculty_id into owner_id from availability where id=target_availability for update;
  if not found then raise exception 'Availability entry not found'; end if;
  if auth.uid()<>owner_id and public.current_role()<>'admin' then raise exception 'Faculty access required'; end if;
  if exists(select 1 from appointments where availability_id=target_availability and status in ('pending','confirmed')) then
    raise exception 'Availability with an active request cannot be withdrawn';
  end if;
  update availability set is_open=false where id=target_availability;
end $$;

revoke all on function public.book_consultation(uuid,text,text) from public,anon;
revoke all on function public.cancel_consultation(uuid) from public,anon;
revoke all on function public.reschedule_consultation(uuid,uuid) from public,anon;
revoke all on function public.decide_consultation(uuid,text) from public,anon;
revoke all on function public.complete_consultation(uuid) from public,anon;
revoke all on function public.withdraw_availability(uuid) from public,anon;
grant execute on function public.book_consultation(uuid,text,text) to authenticated;
grant execute on function public.cancel_consultation(uuid) to authenticated;
grant execute on function public.reschedule_consultation(uuid,uuid) to authenticated;
grant execute on function public.decide_consultation(uuid,text) to authenticated;
grant execute on function public.complete_consultation(uuid) to authenticated;
grant execute on function public.withdraw_availability(uuid) to authenticated;

-- Closed slots become available again only when a cancellation or decline
-- leaves enough notice for another student to make a valid request.
create or replace function public.reopen_slot_after_inactive_appointment()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if old.status in ('pending','confirmed') and new.status in ('cancelled','declined') then
    update availability
    set is_open=(starts_at>=now()+interval '24 hours')
    where id=new.availability_id;
  end if;
  return new;
end $$;
create trigger reopen_slot_after_inactive_appointment
after update of status on public.appointments
for each row execute function public.reopen_slot_after_inactive_appointment();
revoke all on function public.reopen_slot_after_inactive_appointment() from public,anon,authenticated;

-- Queue status notifications for every affected participant. The email worker
-- remains responsible for delivery and retry handling.
create or replace function public.queue_appointment_email() returns trigger language plpgsql security definer set search_path=public as $$
declare faculty_user uuid; slot_start timestamptz; event_name text;
mail_subject text; mail_body text; recipient uuid;
begin
  select faculty_id,starts_at into faculty_user,slot_start from availability where id=new.availability_id;
  if tg_op='INSERT' then
    insert into email_notifications(appointment_id,availability_id,recipient_id,event_type,subject,body)
    select new.id,new.availability_id,new.student_id,'request_submitted','Consultation request received','Your consultation request was received and is pending faculty approval.' where exists(select 1 from profiles where id=new.student_id and email_notifications) on conflict do nothing;
    insert into email_notifications(appointment_id,availability_id,recipient_id,event_type,subject,body)
    select new.id,new.availability_id,faculty_user,'request_submitted','New consultation request','A student submitted a consultation request for your review.' where exists(select 1 from profiles where id=faculty_user and email_notifications) on conflict do nothing;
  elsif new.status is distinct from old.status then
    event_name := case new.status when 'confirmed' then 'request_approved' when 'declined' then 'request_declined' when 'cancelled' then 'appointment_cancelled' else null end;
    mail_subject := case new.status when 'confirmed' then 'Consultation request approved' when 'declined' then 'Consultation request declined' when 'cancelled' then 'Consultation cancelled' else null end;
    mail_body := case new.status when 'confirmed' then 'The faculty consultation request was approved. Open FacultyConnect to review the confirmed time and location.' when 'declined' then 'The consultation request was declined. Open FacultyConnect to review the status and official next steps.' when 'cancelled' then 'The consultation was cancelled. Open FacultyConnect to review the updated schedule.' else null end;
    if event_name is not null then
      foreach recipient in array array[new.student_id,faculty_user] loop
        insert into email_notifications(appointment_id,availability_id,recipient_id,event_type,subject,body)
        select new.id,new.availability_id,recipient,event_name,mail_subject,mail_body where exists(select 1 from profiles where id=recipient and email_notifications) on conflict do nothing;
      end loop;
    end if;
    if new.status='confirmed' then
      foreach recipient in array array[new.student_id,faculty_user] loop
        insert into email_notifications(appointment_id,availability_id,recipient_id,event_type,subject,body,scheduled_for)
        select new.id,new.availability_id,recipient,'reminder_60_minutes','Consultation in 1 hour','Your confirmed faculty consultation begins in approximately one hour. Open FacultyConnect to review the time and location.',slot_start-interval '1 hour' where slot_start>now()+interval '1 hour' and exists(select 1 from profiles where id=recipient and email_notifications) on conflict do nothing;
        insert into email_notifications(appointment_id,availability_id,recipient_id,event_type,subject,body,scheduled_for)
        select new.id,new.availability_id,recipient,'reminder_30_minutes','Consultation in 30 minutes','Your confirmed faculty consultation begins in approximately 30 minutes. Please prepare and open FacultyConnect for the approved details.',slot_start-interval '30 minutes' where slot_start>now()+interval '30 minutes' and exists(select 1 from profiles where id=recipient and email_notifications) on conflict do nothing;
      end loop;
    elsif new.status in ('declined','cancelled') then
      delete from email_notifications where appointment_id=new.id and event_type in ('appointment_reminder','reminder_60_minutes','reminder_30_minutes') and status='queued';
    end if;
  end if;
  return new;
end $$;
