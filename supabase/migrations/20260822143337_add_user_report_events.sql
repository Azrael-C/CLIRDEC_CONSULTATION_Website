alter table public.client_error_events
  drop constraint if exists client_error_events_event_type_check;

alter table public.client_error_events
  add constraint client_error_events_event_type_check
  check (
    event_type in (
      'render_error',
      'runtime_error',
      'unhandled_rejection',
      'booking_error',
      'chatbot_error',
      'user_report'
    )
  );

create index if not exists client_error_events_reporter_created_at_idx
  on public.client_error_events (reporter_id, created_at desc);

create or replace function public.record_client_error(
  target_event_type text,
  target_message text,
  target_route text default '/',
  target_release text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  safe_message text;
begin
  if actor_id is null then
    raise exception 'Authentication is required';
  end if;

  if target_event_type not in (
    'render_error',
    'runtime_error',
    'unhandled_rejection',
    'booking_error',
    'chatbot_error',
    'user_report'
  ) then
    raise exception 'Unsupported client event type';
  end if;

  if target_event_type = 'user_report' and (
    select count(*)
    from public.client_error_events
    where reporter_id = actor_id
      and event_type = 'user_report'
      and created_at >= now() - interval '10 minutes'
  ) >= 5 then
    raise exception 'Too many reports. Please wait a few minutes before trying again.';
  end if;

  if (
    select count(*)
    from public.client_error_events
    where reporter_id = actor_id
      and created_at >= now() - interval '10 minutes'
  ) >= 20 then
    raise exception 'Too many client events. Please wait before trying again.';
  end if;

  safe_message := left(
    regexp_replace(
      regexp_replace(
        coalesce(nullif(trim(target_message), ''), 'Client event without a safe message'),
        '[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}',
        '[email removed]',
        'g'
      ),
      '\m[0-9]{7,}\M',
      '[identifier removed]',
      'g'
    ),
    500
  );

  insert into public.client_error_events (
    reporter_id,
    event_type,
    message,
    route,
    release
  )
  values (
    actor_id,
    target_event_type,
    safe_message,
    left(coalesce(nullif(target_route, ''), '/'), 200),
    left(nullif(target_release, ''), 100)
  );
end;
$$;

revoke all on function public.record_client_error(text, text, text, text) from public;
revoke all on function public.record_client_error(text, text, text, text) from anon;
grant execute on function public.record_client_error(text, text, text, text) to authenticated;
