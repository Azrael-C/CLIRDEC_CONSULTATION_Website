begin;

alter table public.email_delivery_events
  drop constraint if exists email_delivery_events_event_type_check;

alter table public.email_delivery_events
  add constraint email_delivery_events_event_type_check
  check (event_type in (
    'email.sent',
    'email.delivered',
    'email.delivery_delayed',
    'email.bounced',
    'email.complained',
    'email.failed',
    'email.suppressed'
  ));

commit;
