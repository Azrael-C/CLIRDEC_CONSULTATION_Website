-- Rich faculty discovery, onboarding state, and privacy-conscious chatbot gaps.
begin;

alter table public.faculty_profiles
  add column if not exists subjects text[] not null default '{}',
  add column if not exists consultation_topics text[] not null default '{}',
  add column if not exists research_interests text[] not null default '{}',
  add column if not exists office_location text,
  add column if not exists profile_completed_at timestamptz;

alter table public.faculty_profiles
  drop constraint if exists faculty_profile_list_limits;
alter table public.faculty_profiles
  add constraint faculty_profile_list_limits check (
    cardinality(expertise) <= 12
    and cardinality(subjects) <= 20
    and cardinality(consultation_topics) <= 20
    and cardinality(research_interests) <= 12
  );

comment on column public.faculty_profiles.subjects is
  'Verified course or subject names used for student and chatbot faculty matching.';
comment on column public.faculty_profiles.consultation_topics is
  'Specific consultation concerns the faculty member accepts.';
comment on column public.faculty_profiles.profile_completed_at is
  'Set after the faculty member completes the required discovery profile.';

drop function if exists public.faculty_directory(uuid[]);
create function public.faculty_directory(target_ids uuid[] default null)
returns table(
  id uuid,
  full_name text,
  department text,
  expertise text[],
  subjects text[],
  consultation_topics text[],
  research_interests text[],
  bio text,
  office_location text,
  profile_completed boolean
)
language sql
stable
security definer
set search_path=public
as $$
  select
    p.id,
    p.full_name,
    p.department,
    fp.expertise,
    fp.subjects,
    fp.consultation_topics,
    fp.research_interests,
    coalesce(fp.bio,''),
    coalesce(fp.office_location,''),
    fp.profile_completed_at is not null
  from profiles p
  join faculty_profiles fp on fp.user_id=p.id
  where p.role='faculty'
    and fp.active
    and (target_ids is null or p.id=any(target_ids))
  order by p.full_name
$$;
revoke all on function public.faculty_directory(uuid[]) from public,anon;
grant execute on function public.faculty_directory(uuid[]) to authenticated;

revoke update on public.faculty_profiles from authenticated;
grant update (
  expertise,bio,subjects,consultation_topics,research_interests,
  office_location,profile_completed_at
) on public.faculty_profiles to authenticated;

create table if not exists public.chatbot_unanswered_questions (
  id uuid primary key default gen_random_uuid(),
  normalized_question text not null unique,
  sample_question text not null,
  detected_intent text not null default 'fallback',
  confidence numeric(4,3) not null default 0,
  occurrence_count integer not null default 1 check (occurrence_count > 0),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id),
  resolution_note text
);
alter table public.chatbot_unanswered_questions enable row level security;

drop policy if exists "admins review chatbot gaps" on public.chatbot_unanswered_questions;
create policy "admins review chatbot gaps"
on public.chatbot_unanswered_questions
for select to authenticated
using (public.current_role()='admin');

drop policy if exists "admins resolve chatbot gaps" on public.chatbot_unanswered_questions;
create policy "admins resolve chatbot gaps"
on public.chatbot_unanswered_questions
for update to authenticated
using (public.current_role()='admin')
with check (public.current_role()='admin');

revoke all on public.chatbot_unanswered_questions from anon,authenticated;
grant select,update on public.chatbot_unanswered_questions to authenticated;

create or replace function public.record_chatbot_gap(
  question_text text,
  question_intent text default 'fallback',
  question_confidence numeric default 0
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  normalized text := lower(regexp_replace(trim(question_text), '\s+', ' ', 'g'));
begin
  if length(normalized) < 3 or length(normalized) > 500 then
    return;
  end if;
  insert into public.chatbot_unanswered_questions (
    normalized_question,sample_question,detected_intent,confidence
  ) values (
    normalized,left(trim(question_text),500),left(coalesce(question_intent,'fallback'),100),
    greatest(0,least(1,coalesce(question_confidence,0)))
  )
  on conflict (normalized_question) do update set
    sample_question=excluded.sample_question,
    detected_intent=excluded.detected_intent,
    confidence=excluded.confidence,
    occurrence_count=public.chatbot_unanswered_questions.occurrence_count+1,
    last_seen_at=now(),
    resolved_at=null,
    resolved_by=null,
    resolution_note=null;
end
$$;
revoke all on function public.record_chatbot_gap(text,text,numeric) from public,anon,authenticated;
grant execute on function public.record_chatbot_gap(text,text,numeric) to service_role;

commit;
