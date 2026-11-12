create or replace function public.jf_record_inbound_reply(
  p_contact_id uuid,
  p_inbound_text text,
  p_external_key text,
  p_observed_at timestamptz default now(),
  p_inbound_event_id uuid default null,
  p_draft_text text default null
)
returns jsonb
language sql
security definer
set search_path = jobbot, public
as $$
  select jobbot.record_inbound_reply(
    p_contact_id, p_inbound_text, p_external_key,
    p_observed_at, p_inbound_event_id, p_draft_text
  );
$$;

revoke all on function public.jf_record_inbound_reply(uuid, text, text, timestamptz, uuid, text) from public;
grant execute on function public.jf_record_inbound_reply(uuid, text, text, timestamptz, uuid, text) to service_role;
