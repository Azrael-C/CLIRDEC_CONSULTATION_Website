-- Apply this file once to the existing FacultyConnect Supabase project.
-- It preserves appointment history and adds atomic consultation operations.
begin;

alter table public.appointments drop constraint if exists appointments_availability_id_key;
drop index if exists public.one_active_appointment_per_slot;
create unique index one_active_appointment_per_slot
  on public.appointments(availability_id)
  where status in ('pending','confirmed');

revoke update on public.appointments from authenticated;
revoke update,delete on public.availability from authenticated;
grant select,insert on public.availability to authenticated;

drop policy if exists "faculty manages own availability" on public.availability;
create policy "faculty manages own availability" on public.availability for all to authenticated
using ((faculty_id=auth.uid() and public.current_role()='faculty') or public.current_role()='admin')
with check ((faculty_id=auth.uid() and public.current_role()='faculty') or public.current_role()='admin');

drop policy if exists "faculty update own information" on public.faculty_profiles;
create policy "faculty update own information" on public.faculty_profiles for update to authenticated
using (user_id=auth.uid() and public.current_role()='faculty')
with check (user_id=auth.uid() and public.current_role()='faculty');

create or replace function public.admin_set_user_role(target_user uuid,new_role public.user_role)
returns void language plpgsql security definer set search_path=public
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
    update availability set is_open=false where faculty_id=target_user and is_open=true;
  end if;
  insert into audit_logs(actor_id,action,resource_type,resource_id,old_data,new_data)
  values(auth.uid(),'role_changed','profile',target_user::text,jsonb_build_object('role',previous_role),jsonb_build_object('role',new_role));
end $$;

create or replace function public.book_consultation(
  target_availability uuid,
  consultation_topic text,
  consultation_notes text default null
) returns uuid
language plpgsql security definer set search_path=public
as $$
declare selected_slot availability%rowtype; created_id uuid;
begin
  if auth.uid() is null or public.current_role()<>'student' then raise exception 'Student access required'; end if;
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
returns void language plpgsql security definer set search_path=public
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

create or replace function public.reschedule_consultation(target_appointment uuid,new_availability uuid)
returns uuid language plpgsql security definer set search_path=public
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

create or replace function public.decide_consultation(target_appointment uuid,decision text)
returns void language plpgsql security definer set search_path=public
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
returns void language plpgsql security definer set search_path=public
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
returns void language plpgsql security definer set search_path=public
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

create or replace function public.reopen_slot_after_inactive_appointment()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
  if old.status in ('pending','confirmed') and new.status in ('cancelled','declined') then
    update availability set is_open=(starts_at>=now()+interval '24 hours') where id=new.availability_id;
  end if;
  return new;
end $$;
drop trigger if exists reopen_slot_after_inactive_appointment on public.appointments;
create trigger reopen_slot_after_inactive_appointment
after update of status on public.appointments
for each row execute function public.reopen_slot_after_inactive_appointment();

create or replace function public.queue_appointment_email()
returns trigger language plpgsql security definer set search_path=public
as $$
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
      if new.status='cancelled' then
        insert into email_notifications(appointment_id,recipient_id,event_type,subject,body)
        select new.id,faculty_user,event_name,mail_subject,mail_body
        where exists(select 1 from profiles where id=faculty_user and email_notifications)
        on conflict (appointment_id,recipient_id,event_type) do nothing;
      end if;
    end if;
  end if;
  return new;
end $$;

commit;
