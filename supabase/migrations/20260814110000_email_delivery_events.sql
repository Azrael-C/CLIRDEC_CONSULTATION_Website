-- Canonical email delivery evidence schema.
-- This migration must run before operations_hardening and the Resend event-type
-- migrations because those migrations create policies and retention previews
-- against public.email_delivery_events.
begin;

alter table public.email_notifications
  add column if not exists provider_email_id text,
  add column if not exists provider_status text,
  add column if not exists provider_status_at timestamptz;

create unique index if not exists email_notifications_provider_email_id
  on public.email_notifications(provider_email_id)
  where provider_email_id is not null;

create table if not exists public.email_delivery_events (
  webhook_id text primary key,
  provider_email_id text not null,
  event_type text not null check (event_type in (
    'email.sent','email.delivered','email.delivery_delayed',
    'email.bounced','email.complained','email.failed','email.suppressed'
  )),
  event_created_at timestamptz not null,
  recipient_addresses text[] not null default '{}',
  subject text,
  details jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now()
);

create index if not exists email_delivery_events_provider_email_id_idx
  on public.email_delivery_events(provider_email_id, received_at desc);
create index if not exists email_delivery_events_received_at_idx
  on public.email_delivery_events(received_at desc);

alter table public.email_delivery_events enable row level security;
revoke all on public.email_delivery_events from public,anon,authenticated;
grant select,insert on public.email_delivery_events to service_role;

commit;
