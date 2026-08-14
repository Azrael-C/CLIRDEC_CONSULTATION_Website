-- Operational hardening for the production pilot.
-- Retention is deliberately preview-only until CLSU approves the periods.
begin;

alter table public.profiles
  add column if not exists account_status text not null default 'active'
    check (account_status in ('active','suspended','deactivated')),
  add column if not exists status_reason text,
  add column if not exists status_changed_at timestamptz,
  add column if not exists status_changed_by uuid references public.profiles(id);

alter table public.faq_entries
  add column if not exists content_owner_id uuid references public.profiles(id),
  add column if not exists last_reviewed_at timestamptz,
  add column if not exists review_due_at timestamptz,
  add column if not exists review_interval_days integer not null default 180
    check (review_interval_days between 30 and 730);

update public.faq_entries
set content_owner_id=coalesce(content_owner_id,created_by),
    last_reviewed_at=coalesce(last_reviewed_at,approved_at),
    review_due_at=coalesce(review_due_at,approved_at+make_interval(days=>review_interval_days))
where status='approved';

create table if not exists public.retention_policies (
  record_type text primary key,
  retention_days integer not null check (retention_days between 30 and 3650),
  rationale text not null,
  approved boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

create table if not exists public.client_error_events (
  id bigint generated always as identity primary key,
  reporter_id uuid references public.profiles(id) on delete set null,
  event_type text not null check (event_type in ('render_error','runtime_error','unhandled_rejection','booking_error','chatbot_error')),
  message text not null check (char_length(message) between 1 and 500),
  route text not null default '/',
  release text,
  created_at timestamptz not null default now()
);
create index if not exists client_error_events_created_at_idx on public.client_error_events(created_at desc);
alter table public.client_error_events enable row level security;
create policy "admins read client errors" on public.client_error_events
for select to authenticated using (public.current_role()='admin');
revoke all on public.client_error_events from public,anon,authenticated;
grant select on public.client_error_events to authenticated;

create or replace function public.record_client_error(
  target_event_type text,target_message text,target_route text,target_release text default null
) returns void language plpgsql security definer set search_path=public as $$
declare cleaned_message text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if target_event_type not in ('render_error','runtime_error','unhandled_rejection','booking_error','chatbot_error') then
    raise exception 'Unsupported client error type';
  end if;
  if (select count(*) from client_error_events where reporter_id=auth.uid() and created_at>now()-interval '10 minutes')>=20 then
    raise exception 'Client error reporting rate limit reached';
  end if;
  cleaned_message:=left(regexp_replace(regexp_replace(coalesce(target_message,'Client error'),
    '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}','[email removed]','gi'),
    '[[:digit:]]{7,}','[identifier removed]','g'),500);
  insert into client_error_events(reporter_id,event_type,message,route,release)
  values(auth.uid(),target_event_type,coalesce(nullif(cleaned_message,''),'Client error'),
    left(coalesce(nullif(target_route,''),'/'),200),left(target_release,100));
end $$;
revoke all on function public.record_client_error(text,text,text,text) from public,anon;
grant execute on function public.record_client_error(text,text,text,text) to authenticated;

insert into public.retention_policies(record_type,retention_days,rationale)
values
  ('appointments',730,'Academic support history and service accountability'),
  ('consultation_reviews',730,'Quality improvement and historical reporting'),
  ('email_delivery_events',180,'Delivery troubleshooting and complaint evidence'),
  ('audit_logs',1095,'Security and privileged-action accountability'),
  ('presence_metadata',30,'Short-lived operational activity signal')
on conflict(record_type) do nothing;

alter table public.retention_policies enable row level security;
create policy "admins read retention policies" on public.retention_policies
for select to authenticated using (public.current_role()='admin');
create policy "admins update retention policies" on public.retention_policies
for update to authenticated using (public.current_role()='admin')
with check (public.current_role()='admin' and updated_by=auth.uid());

-- Suspended users may read their own profile so the UI can explain the state,
-- but current_role returns null and therefore all role-protected operations fail.
-- AAL2 enforcement is deliberately enabled by the next migration only after
-- the matching MFA frontend is live.
create or replace function public.current_role()
returns public.user_role
language sql stable security definer set search_path=public
as $$
  select case
    when account_status<>'active' then null
    else role
  end
  from profiles where id=auth.uid()
$$;

create or replace function public.admin_set_account_status(
  target_user uuid,
  new_status text,
  reason text default null
) returns void
language plpgsql security definer set search_path=public,auth
as $$
declare previous_status text; target_role public.user_role;
begin
  if public.current_role() is distinct from 'admin'::public.user_role then raise exception 'Administrator access required'; end if;
  if new_status not in ('active','suspended','deactivated') then raise exception 'Unsupported account status'; end if;
  if target_user=auth.uid() and new_status<>'active' then raise exception 'Administrators cannot disable their own account'; end if;
  select account_status,role into previous_status,target_role from public.profiles where id=target_user for update;
  if not found then raise exception 'User profile not found'; end if;
  update public.profiles set
    account_status=new_status,
    status_reason=nullif(left(trim(coalesce(reason,'')),500),''),
    status_changed_at=now(),status_changed_by=auth.uid(),
    last_seen_at=case when new_status='active' then last_seen_at else null end
  where id=target_user;
  if target_role='faculty' and new_status<>'active' then
    update public.faculty_profiles set active=false where user_id=target_user;
    update public.availability set is_open=false where faculty_id=target_user and is_open;
  elsif target_role='faculty' and new_status='active' then
    update public.faculty_profiles set active=true where user_id=target_user;
  end if;
  if new_status<>'active' then
    delete from auth.sessions where user_id=target_user;
    -- Older and newer GoTrue releases have used slightly different internal
    -- refresh-token schemas. Revoke them when the user_id column is present,
    -- while keeping the migration compatible with both layouts.
    if exists (
      select 1 from information_schema.columns
      where table_schema='auth' and table_name='refresh_tokens' and column_name='user_id'
    ) then
      execute 'delete from auth.refresh_tokens where user_id::text=$1'
      using target_user::text;
    end if;
  end if;
  insert into public.audit_logs(actor_id,action,resource_type,resource_id,old_data,new_data)
  values(auth.uid(),'account_status_changed','profile',target_user::text,
    jsonb_build_object('account_status',previous_status),
    jsonb_build_object('account_status',new_status,'reason',nullif(trim(coalesce(reason,'')),'')));
end $$;
revoke all on function public.admin_set_account_status(uuid,text,text) from public,anon;
grant execute on function public.admin_set_account_status(uuid,text,text) to authenticated;

create or replace function public.admin_update_retention_policy(
  target_record_type text,
  target_days integer,
  target_rationale text,
  target_approved boolean
) returns void
language plpgsql security definer set search_path=public
as $$
declare old_row public.retention_policies%rowtype;
begin
  if public.current_role() is distinct from 'admin'::public.user_role then raise exception 'Administrator access required'; end if;
  if target_days not between 30 and 3650 then raise exception 'Retention must be between 30 and 3650 days'; end if;
  select * into old_row from public.retention_policies where record_type=target_record_type for update;
  if not found then raise exception 'Retention policy not found'; end if;
  update public.retention_policies set retention_days=target_days,
    rationale=left(trim(target_rationale),500),approved=target_approved,
    updated_at=now(),updated_by=auth.uid()
  where record_type=target_record_type;
  insert into public.audit_logs(actor_id,action,resource_type,resource_id,old_data,new_data)
  values(auth.uid(),'retention_policy_changed','retention_policy',target_record_type,
    to_jsonb(old_row),jsonb_build_object('retention_days',target_days,'rationale',target_rationale,'approved',target_approved));
end $$;
revoke all on function public.admin_update_retention_policy(text,integer,text,boolean) from public,anon;
grant execute on function public.admin_update_retention_policy(text,integer,text,boolean) to authenticated;

create or replace function public.retention_preview()
returns table(record_type text,retention_days integer,approved boolean,eligible_records bigint)
language plpgsql stable security definer set search_path=public
as $$
declare p public.retention_policies%rowtype;
begin
  if public.current_role() is distinct from 'admin'::public.user_role then raise exception 'Administrator access required'; end if;
  for p in select rp.* from public.retention_policies rp order by rp.record_type loop
    record_type:=p.record_type; retention_days:=p.retention_days; approved:=p.approved;
    eligible_records:=case p.record_type
      when 'appointments' then (select count(*) from public.appointments where created_at<now()-make_interval(days=>p.retention_days))
      when 'consultation_reviews' then (select count(*) from public.consultation_reviews where created_at<now()-make_interval(days=>p.retention_days))
      when 'email_delivery_events' then (select count(*) from public.email_delivery_events where received_at<now()-make_interval(days=>p.retention_days))
      when 'audit_logs' then (select count(*) from public.audit_logs where created_at<now()-make_interval(days=>p.retention_days))
      when 'presence_metadata' then (select count(*) from public.profiles where last_seen_at<now()-make_interval(days=>p.retention_days))
      else 0 end;
    return next;
  end loop;
end $$;
revoke all on function public.retention_preview() from public,anon;
grant execute on function public.retention_preview() to authenticated;

create policy "admins read delivery events" on public.email_delivery_events
for select to authenticated using (public.current_role()='admin');
grant select on public.email_delivery_events to authenticated;
grant select,update on public.retention_policies to authenticated;
grant select (id,full_name,email,role,department,email_notifications,student_number,college,program,year_level,last_seen_at,created_at,account_status,status_reason,status_changed_at,status_changed_by) on public.profiles to authenticated;
grant select,insert,update,delete on public.faq_entries to authenticated;

-- Enforce account state and the privileged AAL2 requirement inside every
-- security-definer workflow, not only in RLS and the browser gate.
create or replace function public.admin_set_user_role(target_user uuid,new_role public.user_role)
returns void language plpgsql security definer set search_path=public as $$
declare previous_role public.user_role;
begin
  if public.current_role() is distinct from 'admin'::public.user_role then raise exception 'Administrator access required'; end if;
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
  target_availability uuid,consultation_topic text,consultation_notes text default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare selected_slot availability%rowtype; created_id uuid;
begin
  if public.current_role() is distinct from 'student'::public.user_role then raise exception 'Student access required'; end if;
  if length(trim(consultation_topic))<5 then raise exception 'Consultation topic is too short'; end if;
  select * into selected_slot from availability where id=target_availability for update;
  if not found or not selected_slot.is_open then raise exception 'This consultation slot is no longer available'; end if;
  if selected_slot.starts_at<now()+interval '24 hours' then raise exception 'Appointments require at least 24 hours notice'; end if;
  insert into appointments(availability_id,student_id,topic,notes)
  values(target_availability,auth.uid(),trim(consultation_topic),nullif(trim(consultation_notes),''))
  returning id into created_id;
  return created_id;
end $$;

create or replace function public.submit_consultation_review(
  target_appointment uuid,review_rating integer,review_comment text default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare review_id uuid; target_faculty uuid; student_year text; student_college text; student_program text;
  cleaned_comment text:=nullif(trim(coalesce(review_comment,'')),'');
begin
  if public.current_role() is distinct from 'student'::public.user_role then raise exception 'Only students may submit consultation reviews'; end if;
  if review_rating not between 1 and 5 then raise exception 'Choose a rating from 1 to 5 stars'; end if;
  if char_length(coalesce(cleaned_comment,''))>1000 then raise exception 'Review comments may contain at most 1000 characters'; end if;
  select av.faculty_id,p.year_level,p.college,p.program
  into target_faculty,student_year,student_college,student_program
  from appointments ap join availability av on av.id=ap.availability_id join profiles p on p.id=ap.student_id
  where ap.id=target_appointment and ap.student_id=auth.uid() and ap.status='completed';
  if not found then raise exception 'Only your completed consultations may be reviewed'; end if;
  insert into consultation_reviews(appointment_id,student_id,faculty_id,rating,comment,year_level,college,program)
  values(target_appointment,auth.uid(),target_faculty,review_rating,cleaned_comment,student_year,student_college,student_program)
  on conflict(appointment_id) do update set rating=excluded.rating,comment=excluded.comment,
    year_level=excluded.year_level,college=excluded.college,program=excluded.program,updated_at=now()
  returning id into review_id;
  return review_id;
end $$;

create or replace function public.cancel_consultation(target_appointment uuid)
returns void language plpgsql security definer set search_path=public as $$
declare current_status appointment_status; slot_start timestamptz;
begin
  if public.current_role() is distinct from 'student'::public.user_role then raise exception 'Student access required'; end if;
  select ap.status,av.starts_at into current_status,slot_start
  from appointments ap join availability av on av.id=ap.availability_id
  where ap.id=target_appointment and ap.student_id=auth.uid() for update of ap,av;
  if not found then raise exception 'Consultation request not found'; end if;
  if current_status not in ('pending','confirmed') then raise exception 'Only pending or confirmed consultations may be cancelled'; end if;
  if slot_start<=now() then raise exception 'Past consultations cannot be cancelled'; end if;
  update appointments set status='cancelled' where id=target_appointment;
end $$;

create or replace function public.reschedule_consultation(target_appointment uuid,new_availability uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare previous_status appointment_status; previous_availability uuid; previous_topic text;
  previous_notes text; previous_start timestamptz; replacement availability%rowtype; created_id uuid;
begin
  if public.current_role() is distinct from 'student'::public.user_role then raise exception 'Student access required'; end if;
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
returns void language plpgsql security definer set search_path=public as $$
declare owner_id uuid; current_status appointment_status; slot_start timestamptz;
begin
  if not coalesce(public.current_role() in ('faculty','admin'),false) then raise exception 'Verified faculty access required'; end if;
  if decision not in ('confirmed','declined') then raise exception 'Invalid consultation decision'; end if;
  select av.faculty_id,ap.status,av.starts_at into owner_id,current_status,slot_start
  from appointments ap join availability av on av.id=ap.availability_id
  where ap.id=target_appointment for update of ap,av;
  if not found then raise exception 'Consultation request not found'; end if;
  if auth.uid()<>owner_id and public.current_role() is distinct from 'admin'::public.user_role then raise exception 'Faculty access required'; end if;
  if current_status<>'pending' then raise exception 'Only pending requests may be decided'; end if;
  if slot_start<=now() then raise exception 'This consultation time has already passed'; end if;
  update appointments set status=decision::appointment_status where id=target_appointment;
end $$;

create or replace function public.complete_consultation(target_appointment uuid)
returns void language plpgsql security definer set search_path=public as $$
declare owner_id uuid; current_status appointment_status; slot_end timestamptz;
begin
  if not coalesce(public.current_role() in ('faculty','admin'),false) then raise exception 'Verified faculty access required'; end if;
  select av.faculty_id,ap.status,av.ends_at into owner_id,current_status,slot_end
  from appointments ap join availability av on av.id=ap.availability_id
  where ap.id=target_appointment for update of ap,av;
  if not found then raise exception 'Consultation request not found'; end if;
  if auth.uid()<>owner_id and public.current_role() is distinct from 'admin'::public.user_role then raise exception 'Faculty access required'; end if;
  if current_status<>'confirmed' then raise exception 'Only confirmed consultations may be completed'; end if;
  if slot_end>now() then raise exception 'The consultation has not ended yet'; end if;
  update appointments set status='completed' where id=target_appointment;
end $$;

create or replace function public.withdraw_availability(target_availability uuid)
returns void language plpgsql security definer set search_path=public as $$
declare owner_id uuid;
begin
  if not coalesce(public.current_role() in ('faculty','admin'),false) then raise exception 'Verified faculty access required'; end if;
  select faculty_id into owner_id from availability where id=target_availability for update;
  if not found then raise exception 'Availability entry not found'; end if;
  if auth.uid()<>owner_id and public.current_role() is distinct from 'admin'::public.user_role then raise exception 'Faculty access required'; end if;
  if exists(select 1 from appointments where availability_id=target_availability and status in ('pending','confirmed')) then
    raise exception 'Availability with an active request cannot be withdrawn';
  end if;
  update availability set is_open=false where id=target_availability;
end $$;

commit;
