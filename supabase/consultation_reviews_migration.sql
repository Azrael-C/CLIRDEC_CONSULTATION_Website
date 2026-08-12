-- Post-consultation feedback. Demographic fields are captured as snapshots so
-- service reports remain historically accurate when a student profile changes.
create table if not exists public.consultation_reviews (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null unique references public.appointments(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  faculty_id uuid not null references public.profiles(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text check (comment is null or char_length(comment) <= 1000),
  year_level text,
  college text,
  program text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists consultation_reviews_faculty_idx
  on public.consultation_reviews(faculty_id, created_at desc);
create index if not exists consultation_reviews_demographics_idx
  on public.consultation_reviews(college, program, year_level);

alter table public.consultation_reviews enable row level security;

drop policy if exists "students read own consultation reviews" on public.consultation_reviews;
create policy "students read own consultation reviews"
on public.consultation_reviews for select to authenticated
using (student_id=auth.uid() or public.current_role()='admin');

revoke all on public.consultation_reviews from anon, authenticated;
grant select on public.consultation_reviews to authenticated;

create or replace function public.submit_consultation_review(
  target_appointment uuid,
  review_rating integer,
  review_comment text default null
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  review_id uuid;
  target_faculty uuid;
  student_year text;
  student_college text;
  student_program text;
  cleaned_comment text := nullif(trim(coalesce(review_comment,'')),'');
begin
  if public.current_role()<>'student' then
    raise exception 'Only students may submit consultation reviews';
  end if;
  if review_rating not between 1 and 5 then
    raise exception 'Choose a rating from 1 to 5 stars';
  end if;
  if char_length(coalesce(cleaned_comment,'')) > 1000 then
    raise exception 'Review comments may contain at most 1000 characters';
  end if;

  select av.faculty_id,p.year_level,p.college,p.program
    into target_faculty,student_year,student_college,student_program
  from appointments ap
  join availability av on av.id=ap.availability_id
  join profiles p on p.id=ap.student_id
  where ap.id=target_appointment
    and ap.student_id=auth.uid()
    and ap.status='completed';

  if not found then
    raise exception 'Only your completed consultations may be reviewed';
  end if;

  insert into consultation_reviews(
    appointment_id,student_id,faculty_id,rating,comment,year_level,college,program
  ) values (
    target_appointment,auth.uid(),target_faculty,review_rating,cleaned_comment,
    student_year,student_college,student_program
  )
  on conflict (appointment_id) do update set
    rating=excluded.rating,
    comment=excluded.comment,
    year_level=excluded.year_level,
    college=excluded.college,
    program=excluded.program,
    updated_at=now()
  returning id into review_id;

  return review_id;
end $$;

revoke all on function public.submit_consultation_review(uuid,integer,text) from public,anon;
grant execute on function public.submit_consultation_review(uuid,integer,text) to authenticated;
