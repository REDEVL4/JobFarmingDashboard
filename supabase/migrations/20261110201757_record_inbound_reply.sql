create or replace function jobbot.record_inbound_reply(
  p_contact_id uuid,
  p_inbound_text text,
  p_external_key text,
  p_observed_at timestamptz default now(),
  p_inbound_event_id uuid default null,
  p_draft_text text default null
)
returns jsonb
language plpgsql
security definer
set search_path = jobbot, public
as $$
declare
  owner uuid := 'f2729195-5445-4272-ab85-cac5b03b0967';
  test_contact uuid := '9388f356-9a7d-49ad-a0af-2779cee29ec6';
  interaction_id uuid;
  proposal_id uuid;
  draft text;
  contact record;
begin
  if p_contact_id is distinct from test_contact then
    return jsonb_build_object('ok', false, 'error', 'test_lock');
  end if;
  if nullif(trim(p_inbound_text), '') is null or nullif(trim(p_external_key), '') is null then
    return jsonb_build_object('ok', false, 'error', 'text_and_key_required');
  end if;

  select full_name, professional_title, company, linkedin_url
    into contact
  from jobbot.outreach_contacts
  where id = p_contact_id;

  if contact.full_name is null then
    return jsonb_build_object('ok', false, 'error', 'contact_not_found');
  end if;

  insert into jobbot.outreach_interactions (
    owner_id, contact_id, event_type, channel, direction,
    message_summary, event_at, verification, evidence_source, external_key
  ) values (
    owner, p_contact_id, 'message_received', 'linkedin', 'inbound',
    left(trim(p_inbound_text), 2000), coalesce(p_observed_at, now()),
    'reported', 'linkedin_thread', p_external_key
  )
  on conflict (owner_id, external_key) do update
    set message_summary = excluded.message_summary
  returning id into interaction_id;

  if exists (
    select 1 from jobbot.outreach_proposals
    where contact_id = p_contact_id
      and action_type = 'reply'
      and state in ('pending_approval', 'approved_for_send', 'sent')
      and signal = p_external_key
  ) then
    select id into proposal_id
    from jobbot.outreach_proposals
    where contact_id = p_contact_id and action_type = 'reply' and signal = p_external_key
    limit 1;
    return jsonb_build_object('ok', true, 'duplicate', true, 'interaction_id', interaction_id, 'proposal_id', proposal_id);
  end if;

  draft := coalesce(
    nullif(trim(p_draft_text), ''),
    'Thanks, got it. I will follow up if anything else comes up.'
  );

  insert into jobbot.outreach_proposals (
    owner_id, contact_id, inbound_event_id, action_type, channel,
    target_name, target_title, target_company, linkedin_url,
    signal, proposed_text, state
  ) values (
    owner, p_contact_id, p_inbound_event_id, 'reply', 'linkedin',
    contact.full_name, contact.professional_title, contact.company, contact.linkedin_url,
    p_external_key, draft, 'pending_approval'
  )
  returning id into proposal_id;

  update jobbot.outreach_contacts
  set connection_stage = 'replied',
      last_interaction_at = coalesce(p_observed_at, now()),
      updated_at = now()
  where id = p_contact_id;

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'interaction_id', interaction_id,
    'proposal_id', proposal_id
  );
end;
$$;

grant execute on function jobbot.record_inbound_reply(uuid, text, text, timestamptz, uuid, text) to service_role;
