-- The delivery-events RLS policy already restricts reads to administrators.
-- Restore the missing Data API table grant so the authenticated admin client
-- can evaluate that policy and load delivery evidence.
begin;

grant select on public.email_delivery_events to authenticated;

commit;
