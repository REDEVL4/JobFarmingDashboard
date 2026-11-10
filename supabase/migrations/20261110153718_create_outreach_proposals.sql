create table if not exists jobbot.outreach_proposals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default 'f2729195-5445-4272-ab85-cac5b03b0967',
  contact_id uuid references jobbot.outreach_contacts(id),
  inbound_event_id uuid,
  action_type text not null check (action_type in (
    'connection_request', 'message', 'follow_up', 'comment', 'reply', 'resume_share', 'handoff_to_job_bot'
  )),
  channel text not null check (channel in ('gmail', 'linkedin')),
  target_name text,
  target_title text,
  target_company text,
  linkedin_url text,
  email text,
  signal text,
  proposed_text text not null,
  approved_text text,
  state text not null default 'pending_approval' check (state in (
    'pending_approval', 'approved', 'rejected', 'queued', 'sent', 'draft_ready', 'failed'
  )),
  approved_at timestamptz,
  sent_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists outreach_proposals_event_action_uidx
  on jobbot.outreach_proposals (inbound_event_id, action_type)
  where inbound_event_id is not null;

create index if not exists outreach_proposals_state_idx
  on jobbot.outreach_proposals (state, created_at desc);

alter table jobbot.outreach_proposals enable row level security;

comment on table jobbot.outreach_proposals is 'Drafts written by the LinkedIn Bot. Approval is required before any send.';

