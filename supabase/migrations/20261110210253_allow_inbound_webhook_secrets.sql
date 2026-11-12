create or replace function jobbot.monitor_get_secret(p_name text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v text;
begin
  if p_name not in (
    'jf_monitor_invoke_token',
    'jf_gmail_client_id',
    'jf_gmail_client_secret',
    'jf_gmail_refresh_token',
    'jf_grok_webhook_url',
    'jf_grok_webhook_key',
    'jf_grok_webhook_header',
    'jf_enable_gmail_queue_ingestion',
    'jf_enable_gmail_status_writes',
    'jf_linkedin_inbound_webhook_url',
    'jf_linkedin_inbound_webhook_key'
  ) then
    raise exception 'Secret not allowed';
  end if;
  select decrypted_secret into v from vault.decrypted_secrets where name = p_name limit 1;
  return v;
end;
$$;
