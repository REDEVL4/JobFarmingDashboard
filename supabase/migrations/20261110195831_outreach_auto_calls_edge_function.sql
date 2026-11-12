create or replace function jobbot.monitor_token_matches(p_token text)
returns boolean
language sql
security definer
set search_path = vault, public
as $$
  select p_token is not null
     and p_token = (
       select decrypted_secret
       from vault.decrypted_secrets
       where name = 'jf_monitor_invoke_token'
       limit 1
     );
$$;

revoke all on function jobbot.monitor_token_matches(text) from public;
grant execute on function jobbot.monitor_token_matches(text) to service_role;

create or replace function jobbot.outreach_auto_send_on_insert()
returns trigger
language plpgsql
security definer
set search_path = jobbot, public, vault, net
as $$
declare
  mode text;
  invoke_token text;
  test_contact uuid := '9388f356-9a7d-49ad-a0af-2779cee29ec6';
begin
  if new.state is distinct from 'pending_approval' then
    return new;
  end if;
  if coalesce(new.channel, '') <> 'linkedin' then
    return new;
  end if;
  if coalesce(new.action_type, '') = 'connection_request' then
    return new;
  end if;
  if new.contact_id is distinct from test_contact then
    return new;
  end if;

  select outreach_mode into mode
  from jobbot.outreach_settings
  where owner_id = new.owner_id;

  if coalesce(mode, 'review') <> 'auto' then
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

update jobbot.outreach_proposals
set state = 'failed'
where id = 'f882ef5a-a27f-418c-bd09-e7e04956487d'
  and state = 'approved_for_send'
  and sent_at is null;
