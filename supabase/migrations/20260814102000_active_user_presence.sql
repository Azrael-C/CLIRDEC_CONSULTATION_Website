-- Records a coarse portal heartbeat for the administrator activity monitor.
-- Existing profile RLS permits each authenticated user to update only their
-- own row while administrators may read activity through can_read_profile().
alter table public.profiles
  add column if not exists last_seen_at timestamptz;

create index if not exists profiles_last_seen_at_idx
  on public.profiles (last_seen_at desc)
  where last_seen_at is not null;

comment on column public.profiles.last_seen_at is
  'Most recent authenticated portal heartbeat; used for coarse active-user status.';

grant update (last_seen_at) on public.profiles to authenticated;
grant select (email,last_seen_at,created_at) on public.profiles to authenticated;
