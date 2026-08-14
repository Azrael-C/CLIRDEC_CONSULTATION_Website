-- Phase two: apply only after the PrivilegedMfaGate frontend is deployed.
begin;

create or replace function public.current_role()
returns public.user_role
language sql stable security definer set search_path=public
as $$
  select case
    when account_status<>'active' then null
    when role in ('faculty','admin') and coalesce(auth.jwt()->>'aal','aal1')<>'aal2' then null
    else role
  end
  from profiles where id=auth.uid()
$$;

revoke all on function public.current_role() from public,anon;
grant execute on function public.current_role() to authenticated;

commit;
