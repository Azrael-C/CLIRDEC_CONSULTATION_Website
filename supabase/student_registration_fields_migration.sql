begin;

alter table public.profiles
  add column if not exists student_number text,
  add column if not exists college text,
  add column if not exists program text,
  add column if not exists year_level text;

create unique index if not exists profiles_student_number_unique
on public.profiles (upper(student_number))
where student_number is not null;

alter table public.profiles
  drop constraint if exists profiles_year_level_check;

alter table public.profiles
  add constraint profiles_year_level_check check (
    year_level is null or year_level in (
      '1st year','2nd year','3rd year','4th year',
      '5th year or higher','Graduate student'
    )
  );

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

  update registration_allowlist set active=false where email=normalized_email;
  return new;
end $$;

commit;
