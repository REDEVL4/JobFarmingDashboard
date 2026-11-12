alter table jobbot.outreach_settings
  add column if not exists auto_connection_requests boolean not null default false;

create or replace function public.jf_set_auto_connection_requests(p_enabled boolean)
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
  insert into jobbot.outreach_settings (owner_id, outreach_mode, auto_connection_requests)
  values (owner, 'review', coalesce(p_enabled, false))
  on conflict (owner_id) do update
    set auto_connection_requests = excluded.auto_connection_requests,
        updated_at = now();
  return jsonb_build_object('ok', true, 'auto_connection_requests', coalesce(p_enabled, false));
end;
$$;

revoke all on function public.jf_set_auto_connection_requests(boolean) from public;
grant execute on function public.jf_set_auto_connection_requests(boolean) to authenticated;

create or replace function jobbot.outreach_auto_send_on_insert()
returns trigger
language plpgsql
security definer
set search_path = jobbot, public, vault, net
as $$
declare
  mode text;
  auto_conn boolean := false;
  invoke_token text;
  action text := coalesce(new.action_type, '');
begin
  if new.state is distinct from 'pending_approval' then
    return new;
  end if;
  if coalesce(new.channel, '') <> 'linkedin' then
    return new;
  end if;
  if action = 'resume_share' then
    return new;
  end if;
  if exists (
    select 1 from jobbot.outreach_contacts c
    where c.id = new.contact_id and coalesce(c.do_not_contact, false)
  ) then
    return new;
  end if;

  select outreach_mode, coalesce(auto_connection_requests, false)
    into mode, auto_conn
  from jobbot.outreach_settings
  where owner_id = new.owner_id;

  if coalesce(mode, 'review') <> 'auto' then
    return new;
  end if;

  if action = 'connection_request' and not auto_conn then
    return new;
  end if;

  new.state := 'approved_for_send';
  new.approved_text := coalesce(new.approved_text, new.proposed_text);
  new.approved_at := now();

  select decrypted_secret into invoke_token
  from vault.decrypted_secrets
  where name = 'jf_monitor_invoke_token'
  limit 1;

  if invoke_token is not null then
    perform net.http_post(
      url := 'https://mldtysploensrrulchdl.supabase.co/functions/v1/outreach-send-trigger',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-jf-monitor-token', invoke_token
      ),
      body := jsonb_build_object('proposal_id', new.id)
    );
  end if;

  return new;
end;
$$;
