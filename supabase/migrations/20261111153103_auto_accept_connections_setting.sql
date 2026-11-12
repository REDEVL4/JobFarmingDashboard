alter table jobbot.outreach_settings
  add column if not exists auto_accept_connections boolean not null default false;

create or replace function public.jf_set_auto_accept_connections(p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = jobbot, public
as $$
declare
  owner uuid := auth.uid();
begin
  if owner is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  insert into jobbot.outreach_settings (owner_id, outreach_mode, auto_accept_connections)
  values (owner, 'review', coalesce(p_enabled, false))
  on conflict (owner_id) do update
    set auto_accept_connections = excluded.auto_accept_connections,
        updated_at = now();
  return jsonb_build_object('ok', true, 'auto_accept_connections', coalesce(p_enabled, false));
end;
$$;

revoke all on function public.jf_set_auto_accept_connections(boolean) from public;
grant execute on function public.jf_set_auto_accept_connections(boolean) to authenticated;

drop function if exists public.jf_outreach_settings();

create function public.jf_outreach_settings()
returns table(outreach_mode text, auto_connection_requests boolean, auto_accept_connections boolean)
language sql
security definer
set search_path = jobbot, public
as $$
  select s.outreach_mode,
         coalesce(s.auto_connection_requests, false),
         coalesce(s.auto_accept_connections, false)
  from jobbot.outreach_settings s
  where s.owner_id = auth.uid();
$$;

revoke all on function public.jf_outreach_settings() from public;
grant execute on function public.jf_outreach_settings() to authenticated;
