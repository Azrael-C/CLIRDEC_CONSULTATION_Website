-- Release hardening for the controlled FacultyConnect pilot.
-- Apply once after core_workflow_migration.sql and notification_refresh_migration.sql.
begin;

alter table public.email_notifications
  add column if not exists processing_started_at timestamptz;

create table if not exists public.registration_allowlist (
  email text primary key check (email=lower(trim(email))),
  active boolean not null default true,
  added_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.registration_allowlist enable row level security;

create or replace function public.can_read_profile(target_user uuid)
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

create or replace function public.faculty_directory(target_ids uuid[] default null)
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

drop policy if exists "read profiles" on public.profiles;
drop policy if exists "read permitted profiles" on public.profiles;
create policy "read permitted profiles" on public.profiles
for select to authenticated using (public.can_read_profile(id));

drop policy if exists "admins manage registration allowlist" on public.registration_allowlist;
create policy "admins manage registration allowlist" on public.registration_allowlist
for all to authenticated
using (public.current_role()='admin')
with check (public.current_role()='admin' and (added_by is null or added_by=auth.uid()));
grant select,insert,update,delete on public.registration_allowlist to authenticated;

create or replace function public.create_profile()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare normalized_email text := lower(trim(coalesce(new.email,'')));
begin
  if not exists(
    select 1 from registration_allowlist
    where email=normalized_email and active
  ) then
    raise exception 'This email address is not approved for the FacultyConnect pilot';
  end if;
  insert into profiles(id,full_name,email,role)
  values(new.id,coalesce(new.raw_user_meta_data->>'full_name','New user'),normalized_email,'student');
  update registration_allowlist set active=false where email=normalized_email;
  return new;
end $$;

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
    order by candidate.scheduled_for,candidate.created_at
    for update skip locked
    limit greatest(1,least(batch_size,100))
  )
  returning notification.*;
end $$;
revoke all on function public.claim_email_notifications(integer) from public,anon,authenticated;
grant execute on function public.claim_email_notifications(integer) to service_role;

revoke all on function public.queue_due_appointment_reminders() from public,anon,authenticated;
grant execute on function public.queue_due_appointment_reminders() to service_role;

commit;
