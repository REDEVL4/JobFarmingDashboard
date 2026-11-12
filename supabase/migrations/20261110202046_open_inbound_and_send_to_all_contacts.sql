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
begin
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

  draft := coalesce(nullif(trim(p_draft_text), ''), 'Thanks for the note. I will follow up shortly.');

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

  return jsonb_build_object('ok', true, 'duplicate', false, 'interaction_id', interaction_id, 'proposal_id', proposal_id);
end;
$$;

create or replace function jobbot.outreach_auto_send_on_insert()
returns trigger
language plpgsql
security definer
set search_path = jobbot, public, vault, net
as $$
declare
  mode text;
  invoke_token text;
begin
  if new.state is distinct from 'pending_approval' then
    return new;
  end if;
  if coalesce(new.channel, '') <> 'linkedin' then
    return new;
  end if;
  if coalesce(new.action_type, '') in ('connection_request', 'resume_share') then
    return new;
  end if;
  if exists (
    select 1 from jobbot.outreach_contacts c
    where c.id = new.contact_id and coalesce(c.do_not_contact, false)
  ) then
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
