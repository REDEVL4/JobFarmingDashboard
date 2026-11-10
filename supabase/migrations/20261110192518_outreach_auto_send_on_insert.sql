create or replace function jobbot.outreach_auto_send_on_insert()
returns trigger
language plpgsql
security definer
set search_path = jobbot, public, vault
as $$
declare
  mode text;
  webhook_url text;
  webhook_key text;
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

  select decrypted_secret into webhook_url
  from vault.decrypted_secrets where name = 'jf_grok_bot_webhook_url' limit 1;
  select decrypted_secret into webhook_key
  from vault.decrypted_secrets where name = 'jf_grok_bot_webhook_key' limit 1;

  if webhook_url is not null and webhook_key is not null then
    perform net.http_post(
      url := webhook_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || webhook_key
      ),
      body := jsonb_build_object(
        'proposal_id', new.id,
        'contact_id', new.contact_id,
        'target_name', new.target_name,
        'linkedin_url', new.linkedin_url,
        'approved_text', new.approved_text
      )
    );
  end if;

  return new;
end;
$$;

drop trigger if exists outreach_auto_send_on_insert on jobbot.outreach_proposals;
create trigger outreach_auto_send_on_insert
before insert on jobbot.outreach_proposals
for each row
execute function jobbot.outreach_auto_send_on_insert();

