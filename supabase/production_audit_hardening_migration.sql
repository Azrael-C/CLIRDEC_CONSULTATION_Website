-- Least-privilege grants and routine production maintenance.
begin;

-- Expired slots should never remain visible as open operational records.
update public.availability
set is_open=false
where is_open and ends_at<=now();

-- Remove Supabase's broad default browser grants from current app tables.
revoke all on table public.profiles from anon,authenticated;
revoke all on table public.faculty_profiles from anon,authenticated;
revoke all on table public.availability from anon,authenticated;
revoke all on table public.appointments from anon,authenticated;
revoke all on table public.email_notifications from anon,authenticated;
revoke all on table public.faq_entries from anon,authenticated;
revoke all on table public.audit_logs from anon,authenticated;
revoke all on table public.registration_allowlist from anon,authenticated;
revoke all on table public.consultation_reviews from anon,authenticated;

grant select (
  id,full_name,role,department,email_notifications,
  student_number,college,program,year_level
) on public.profiles to authenticated;
grant update (
  full_name,department,email_notifications,college,program,year_level
) on public.profiles to authenticated;
grant select on public.faculty_profiles to authenticated;
grant update (expertise,bio) on public.faculty_profiles to authenticated;
grant select,insert on public.availability to authenticated;
grant select on public.appointments to authenticated;
grant select on public.email_notifications to authenticated;
grant select,insert,update,delete on public.faq_entries to authenticated;
grant select on public.audit_logs to authenticated;
grant select,insert,update,delete on public.registration_allowlist to authenticated;
grant select on public.consultation_reviews to authenticated;

revoke all on function public.current_role() from public,anon;
grant execute on function public.current_role() to authenticated;
revoke all on function public.set_appointment_updated_at() from public,anon,authenticated;
revoke all on function public.validate_availability_schedule() from public,anon,authenticated;
revoke all on function public.close_slot_after_booking() from public,anon,authenticated;
revoke all on function public.create_profile() from public,anon,authenticated;
revoke all on function public.queue_appointment_email() from public,anon,authenticated;
revoke all on function public.reopen_slot_after_inactive_appointment() from public,anon,authenticated;
revoke all on function public.audit_faq_change() from public,anon,authenticated;

commit;
