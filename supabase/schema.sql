create extension if not exists pgcrypto;

create type public.user_role as enum ('student','faculty','admin');
create type public.appointment_status as enum ('pending','confirmed','completed','cancelled','declined');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null,
  role public.user_role not null default 'student',
  department text,
  email_notifications boolean not null default true,
  created_at timestamptz not null default now()
);
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
  constraint one_faculty_slot unique(faculty_id, starts_at, ends_at)
);
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  availability_id uuid not null unique references public.availability(id),
  student_id uuid not null references public.profiles(id),
  topic text not null,
  notes text,
  status public.appointment_status not null default 'pending',
  created_at timestamptz not null default now()
);

-- Transactional email outbox. A scheduled server-side function sends queued
-- messages to the user's registered address (Gmail and CLSU email supported).
create table public.email_notifications (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid references public.appointments(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null check (event_type in ('request_submitted','request_approved','request_declined','schedule_changed','appointment_cancelled','appointment_reminder')),
  subject text not null,
  body text not null,
  status text not null default 'queued' check (status in ('queued','processing','sent','failed')),
  attempts integer not null default 0,
  last_error text,
  scheduled_for timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index one_email_event_per_recipient on public.email_notifications(appointment_id,recipient_id,event_type);

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

alter table public.profiles enable row level security;
alter table public.faculty_profiles enable row level security;
alter table public.availability enable row level security;
alter table public.appointments enable row level security;
alter table public.email_notifications enable row level security;
alter table public.faq_entries enable row level security;
alter table public.audit_logs enable row level security;

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
create policy "read profiles" on public.profiles for select to authenticated using (true);
create policy "update own profile" on public.profiles for update to authenticated using (id=auth.uid()) with check (id=auth.uid());
create policy "public faculty information" on public.faculty_profiles for select to authenticated using (true);
create policy "faculty update own information" on public.faculty_profiles for update to authenticated using (user_id=auth.uid());
create policy "read open or related availability" on public.availability for select to authenticated using (is_open or faculty_id=auth.uid() or public.current_role()='admin' or public.can_read_booked_availability(id));
create policy "faculty manages own availability" on public.availability for all to authenticated using (faculty_id=auth.uid() or public.current_role()='admin') with check (faculty_id=auth.uid() or public.current_role()='admin');
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

-- A user may edit safe profile preferences but cannot promote their own role.
revoke update on public.profiles from authenticated;
grant update (full_name,department,email_notifications) on public.profiles to authenticated;
revoke select on public.profiles from anon,authenticated;
grant select (id,full_name,role,department) on public.profiles to authenticated;
revoke update on public.appointments from authenticated;
grant update (status,notes) on public.appointments to authenticated;

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
  select role into previous_role from profiles where id=target_user for update;
  if not found then raise exception 'User profile not found'; end if;
  update profiles set role=new_role where id=target_user;
  if new_role='faculty' then
    insert into faculty_profiles(user_id) values(target_user) on conflict (user_id) do nothing;
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
  return query
  update public.email_notifications as notification
  set status='processing', attempts=notification.attempts+1
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
create function public.create_profile() returns trigger language plpgsql security definer set search_path=public as $$ begin insert into profiles(id,full_name,email,role) values(new.id,coalesce(new.raw_user_meta_data->>'full_name','New user'),coalesce(new.email,''),'student'); return new; end $$;
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

-- Call this from Supabase Cron every 15 minutes. It queues one reminder per
-- participant when a confirmed consultation is 23-24 hours away.
create function public.queue_due_appointment_reminders() returns integer language plpgsql security definer set search_path=public as $$
declare queued_count integer;
begin
  with due as (
    select ap.id appointment_id, ap.student_id, av.faculty_id, av.starts_at
    from appointments ap join availability av on av.id=ap.availability_id
    where ap.status='confirmed' and av.starts_at between now()+interval '23 hours' and now()+interval '24 hours'
  ), recipients as (
    select appointment_id,student_id recipient_id,starts_at from due
    union all select appointment_id,faculty_id,starts_at from due
  ), inserted as (
    insert into email_notifications(appointment_id,recipient_id,event_type,subject,body)
    select r.appointment_id,r.recipient_id,'appointment_reminder','Consultation reminder','You have a confirmed faculty consultation within the next 24 hours. Sign in to review the approved time and location.'
    from recipients r join profiles p on p.id=r.recipient_id and p.email_notifications
    on conflict (appointment_id,recipient_id,event_type) do nothing returning 1
  ) select count(*) into queued_count from inserted;
  return queued_count;
end $$;