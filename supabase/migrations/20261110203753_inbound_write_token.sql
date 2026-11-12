select vault.create_secret(
  encode(extensions.gen_random_bytes(32), 'hex'),
  'jf_inbound_write_token',
  'Token for inbound-message-draft to call outreach-inbound-record'
);

create or replace function public.jf_inbound_token_matches(p_token text)
returns boolean
language sql
security definer
set search_path = vault, public
as $$
  select p_token is not null
     and p_token = (
       select decrypted_secret
       from vault.decrypted_secrets
       where name = 'jf_inbound_write_token'
       limit 1
     );
$$;

revoke all on function public.jf_inbound_token_matches(text) from public;
grant execute on function public.jf_inbound_token_matches(text) to service_role, anon, authenticated;
