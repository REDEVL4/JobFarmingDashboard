create or replace function public.jf_monitor_token_matches(p_token text)
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

revoke all on function public.jf_monitor_token_matches(text) from public;
grant execute on function public.jf_monitor_token_matches(text) to service_role;
