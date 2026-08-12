begin;

-- Students may self-register using a verified Gmail or CLSU student address.
-- Public signup always creates the student role; faculty and administrator
-- roles continue to require an audited MISO role assignment.
create or replace function public.create_profile()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
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

revoke all on function public.create_profile() from public,anon,authenticated;

commit;
