-- Keep availability publishing and structured student profiles least-privileged.
begin;

revoke all on public.availability from anon;
revoke update,delete on public.availability from authenticated;
grant select,insert on public.availability to authenticated;

revoke select on public.profiles from anon,authenticated;
grant select (
  id,
  full_name,
  role,
  department,
  email_notifications,
  student_number,
  college,
  program,
  year_level
) on public.profiles to authenticated;

revoke update on public.profiles from authenticated;
grant update (
  full_name,
  department,
  email_notifications,
  college,
  program,
  year_level
) on public.profiles to authenticated;

commit;
