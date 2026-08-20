-- rls_auto_enable is an internal event-trigger helper. It must never be a
-- client-callable RPC, even though the trigger itself continues to execute as
-- its owner when a table is created.
revoke all on function public.rls_auto_enable() from public, anon, authenticated;

comment on function public.rls_auto_enable() is
  'Internal DDL event-trigger helper; deliberately not exposed through the Data API.';
