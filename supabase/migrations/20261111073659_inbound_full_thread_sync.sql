create or replace function public.jf_list_inbound_for_contact(p_contact_id uuid)
returns table(message_summary text, event_at timestamptz, external_key text)
language sql
security definer
set search_path = jobbot, public
as $$
  select message_summary, event_at, external_key
  from jobbot.outreach_interactions
  where contact_id = p_contact_id
    and direction = 'inbound'
  order by event_at;
$$;

revoke all on function public.jf_list_inbound_for_contact(uuid) from public;
grant execute on function public.jf_list_inbound_for_contact(uuid) to service_role, anon, authenticated;

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
  interaction_id uuid;
  proposal_id uuid;
  draft text;
  contact record;
  norm text;
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', owner::text, 'role', 'authenticated')::text,
    true
  );

  if nullif(trim(p_inbound_text), '') is null or nullif(trim(p_external_key), '') is null then
    return jsonb_build_object('ok', false, 'error', 'text_and_key_required');
  end if;

  select full_name, professional_title, company, linkedin_url, do_not_contact
    into contact
  from jobbot.outreach_contacts
  where id = p_contact_id and owner_id = owner;

  if contact.full_name is null then
    return jsonb_build_object('ok', false, 'error', 'contact_not_found');
  end if;
  if coalesce(contact.do_not_contact, false) then
    return jsonb_build_object('ok', false, 'error', 'do_not_contact');
  end if;

  norm := left(regexp_replace(lower(trim(p_inbound_text)), '\s+', ' ', 'g'), 200);

  if exists (
    select 1 from jobbot.outreach_interactions
    where contact_id = p_contact_id
      and direction = 'inbound'
      and (
        external_key = p_external_key
        or left(regexp_replace(lower(trim(message_summary)), '\s+', ' ', 'g'), 200) = norm
      )
  ) then
    select id into interaction_id
    from jobbot.outreach_interactions
    where contact_id = p_contact_id
      and direction = 'inbound'
      and (
        external_key = p_external_key
        or left(regexp_replace(lower(trim(message_summary)), '\s+', ' ', 'g'), 200) = norm
      )
    order by event_at desc
    limit 1;
    return jsonb_build_object('ok', true, 'duplicate', true, 'interaction_id', interaction_id);
  end if;

  insert into jobbot.outreach_interactions (
    owner_id, contact_id, event_type, channel, direction,
    message_summary, event_at, verification, evidence_source, external_key
  ) values (
    owner, p_contact_id, 'message_received', 'linkedin', 'inbound',
    left(trim(p_inbound_text), 2000), coalesce(p_observed_at, now()),
    'reported', 'linkedin_thread', p_external_key
  )
  returning id into interaction_id;

  draft := nullif(trim(p_draft_text), '');

  if draft is not null then
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
  end if;

  update jobbot.outreach_contacts
  set connection_stage = 'replied',
      last_interaction_at = greatest(coalesce(last_interaction_at, p_observed_at), coalesce(p_observed_at, now())),
      updated_at = now()
  where id = p_contact_id;

  return jsonb_build_object('ok', true, 'duplicate', false, 'interaction_id', interaction_id, 'proposal_id', proposal_id);
end;
$$;
