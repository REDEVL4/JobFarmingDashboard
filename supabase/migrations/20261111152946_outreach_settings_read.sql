create or replace function public.jf_outreach_settings()
returns table(outreach_mode text, auto_connection_requests boolean)
language sql
security definer
set search_path = jobbot, public
as $$
  select s.outreach_mode, coalesce(s.auto_connection_requests, false)
  from jobbot.outreach_settings s
  where s.owner_id = auth.uid();
$$;

revoke all on function public.jf_outreach_settings() from public;
grant execute on function public.jf_outreach_settings() to authenticated;
