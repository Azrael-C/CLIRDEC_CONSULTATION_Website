begin;

alter table public.email_notifications
  add column if not exists availability_id uuid references public.availability(id) on delete cascade;

alter table public.email_notifications
  drop constraint if exists email_notifications_event_type_check;

alter table public.email_notifications
  add constraint email_notifications_event_type_check check (
    event_type in (
      'availability_published',
      'request_submitted',
      'request_approved',
      'request_declined',
      'schedule_changed',
      'appointment_cancelled',
      'appointment_reminder',
      'reminder_60_minutes',
      'reminder_30_minutes'
    )
  );

create unique index if not exists one_availability_email_event_per_recipient
  on public.email_notifications(availability_id,recipient_id,event_type)
  where availability_id is not null and appointment_id is null;

create or replace function public.queue_availability_email()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  insert into email_notifications(
    availability_id,recipient_id,event_type,subject,body
  )
  select
    new.id,
    new.faculty_id,
    'availability_published',
    'Availability published',
    'Your consultation availability was published successfully and is now visible to eligible students.'
  where exists(
    select 1 from profiles
    where id=new.faculty_id and email_notifications
  )
  on conflict do nothing;
  return new;
end $$;

drop trigger if exists queue_availability_email_after_insert on public.availability;
create trigger queue_availability_email_after_insert
after insert on public.availability
for each row execute function public.queue_availability_email();

create or replace function public.queue_appointment_email()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  faculty_user uuid;
  slot_start timestamptz;
  event_name text;
  mail_subject text;
  mail_body text;
  recipient uuid;
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
    event_name := case new.status
      when 'confirmed' then 'request_approved'
      when 'declined' then 'request_declined'
      when 'cancelled' then 'appointment_cancelled'
      else null
    end;
    mail_subject := case new.status
      when 'confirmed' then 'Consultation request approved'
      when 'declined' then 'Consultation request declined'
      when 'cancelled' then 'Consultation cancelled'
      else null
    end;
    mail_body := case new.status
      when 'confirmed' then 'The faculty consultation request was approved. Open FacultyConnect to review the confirmed time and location.'
      when 'declined' then 'The consultation request was declined. Open FacultyConnect to review the status and official next steps.'
      when 'cancelled' then 'The consultation was cancelled. Open FacultyConnect to review the updated schedule.'
      else null
    end;

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
        insert into email_notifications(
          appointment_id,availability_id,recipient_id,event_type,subject,body,scheduled_for
        )
        select new.id,new.availability_id,recipient,'reminder_60_minutes',
          'Consultation in 1 hour',
          'Your confirmed faculty consultation begins in approximately one hour. Open FacultyConnect to review the time and location.',
          slot_start-interval '1 hour'
        where slot_start>now()+interval '1 hour'
          and exists(select 1 from profiles where id=recipient and email_notifications)
        on conflict do nothing;

        insert into email_notifications(
          appointment_id,availability_id,recipient_id,event_type,subject,body,scheduled_for
        )
        select new.id,new.availability_id,recipient,'reminder_30_minutes',
          'Consultation in 30 minutes',
          'Your confirmed faculty consultation begins in approximately 30 minutes. Please prepare and open FacultyConnect for the approved details.',
          slot_start-interval '30 minutes'
        where slot_start>now()+interval '30 minutes'
          and exists(select 1 from profiles where id=recipient and email_notifications)
        on conflict do nothing;
      end loop;
    elsif new.status in ('declined','cancelled') then
      delete from email_notifications
      where appointment_id=new.id
        and event_type in ('appointment_reminder','reminder_60_minutes','reminder_30_minutes')
        and status='queued';
    end if;
  end if;
  return new;
end $$;

create or replace function public.queue_due_appointment_reminders()
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare queued_count integer;
begin
  with due as (
    select ap.id appointment_id,ap.student_id,av.id availability_id,
      av.faculty_id,av.starts_at
    from appointments ap
    join availability av on av.id=ap.availability_id
    where ap.status='confirmed' and av.starts_at>now()+interval '25 minutes'
  ), recipients as (
    select appointment_id,availability_id,student_id recipient_id,starts_at from due
    union all
    select appointment_id,availability_id,faculty_id,starts_at from due
  ), reminder_rows as (
    select appointment_id,availability_id,recipient_id,
      'reminder_60_minutes'::text event_type,
      'Consultation in 1 hour'::text subject,
      'Your confirmed faculty consultation begins in approximately one hour. Open FacultyConnect to review the time and location.'::text body,
      starts_at-interval '1 hour' scheduled_for
    from recipients where starts_at>now()+interval '1 hour'
    union all
    select appointment_id,availability_id,recipient_id,
      'reminder_30_minutes',
      'Consultation in 30 minutes',
      'Your confirmed faculty consultation begins in approximately 30 minutes. Please prepare and open FacultyConnect for the approved details.',
      starts_at-interval '30 minutes'
    from recipients where starts_at>now()+interval '30 minutes'
  ), inserted as (
    insert into email_notifications(
      appointment_id,availability_id,recipient_id,event_type,subject,body,scheduled_for
    )
    select r.appointment_id,r.availability_id,r.recipient_id,r.event_type,
      r.subject,r.body,r.scheduled_for
    from reminder_rows r
    join profiles p on p.id=r.recipient_id and p.email_notifications
    on conflict do nothing
    returning 1
  )
  select count(*) into queued_count from inserted;
  return queued_count;
end $$;

revoke all on function public.queue_availability_email() from public,anon,authenticated;
revoke all on function public.queue_appointment_email() from public,anon,authenticated;
revoke all on function public.queue_due_appointment_reminders() from public,anon,authenticated;
grant execute on function public.queue_due_appointment_reminders() to service_role;

commit;
