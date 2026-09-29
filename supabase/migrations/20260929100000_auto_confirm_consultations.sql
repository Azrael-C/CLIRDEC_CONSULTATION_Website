-- Automatically confirm only the guarded E2E student/faculty pair and notify
-- both participants. Real pilot users retain the normal faculty-approval flow.
begin;

-- Enforce the E2E-only policy even if a trusted client inserts directly into
-- the table instead of calling book_consultation. The slot-locking trigger
-- still runs afterwards and preserves the one-active-appointment invariant.
create or replace function public.auto_confirm_new_consultation()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  student_email text;
  faculty_email text;
begin
  select email into student_email
  from profiles
  where id=new.student_id;
  select p.email into faculty_email
  from availability a
  join profiles p on p.id=a.faculty_id
  where a.id=new.availability_id;
  if new.status='pending'
    and lower(coalesce(student_email,'')) like '%facultyconnect-e2e%'
    and lower(coalesce(faculty_email,'')) like '%facultyconnect-e2e%' then
    new.status='confirmed';
  end if;
  return new;
end $$;

revoke all on function public.auto_confirm_new_consultation() from public,anon,authenticated;

drop trigger if exists auto_confirm_consultation_before_insert on public.appointments;
create trigger auto_confirm_consultation_before_insert
before insert on public.appointments
for each row execute function public.auto_confirm_new_consultation();

-- The RPC remains the student-facing booking boundary. It inserts a normal
-- pending request; the guarded trigger promotes only the dedicated E2E pair.
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
  if length(trim(consultation_topic))<5 then
    raise exception 'Consultation topic is too short';
  end if;
  select * into selected_slot
  from availability
  where id=target_availability
  for update;
  if not found or not selected_slot.is_open then
    raise exception 'This consultation slot is no longer available';
  end if;
  if selected_slot.starts_at<now()+interval '24 hours' then
    raise exception 'Appointments require at least 24 hours notice';
  end if;
  insert into appointments(availability_id,student_id,topic,notes)
  values(
    target_availability,
    auth.uid(),
    trim(consultation_topic),
    nullif(trim(consultation_notes),'')
  )
  returning id into created_id;
  return created_id;
end $$;

-- A new confirmed appointment gets one confirmation email per participant and
-- the normal 60/30-minute reminders. The worker remains responsible for
-- delivery, retries, idempotency, and Resend suppression handling.
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
    if new.status='confirmed' then
      insert into email_notifications(
        appointment_id,availability_id,recipient_id,event_type,subject,body
      )
      select
        new.id,new.availability_id,new.student_id,'request_approved',
        'Consultation confirmed',
        'Your consultation request was automatically confirmed. Open FacultyConnect to review the approved time and location.'
      where exists(
        select 1 from profiles
        where id=new.student_id and email_notifications
      )
      on conflict do nothing;

      insert into email_notifications(
        appointment_id,availability_id,recipient_id,event_type,subject,body
      )
      select
        new.id,new.availability_id,faculty_user,'request_approved',
        'Consultation automatically confirmed',
        'A student consultation request was automatically confirmed. Open FacultyConnect to review the appointment details.'
      where exists(
        select 1 from profiles
        where id=faculty_user and email_notifications
      )
      on conflict do nothing;

      foreach recipient in array array[new.student_id,faculty_user] loop
        insert into email_notifications(
          appointment_id,availability_id,recipient_id,event_type,subject,body,scheduled_for
        )
        select
          new.id,new.availability_id,recipient,'reminder_60_minutes',
          'Consultation in 1 hour',
          'Your confirmed faculty consultation begins in approximately one hour. Open FacultyConnect to review the time and location.',
          slot_start-interval '1 hour'
        where slot_start>now()+interval '1 hour'
          and exists(select 1 from profiles where id=recipient and email_notifications)
        on conflict do nothing;

        insert into email_notifications(
          appointment_id,availability_id,recipient_id,event_type,subject,body,scheduled_for
        )
        select
          new.id,new.availability_id,recipient,'reminder_30_minutes',
          'Consultation in 30 minutes',
          'Your confirmed faculty consultation begins in approximately 30 minutes. Please prepare and open FacultyConnect for the approved details.',
          slot_start-interval '30 minutes'
        where slot_start>now()+interval '30 minutes'
          and exists(select 1 from profiles where id=recipient and email_notifications)
        on conflict do nothing;
      end loop;
    else
      -- Compatibility path for any legacy/manual insert that remains pending.
      insert into email_notifications(
        appointment_id,availability_id,recipient_id,event_type,subject,body
      )
      select
        new.id,new.availability_id,new.student_id,'request_submitted',
        'Consultation request received',
        'Your consultation request was received and is pending faculty approval.'
      where exists(
        select 1 from profiles
        where id=new.student_id and email_notifications
      )
      on conflict do nothing;

      insert into email_notifications(
        appointment_id,availability_id,recipient_id,event_type,subject,body
      )
      select
        new.id,new.availability_id,faculty_user,'request_submitted',
        'New consultation request',
        'A student submitted a consultation request for your review.'
      where exists(
        select 1 from profiles
        where id=faculty_user and email_notifications
      )
      on conflict do nothing;
    end if;
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
        insert into email_notifications(
          appointment_id,availability_id,recipient_id,event_type,subject,body
        )
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

revoke all on function public.book_consultation(uuid,text,text) from public,anon;
grant execute on function public.book_consultation(uuid,text,text) to authenticated;
revoke all on function public.queue_appointment_email() from public,anon,authenticated;

commit;
