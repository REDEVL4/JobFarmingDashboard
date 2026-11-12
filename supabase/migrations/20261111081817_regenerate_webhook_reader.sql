create or replace function public.jf_regenerate_webhook_config()
returns table(webhook_url text, webhook_key text)
language sql
security definer
set search_path = vault, public
as $$
  select
    (select decrypted_secret from vault.decrypted_secrets where name = 'jf_regenerate_webhook_url' limit 1),
    (select decrypted_secret from vault.decrypted_secrets where name = 'jf_regenerate_webhook_key' limit 1);
$$;

revoke all on function public.jf_regenerate_webhook_config() from public, anon, authenticated;
grant execute on function public.jf_regenerate_webhook_config() to service_role;
