-- Follow-up for projects where the presence column migration was applied
-- before column-level profile privileges were added.
grant update (last_seen_at) on public.profiles to authenticated;
grant select (email,last_seen_at,created_at) on public.profiles to authenticated;
