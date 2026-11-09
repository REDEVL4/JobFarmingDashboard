-- =====================================================================
-- Job Farming Phase 5 (A2): incremental LinkedIn communication monitoring
-- Project mldtysploensrrulchdl · schema jobbot
-- Hardened from /workspace/phase5_proposed_migration.sql (2026-11-03 CT)
--
--  * Additive only. No existing table recreated, no existing row changed,
--    no audit/guard trigger touched. Only change to an existing table is two
--    nullable columns on jobbot.outreach_followups (no backfill).
--  * System side (pg_cron / edge function as postgres) writes ONLY monitor_*
--    staging tables through SECURITY DEFINER functions in the unexposed jobbot
--    schema, with EXECUTE revoked from public/anon/authenticated.
--  * Owner side: public.jf_monitor_* RPCs are SECURITY INVOKER (same pattern as
--    public.jf_outreach_create_draft), gated on auth.uid() = owner, and work
--    through RLS + column-level grants. Promotion into outreach_* therefore runs
--    under the owner's JWT and is recorded by the existing audit trigger.
--  * Single scheduler: one fixed pg_cron tick (separate migration). Real cadence
--    = monitor_settings.next_run_at (DB due-gate). Interval changes never touch
--    cron.job, so they cannot create overlapping jobs.
--  * Single flight: partial unique index (one claimed/running run per owner)
--    + lease expiry for crash recovery.
--  * Cursor advances ONLY in jobbot.monitor_complete_run(...,'succeeded') for a
--    non-test run.
--  * Defaults: enabled=false, interval 20 min, fully_active=false.
--  * FREE-PATH revision (2026-11-03 CT): two independent cadences.
--      - Gmail poll (Layer A, zero LLM): fixed every 5 min while enabled
--        (poll_interval_minutes = 5; next_run_at; 30 s slack so a */5 cron
--        tick is never skipped).
--      - AI processing (Layer B, Grok): dashboard interval 20/30/60 min
--        (interval_minutes / interval_preset, unchanged RPC
--        jf_monitor_set_interval). Grok is woken ONLY by a webhook POST from
--        the edge function when ai_dispatch_enabled AND >=1 pending AI task
--        AND the AI interval has elapsed. No pending work = no Grok call.
--      - Activation gate: jf_monitor_set_enabled(true) refuses until a Gmail
--        source check (test run: OAuth token + Gmail list, no ingest) passed.
-- =====================================================================

-- 1. Settings ----------------------------------------------------------
create table if not exists jobbot.monitor_settings (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null unique
                        check (owner_id = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid),
  enabled               boolean not null default false,
  paused                boolean not null default false,
  interval_minutes      integer not null default 20
                        check (interval_minutes between 10 and 1440 and interval_minutes % 5 = 0),
  interval_preset       text not null default '20'
                        check (interval_preset in ('20','30','60','custom')),
  tick_granularity_min  integer not null default 5,
  poll_interval_minutes integer not null default 5 check (poll_interval_minutes = 5),
  next_run_at           timestamptz,            -- next Gmail poll (Layer A)
  source_check_requested_at timestamptz,        -- owner asked for a Gmail source check
  ai_dispatch_enabled   boolean not null default false,
  ai_next_dispatch_at   timestamptz,            -- next allowed Grok wake (Layer B)
  last_ai_dispatch_at   timestamptz,
  last_ai_dispatch_count integer,
  last_ai_dispatch_result text,
  run_now_requested_at  timestamptz,
  last_attempt_at       timestamptz,
  last_success_at       timestamptz,
  status                text not null default 'not_configured'
                        check (status in ('not_configured','idle','running','paused',
                                          'disabled','source_unavailable','error')),
  status_detail         text,
  fully_active          boolean not null default false,
  fully_active_evidence text,
  updated_at            timestamptz not null default now(),
  updated_by            uuid,
  check (not fully_active or nullif(trim(fully_active_evidence),'') is not null)
);

-- 2. Sources -----------------------------------------------------------
create table if not exists jobbot.monitor_sources (
  source_key          text primary key
                      check (source_key in ('gmail_linkedin_notifications','manual_import',
                                            'linkedin_official_messaging')),
  owner_id            uuid not null
                      check (owner_id = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid),
  display_name        text not null,
  adapter             text not null,
  capabilities        jsonb not null default '{}'::jsonb,
  limitations         text not null,
  connection_status   text not null default 'not_configured'
                      check (connection_status in ('connected','needs_auth','not_configured',
                                                   'unavailable','error')),
  verification_status text not null default 'unverified'
                      check (verification_status in ('unverified','verified','failed')),
  last_verified_at    timestamptz,
  verification_ref    text,
  updated_at          timestamptz not null default now()
);

-- 3. Cursors -----------------------------------------------------------
create table if not exists jobbot.sync_cursors (
  owner_id               uuid not null
                         check (owner_id = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid),
  source_key             text not null references jobbot.monitor_sources(source_key),
  last_success_at        timestamptz,
  last_observed_at       timestamptz,
  last_external_id       text,
  last_history_id        text,
  overlap_minutes        integer not null default 120 check (overlap_minutes between 0 and 1440),
  initial_lookback_hours integer not null default 24 check (initial_lookback_hours between 1 and 720),
  consecutive_failures   integer not null default 0,
  last_error             text,
  updated_at             timestamptz not null default now(),
  primary key (owner_id, source_key)
);

-- 4. Runs (history + single-flight lock) -------------------------------
create table if not exists jobbot.monitor_runs (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null
                     check (owner_id = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid),
  trigger            text not null check (trigger in ('scheduled','run_now','test')),
  is_test            boolean not null default false,
  status             text not null default 'claimed'
                     check (status in ('claimed','succeeded','failed','source_unavailable','expired')),
  source_key         text not null references jobbot.monitor_sources(source_key),
  claimed_at         timestamptz not null default now(),
  lease_expires_at   timestamptz not null default now() + interval '10 minutes',
  finished_at        timestamptz,
  cursor_before      jsonb,
  cursor_after       jsonb,
  events_seen        integer not null default 0,
  events_new         integer not null default 0,
  events_duplicate   integer not null default 0,
  needs_context      integer not null default 0,
  ai_tasks_created   integer not null default 0,
  drafts_created     integer not null default 0,
  ai_invoked         boolean not null default false,
  errors             jsonb not null default '[]'::jsonb,
  check (trigger <> 'test' or is_test)
);
create unique index if not exists monitor_runs_single_active
  on jobbot.monitor_runs(owner_id) where status = 'claimed';
create index if not exists monitor_runs_recent on jobbot.monitor_runs(owner_id, claimed_at desc);

-- 5. Conversations -----------------------------------------------------
create table if not exists jobbot.monitor_conversations (
  id                         uuid primary key default gen_random_uuid(),
  owner_id                   uuid not null
                             check (owner_id = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid),
  source_key                 text not null references jobbot.monitor_sources(source_key),
  external_thread_id         text not null,
  contact_id                 uuid references jobbot.outreach_contacts(id),
  contact_match              text not null default 'none'
                             check (contact_match in ('none','owner_selected','exact_profile_url','exact_name',
                                                      'name_only_needs_review','new_contact_proposed')),
  counterpart_name           text,
  counterpart_profile_url    text,
  last_message_at            timestamptz,
  last_processed_message_id  text,
  compact_context            text check (length(compact_context) <= 2000),
  state                      text not null default 'open'
                             check (state in ('open','awaiting_context','awaiting_ai',
                                              'awaiting_approval','closed')),
  is_test                    boolean not null default false,
  updated_at                 timestamptz not null default now(),
  unique (owner_id, source_key, external_thread_id)
);
create index if not exists monitor_conversations_contact on jobbot.monitor_conversations(contact_id);

-- 6. Inbound events ----------------------------------------------------
create table if not exists jobbot.monitor_inbound_events (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null
                        check (owner_id = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid),
  source_key            text not null references jobbot.monitor_sources(source_key),
  external_message_id   text not null,
  external_thread_id    text,
  fingerprint           text not null,
  conversation_id       uuid references jobbot.monitor_conversations(id),
  run_id                uuid references jobbot.monitor_runs(id),
  event_kind            text not null
                        check (event_kind in ('message_notification','message_digest',
                                              'connection_accepted','invitation_received',
                                              'inmail_notification','message_imported','other')),
  sender_name           text check (length(sender_name) <= 240),
  sender_profile_url    text,
  contact_id            uuid references jobbot.outreach_contacts(id),
  contact_match         text not null default 'none'
                        check (contact_match in ('none','owner_selected','exact_profile_url','exact_name',
                                                 'name_only_needs_review','new_contact_proposed')),
  observed_at           timestamptz not null,
  full_text_available   boolean not null default false,
  preview_excerpt       text check (length(preview_excerpt) <= 280),
  imported_text         text check (length(imported_text) <= 8000),
  processing_state      text not null default 'new'
                        check (processing_state in ('new','matched','needs_message_context',
                                                    'needs_ai','ready_for_promotion','promoted',
                                                    'ignored','error')),
  classification        jsonb,
  promoted_interaction_id uuid references jobbot.outreach_interactions(id),
  is_test               boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (owner_id, source_key, external_message_id),
  unique (owner_id, fingerprint),
  check (event_kind <> 'message_imported' or source_key = 'manual_import'),
  check (full_text_available = (imported_text is not null))
);
create index if not exists monitor_inbound_pending
  on jobbot.monitor_inbound_events(owner_id, processing_state)
  where processing_state in ('new','needs_message_context','needs_ai','ready_for_promotion');
create index if not exists monitor_inbound_contact on jobbot.monitor_inbound_events(contact_id);
create index if not exists monitor_inbound_conv on jobbot.monitor_inbound_events(conversation_id);
create index if not exists monitor_inbound_run on jobbot.monitor_inbound_events(run_id);
create index if not exists monitor_inbound_promoted on jobbot.monitor_inbound_events(promoted_interaction_id);

-- 7. Layer-B AI task queue --------------------------------------------
create table if not exists jobbot.monitor_ai_tasks (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null default 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid
                     check (owner_id = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid),
  idempotency_key    text not null,
  task_type          text not null
                     check (task_type in ('classify_message','reply_draft','followup_refresh',
                                          'resume_share_draft','job_lead_extract')),
  assignee           text not null default 'linkedin_bot'
                     check (assignee in ('linkedin_bot','job_bot')),
  requires_approval  boolean not null default true check (requires_approval),
  inbound_event_id   uuid references jobbot.monitor_inbound_events(id),
  contact_id         uuid references jobbot.outreach_contacts(id),
  payload            jsonb not null,
  state              text not null default 'pending'
                     check (state in ('pending','claimed','completed','failed','cancelled','promoted')),
  claimed_at         timestamptz,
  claim_expires_at   timestamptz,
  attempts           integer not null default 0 check (attempts between 0 and 3),
  result_draft       text,
  result_meta        jsonb,
  promoted_action_id uuid references jobbot.outreach_actions(id),
  last_error         text,
  is_test            boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (owner_id, idempotency_key)
);
create index if not exists monitor_ai_tasks_pending on jobbot.monitor_ai_tasks(state, assignee, created_at)
  where state in ('pending','claimed','completed');
create index if not exists monitor_ai_tasks_event on jobbot.monitor_ai_tasks(inbound_event_id);
create index if not exists monitor_ai_tasks_contact on jobbot.monitor_ai_tasks(contact_id);
create index if not exists monitor_ai_tasks_action on jobbot.monitor_ai_tasks(promoted_action_id);

-- 8. Additive nullable columns on an existing table -------------------
alter table jobbot.outreach_followups
  add column if not exists renewed_review_eligible_at timestamptz,
  add column if not exists renewed_review_reason      text;

-- 9. RLS + grants ------------------------------------------------------
alter table jobbot.monitor_settings        enable row level security;
alter table jobbot.monitor_sources         enable row level security;
alter table jobbot.sync_cursors            enable row level security;
alter table jobbot.monitor_runs            enable row level security;
alter table jobbot.monitor_conversations   enable row level security;
alter table jobbot.monitor_inbound_events  enable row level security;
alter table jobbot.monitor_ai_tasks        enable row level security;

do $$
declare t text;
begin
  foreach t in array array['monitor_settings','monitor_sources','sync_cursors','monitor_runs',
                           'monitor_conversations','monitor_inbound_events','monitor_ai_tasks'] loop
    execute format('revoke all on jobbot.%I from anon, authenticated', t);
    execute format($p$drop policy if exists owner_read on jobbot.%I$p$, t);
    execute format($p$create policy owner_read on jobbot.%I for select to authenticated
      using (owner_id = (select auth.uid())
             and (select auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid)$p$, t);
    execute format('grant select on jobbot.%I to authenticated', t);
  end loop;
end $$;

-- Owner write paths (column-restricted; used by the public.jf_monitor_* RPCs)
drop policy if exists owner_update on jobbot.monitor_settings;
create policy owner_update on jobbot.monitor_settings for update to authenticated
  using (owner_id = (select auth.uid()) and (select auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid)
  with check (owner_id = (select auth.uid()) and (select auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid);
grant update (enabled, paused, interval_minutes, interval_preset, next_run_at, run_now_requested_at,
              status, status_detail, updated_at, updated_by,
              source_check_requested_at, ai_dispatch_enabled, ai_next_dispatch_at)
  on jobbot.monitor_settings to authenticated;           -- NOT fully_active / last_success_at

drop policy if exists owner_update on jobbot.monitor_inbound_events;
create policy owner_update on jobbot.monitor_inbound_events for update to authenticated
  using (owner_id = (select auth.uid()) and (select auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid)
  with check (owner_id = (select auth.uid()) and (select auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid);
grant update (processing_state, promoted_interaction_id, contact_id, contact_match, updated_at)
  on jobbot.monitor_inbound_events to authenticated;

drop policy if exists owner_insert on jobbot.monitor_inbound_events;
create policy owner_insert on jobbot.monitor_inbound_events for insert to authenticated
  with check (owner_id = (select auth.uid()) and (select auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid
              and source_key = 'manual_import' and run_id is null);
grant insert (owner_id, source_key, external_message_id, external_thread_id, fingerprint, conversation_id,
              event_kind, sender_name, sender_profile_url, contact_id, contact_match, observed_at,
              full_text_available, imported_text, processing_state, classification, is_test)
  on jobbot.monitor_inbound_events to authenticated;

drop policy if exists owner_insert on jobbot.monitor_ai_tasks;
create policy owner_insert on jobbot.monitor_ai_tasks for insert to authenticated
  with check (owner_id = (select auth.uid()) and (select auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid
              and state = 'pending');
drop policy if exists owner_update on jobbot.monitor_ai_tasks;
create policy owner_update on jobbot.monitor_ai_tasks for update to authenticated
  using (owner_id = (select auth.uid()) and (select auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid)
  with check (owner_id = (select auth.uid()) and (select auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid);
grant insert (owner_id, idempotency_key, task_type, assignee, inbound_event_id, contact_id, payload, is_test)
  on jobbot.monitor_ai_tasks to authenticated;
grant update (state, promoted_action_id, updated_at) on jobbot.monitor_ai_tasks to authenticated;

drop policy if exists owner_upsert on jobbot.monitor_conversations;
create policy owner_upsert on jobbot.monitor_conversations for insert to authenticated
  with check (owner_id = (select auth.uid()) and (select auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid
              and source_key = 'manual_import');
grant insert (owner_id, source_key, external_thread_id, contact_id, contact_match, counterpart_name,
              last_message_at, last_processed_message_id, compact_context, state, is_test)
  on jobbot.monitor_conversations to authenticated;

-- 10. System functions (jobbot, SECURITY DEFINER, not callable by API roles)
create or replace function jobbot.monitor_match_contact(p_sender_name text, p_sender_url text,
  out contact_id uuid, out contact_match text)
language plpgsql stable security definer set search_path = '' as $$
declare n int;
begin
  contact_id := null; contact_match := 'none';
  if nullif(trim(p_sender_url),'') is not null then
    select c.id into contact_id from jobbot.outreach_contacts c
     where rtrim(lower(c.linkedin_url),'/') = rtrim(lower(trim(p_sender_url)),'/') limit 1;
    if contact_id is not null then contact_match := 'exact_profile_url'; return; end if;
  end if;
  if nullif(trim(p_sender_name),'') is null then return; end if;
  select count(*), min(c.id::text)::uuid into n, contact_id from jobbot.outreach_contacts c
   where lower(trim(c.full_name)) = lower(trim(p_sender_name));
  if n = 1 then contact_match := 'exact_name'; return; end if;
  contact_id := null;
  if n = 0 then
    select count(*), min(c.id::text)::uuid into n, contact_id from jobbot.outreach_contacts c
     where lower(split_part(trim(c.full_name),' ',1)) = lower(split_part(trim(p_sender_name),' ',1));
    if n = 1 then contact_match := 'name_only_needs_review'; return; end if;
    contact_id := null;
  end if;
  contact_match := case when n > 1 then 'name_only_needs_review' else 'new_contact_proposed' end;
end $$;

-- Claim a due run. NULL = nothing to do (disabled, paused, not due, or another run active).
create or replace function jobbot.monitor_claim_run(
  p_source text default 'gmail_linkedin_notifications', p_test boolean default false)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare s jobbot.monitor_settings; run uuid; trig text;
begin
  update jobbot.monitor_runs
     set status = 'expired', finished_at = now(),
         errors = errors || jsonb_build_array(jsonb_build_object('code','lease_expired'))
   where status = 'claimed' and lease_expires_at < now();

  select * into s from jobbot.monitor_settings
   where owner_id = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid for update;
  if s.id is null then return null; end if;

  if p_test then
    trig := 'test';
  elsif s.source_check_requested_at is not null then
    -- owner-requested Gmail source check: allowed while disabled; never moves cursor
    trig := 'test'; p_test := true;
    update jobbot.monitor_settings set source_check_requested_at = null, updated_at = now() where id = s.id;
  else
    if not s.enabled or s.paused then return null; end if;
    if s.run_now_requested_at is not null then trig := 'run_now';
    elsif s.next_run_at is not null and s.next_run_at <= now() then trig := 'scheduled';
    else return null; end if;
  end if;

  begin
    insert into jobbot.monitor_runs(owner_id, trigger, is_test, source_key, cursor_before)
    values (s.owner_id, trig, p_test, p_source,
            (select to_jsonb(c) from jobbot.sync_cursors c
              where c.owner_id = s.owner_id and c.source_key = p_source))
    returning id into run;
  exception when unique_violation then
    return null;
  end;

  if not p_test then
    update jobbot.monitor_settings
       set status = 'running', last_attempt_at = now(), run_now_requested_at = null,
           next_run_at = now() + make_interval(mins => poll_interval_minutes) - interval '30 seconds',
           updated_at = now()
     where id = s.id;
  end if;
  return run;
end $$;

-- Idempotent ingest of one source event.
create or replace function jobbot.monitor_ingest_event(
  p_run uuid, p_external_id text, p_thread text, p_kind text,
  p_sender_name text, p_sender_url text, p_observed_at timestamptz, p_preview text)
returns text
language plpgsql security definer set search_path = '' as $$
declare r jobbot.monitor_runs; fp text; m record; conv uuid; ins uuid; st text; preview text;
begin
  select * into r from jobbot.monitor_runs where id = p_run;
  if r.id is null or r.status <> 'claimed' then raise exception 'Run not active'; end if;
  if p_kind not in ('message_notification','message_digest','connection_accepted',
                    'invitation_received','inmail_notification','other') then
    raise exception 'Bad event kind %', p_kind;
  end if;
  if nullif(trim(p_external_id),'') is null or p_observed_at is null then
    raise exception 'external id and observed_at are required';
  end if;

  fp := encode(extensions.digest(r.source_key||'|'||coalesce(lower(trim(p_sender_name)),'')||'|'||
              p_kind||'|'||to_char(date_trunc('minute', p_observed_at at time zone 'UTC'),'YYYYMMDDHH24MI')||
              case when p_sender_name is null then '|'||p_external_id else '' end,'sha256'),'hex');

  if exists (select 1 from jobbot.monitor_inbound_events e
              where e.owner_id = r.owner_id
                and ((e.source_key = r.source_key and e.external_message_id = p_external_id)
                     or e.fingerprint = fp)) then
    update jobbot.monitor_runs set events_seen = events_seen + 1, events_duplicate = events_duplicate + 1
     where id = p_run;
    return 'duplicate';
  end if;

  select * into m from jobbot.monitor_match_contact(p_sender_name, p_sender_url);
  st := case when p_kind = 'message_digest' then 'needs_message_context'
             when p_kind in ('message_notification','inmail_notification') then 'needs_message_context'
             when p_kind = 'connection_accepted' and m.contact_id is not null then 'ready_for_promotion'
             else 'matched' end;
  -- previews are kept verbatim only for message-type notifications; never expanded
  preview := case when p_kind in ('message_notification','inmail_notification') then left(p_preview, 280) end;

  if p_thread is not null then
    insert into jobbot.monitor_conversations as mc(owner_id, source_key, external_thread_id, contact_id,
           contact_match, counterpart_name, counterpart_profile_url, last_message_at,
           last_processed_message_id, state, is_test)
    values (r.owner_id, r.source_key, p_thread, m.contact_id, m.contact_match, p_sender_name, p_sender_url,
            p_observed_at, p_external_id,
            case when st = 'needs_message_context' then 'awaiting_context' else 'open' end, r.is_test)
    on conflict (owner_id, source_key, external_thread_id) do update
      set last_message_at = greatest(mc.last_message_at, excluded.last_message_at),
          last_processed_message_id = case when excluded.last_message_at >= coalesce(mc.last_message_at,'-infinity')
                                           then excluded.last_processed_message_id else mc.last_processed_message_id end,
          contact_id = coalesce(mc.contact_id, excluded.contact_id),
          state = case when excluded.state = 'awaiting_context' then 'awaiting_context' else mc.state end,
          updated_at = now()
    returning id into conv;
  end if;

  insert into jobbot.monitor_inbound_events(owner_id, source_key, external_message_id, external_thread_id,
         fingerprint, conversation_id, run_id, event_kind, sender_name, sender_profile_url, contact_id,
         contact_match, observed_at, full_text_available, preview_excerpt, processing_state,
         classification, is_test)
  values (r.owner_id, r.source_key, p_external_id, p_thread, fp, conv, p_run, p_kind,
          left(p_sender_name,240), p_sender_url, m.contact_id, m.contact_match, p_observed_at, false,
          preview, st, jsonb_build_object('method','deterministic','event_kind',p_kind,
                                          'response_required', st = 'needs_message_context'),
          r.is_test)
  on conflict do nothing returning id into ins;

  if ins is null then
    update jobbot.monitor_runs set events_seen = events_seen + 1, events_duplicate = events_duplicate + 1
     where id = p_run;
    return 'duplicate';
  end if;
  update jobbot.monitor_runs
     set events_seen = events_seen + 1, events_new = events_new + 1,
         needs_context = needs_context + (st = 'needs_message_context')::int
   where id = p_run;
  return 'inserted';
end $$;

-- Complete a run: the ONLY place a cursor advances, and only on success of a real run.
create or replace function jobbot.monitor_complete_run(
  p_run uuid, p_status text, p_last_observed_at timestamptz default null,
  p_last_external_id text default null, p_errors jsonb default '[]'::jsonb,
  p_source_connection text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r jobbot.monitor_runs; cur jsonb;
begin
  select * into r from jobbot.monitor_runs where id = p_run for update;
  if r.id is null or r.status <> 'claimed' then raise exception 'Run not active'; end if;
  if p_status not in ('succeeded','failed','source_unavailable') then raise exception 'Bad status'; end if;
  if p_source_connection is not null and p_source_connection not in
     ('connected','needs_auth','not_configured','unavailable','error') then
    raise exception 'Bad source connection status';
  end if;

  if p_status = 'succeeded' and not r.is_test then
    insert into jobbot.sync_cursors(owner_id, source_key, last_success_at, last_observed_at, last_external_id,
                                    consecutive_failures, last_error)
    values (r.owner_id, r.source_key, now(), p_last_observed_at, p_last_external_id, 0, null)
    on conflict (owner_id, source_key) do update
      set last_success_at = now(),
          last_observed_at = case when excluded.last_observed_at is null then jobbot.sync_cursors.last_observed_at
                                  else greatest(coalesce(jobbot.sync_cursors.last_observed_at,'-infinity'),
                                                excluded.last_observed_at) end,
          last_external_id = case when excluded.last_observed_at is not null
                                   and excluded.last_observed_at >= coalesce(jobbot.sync_cursors.last_observed_at,'-infinity')
                                  then coalesce(excluded.last_external_id, jobbot.sync_cursors.last_external_id)
                                  else jobbot.sync_cursors.last_external_id end,
          consecutive_failures = 0, last_error = null, updated_at = now();
    update jobbot.monitor_sources
       set connection_status = 'connected', verification_status = 'verified',
           last_verified_at = now(), verification_ref = 'monitor_run:' || r.id, updated_at = now()
     where source_key = r.source_key;
    update jobbot.monitor_settings
       set last_success_at = now(),
           status = case when paused then 'paused' when enabled then 'idle' else 'disabled' end,
           status_detail = null,
           fully_active = case when r.source_key = 'gmail_linkedin_notifications' then true else fully_active end,
           fully_active_evidence = case when r.source_key = 'gmail_linkedin_notifications' and not fully_active
                                        then 'first successful real sync run ' || r.id || ' at ' || now()
                                        else fully_active_evidence end,
           updated_at = now()
     where owner_id = r.owner_id;
  elsif p_status = 'succeeded' and r.is_test then
    -- source check passed: OAuth + Gmail list worked. Never moves the cursor,
    -- never sets fully_active (that needs a real run).
    update jobbot.monitor_sources
       set connection_status = 'connected', verification_status = 'verified',
           last_verified_at = now(), verification_ref = 'source_check:' || r.id, updated_at = now()
     where source_key = r.source_key;
  else
    insert into jobbot.sync_cursors(owner_id, source_key, consecutive_failures, last_error)
    values (r.owner_id, r.source_key, 1, left(p_errors::text, 500))
    on conflict (owner_id, source_key) do update
      set consecutive_failures = jobbot.sync_cursors.consecutive_failures + 1,
          last_error = left(p_errors::text, 500), updated_at = now();   -- cursor NOT advanced
    if p_source_connection is not null then
      update jobbot.monitor_sources set connection_status = p_source_connection,
             verification_status = case when verification_status = 'verified' then 'verified' else 'failed' end,
             updated_at = now()
       where source_key = r.source_key;
    end if;
    if not r.is_test then
      update jobbot.monitor_settings
         set status = case when p_status = 'source_unavailable' then 'source_unavailable' else 'error' end,
             status_detail = left(p_errors::text, 300), updated_at = now()
       where owner_id = r.owner_id;
    end if;
  end if;

  select to_jsonb(c) into cur from jobbot.sync_cursors c
   where c.owner_id = r.owner_id and c.source_key = r.source_key;
  update jobbot.monitor_runs
     set status = p_status, finished_at = now(), errors = coalesce(p_errors,'[]'::jsonb), cursor_after = cur
   where id = p_run;
  return cur;
end $$;

-- Secrets for the edge function (read via the DB connection; never returned to API roles).
create or replace function jobbot.monitor_get_secret(p_name text)
returns text
language plpgsql stable security definer set search_path = '' as $$
declare v text;
begin
  if p_name not in ('jf_monitor_invoke_token','jf_gmail_client_id','jf_gmail_client_secret',
                    'jf_gmail_refresh_token','jf_grok_webhook_url','jf_grok_webhook_key',
                    'jf_grok_webhook_header') then
    raise exception 'Secret not allowed';
  end if;
  select decrypted_secret into v from vault.decrypted_secrets where name = p_name limit 1;
  return v;
end $$;

-- Layer-B dispatch gate. Returns the number of pending AI tasks to announce to
-- Grok, or 0 (= do NOT wake Grok). Advances the AI timer only when it returns >0.
create or replace function jobbot.monitor_claim_ai_dispatch()
returns integer
language plpgsql security definer set search_path = '' as $$
declare s jobbot.monitor_settings; n int;
begin
  select * into s from jobbot.monitor_settings
   where owner_id = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid for update;
  if s.id is null or not s.ai_dispatch_enabled or s.paused then return 0; end if;
  if s.ai_next_dispatch_at is not null and s.ai_next_dispatch_at > now() then return 0; end if;
  select count(*) into n from jobbot.monitor_ai_tasks t
   where t.owner_id = s.owner_id and not t.is_test
     and (t.state = 'pending' or (t.state = 'claimed' and t.claim_expires_at < now()));
  if n = 0 then return 0; end if;
  update jobbot.monitor_settings
     set last_ai_dispatch_at = now(), last_ai_dispatch_count = n,
         ai_next_dispatch_at = now() + make_interval(mins => interval_minutes) - interval '30 seconds',
         updated_at = now()
   where id = s.id;
  return n;
end $$;

create or replace function jobbot.monitor_note_ai_dispatch(p_result text)
returns void
language sql security definer set search_path = '' as $$
  update jobbot.monitor_settings set last_ai_dispatch_result = left(p_result, 300), updated_at = now()
   where owner_id = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid;
$$;

revoke all on function jobbot.monitor_claim_ai_dispatch() from public, anon, authenticated;
revoke all on function jobbot.monitor_note_ai_dispatch(text) from public, anon, authenticated;
revoke all on function jobbot.monitor_match_contact(text,text) from public, anon, authenticated;
revoke all on function jobbot.monitor_claim_run(text,boolean) from public, anon, authenticated;
revoke all on function jobbot.monitor_ingest_event(uuid,text,text,text,text,text,timestamptz,text) from public, anon, authenticated;
revoke all on function jobbot.monitor_complete_run(uuid,text,timestamptz,text,jsonb,text) from public, anon, authenticated;
revoke all on function jobbot.monitor_get_secret(text) from public, anon, authenticated;

-- 11. Owner RPCs (public, SECURITY INVOKER; run under the dashboard JWT) --
create or replace function public.jf_monitor_set_interval(p_minutes integer, p_preset text default null)
returns jsonb
language plpgsql set search_path = '' as $$
declare r jobbot.monitor_settings;
begin
  if (select auth.uid()) is distinct from 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid then raise exception 'Unauthorized'; end if;
  if p_minutes is null or p_minutes < 10 or p_minutes > 1440 or p_minutes % 5 <> 0 then
    raise exception 'Interval must be 10-1440 minutes in steps of 5';
  end if;
  update jobbot.monitor_settings s
     set interval_minutes = p_minutes,
         interval_preset  = coalesce(p_preset, case when p_minutes in (20,30,60) then p_minutes::text else 'custom' end),
         -- AI processing interval only; the 5-min Gmail poll (next_run_at) is untouched
         ai_next_dispatch_at = case when s.last_ai_dispatch_at is null then s.ai_next_dispatch_at
                                    else greatest(now(), s.last_ai_dispatch_at + make_interval(mins => p_minutes)
                                                         - interval '30 seconds') end,
         updated_at = now(), updated_by = (select auth.uid())
   where s.owner_id = (select auth.uid()) returning * into r;
  if r.id is null then raise exception 'Monitor settings not found'; end if;
  return to_jsonb(r);
end $$;

create or replace function public.jf_monitor_set_enabled(p_enabled boolean)
returns jsonb
language plpgsql set search_path = '' as $$
declare r jobbot.monitor_settings;
begin
  if (select auth.uid()) is distinct from 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid then raise exception 'Unauthorized'; end if;
  if p_enabled and not exists (select 1 from jobbot.monitor_sources
                                where source_key = 'gmail_linkedin_notifications'
                                  and verification_status = 'verified' and last_verified_at is not null) then
    raise exception 'Gmail source check has not passed yet: store Gmail OAuth in Vault, then run jf_monitor_request_source_check()';
  end if;
  update jobbot.monitor_settings s
     set enabled = p_enabled,
         status = case when p_enabled then (case when s.paused then 'paused' else 'idle' end) else 'disabled' end,
         next_run_at = case when p_enabled and not s.paused then now() else null end,
         run_now_requested_at = case when p_enabled then s.run_now_requested_at end,
         updated_at = now(), updated_by = (select auth.uid())
   where s.owner_id = (select auth.uid()) returning * into r;
  if r.id is null then raise exception 'Monitor settings not found'; end if;
  return to_jsonb(r);
end $$;

create or replace function public.jf_monitor_set_paused(p_paused boolean)
returns jsonb
language plpgsql set search_path = '' as $$
declare r jobbot.monitor_settings;
begin
  if (select auth.uid()) is distinct from 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid then raise exception 'Unauthorized'; end if;
  update jobbot.monitor_settings s
     set paused = p_paused,
         status = case when p_paused then 'paused' when s.enabled then 'idle' else 'disabled' end,
         next_run_at = case when p_paused or not s.enabled then null else now() end,
         run_now_requested_at = case when p_paused then null else s.run_now_requested_at end,
         updated_at = now(), updated_by = (select auth.uid())
   where s.owner_id = (select auth.uid()) returning * into r;
  if r.id is null then raise exception 'Monitor settings not found'; end if;
  return to_jsonb(r);
end $$;

create or replace function public.jf_monitor_run_now()
returns jsonb
language plpgsql set search_path = '' as $$
declare r jobbot.monitor_settings;
begin
  if (select auth.uid()) is distinct from 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid then raise exception 'Unauthorized'; end if;
  update jobbot.monitor_settings s
     set run_now_requested_at = now(), updated_at = now(), updated_by = (select auth.uid())
   where s.owner_id = (select auth.uid()) and s.enabled and not s.paused returning * into r;
  if r.id is null then raise exception 'Monitoring is disabled or paused'; end if;
  return to_jsonb(r);
end $$;

-- Ask the next 5-min tick to run a Gmail source check (OAuth + list, no ingest, no cursor move).
create or replace function public.jf_monitor_request_source_check()
returns jsonb
language plpgsql set search_path = '' as $$
declare r jobbot.monitor_settings;
begin
  if (select auth.uid()) is distinct from 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid then raise exception 'Unauthorized'; end if;
  update jobbot.monitor_settings s
     set source_check_requested_at = now(), updated_at = now(), updated_by = (select auth.uid())
   where s.owner_id = (select auth.uid()) returning * into r;
  if r.id is null then raise exception 'Monitor settings not found'; end if;
  return to_jsonb(r);
end $$;

-- Allow/stop webhook wakes of the Grok Layer-B routine (only when work is pending).
create or replace function public.jf_monitor_set_ai_dispatch(p_enabled boolean)
returns jsonb
language plpgsql set search_path = '' as $$
declare r jobbot.monitor_settings;
begin
  if (select auth.uid()) is distinct from 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid then raise exception 'Unauthorized'; end if;
  update jobbot.monitor_settings s
     set ai_dispatch_enabled = p_enabled,
         ai_next_dispatch_at = case when p_enabled then coalesce(s.ai_next_dispatch_at, now()) else null end,
         updated_at = now(), updated_by = (select auth.uid())
   where s.owner_id = (select auth.uid()) returning * into r;
  if r.id is null then raise exception 'Monitor settings not found'; end if;
  return to_jsonb(r);
end $$;

-- Promote a staged, verified acceptance into the audited outreach tables (owner click only).
create or replace function public.jf_monitor_promote_acceptance(p_event_id uuid)
returns uuid
language plpgsql set search_path = '' as $$
declare e jobbot.monitor_inbound_events; new_id uuid;
begin
  if (select auth.uid()) is distinct from 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid then raise exception 'Unauthorized'; end if;
  select * into e from jobbot.monitor_inbound_events where id = p_event_id for update;
  if e.id is null or e.event_kind <> 'connection_accepted' or e.contact_id is null or e.is_test
     or e.processing_state = 'promoted' then
    raise exception 'Not a promotable acceptance';
  end if;
  insert into jobbot.outreach_interactions(owner_id, contact_id, event_type, channel, direction,
         message_summary, event_at, verification, evidence_source, evidence_ref, external_key)
  values ((select auth.uid()), e.contact_id, 'invitation_accepted', 'linkedin', 'inbound',
          'LinkedIn acceptance notification email', e.observed_at, 'verified',
          'gmail_linkedin_notification', 'gmail:' || e.external_message_id,
          'gmail:' || e.external_message_id)
  on conflict (owner_id, external_key) do nothing
  returning id into new_id;
  if new_id is null then
    select id into new_id from jobbot.outreach_interactions
     where owner_id = (select auth.uid()) and external_key = 'gmail:' || e.external_message_id;
  end if;
  update jobbot.outreach_contacts set connection_stage = 'connected', last_verified_at = now()
   where id = e.contact_id and connection_stage = 'invited';
  update jobbot.outreach_followups
     set renewed_review_eligible_at = now(),
         renewed_review_reason = 'verified acceptance gmail:' || e.external_message_id
   where contact_id = e.contact_id and state = 'postponed' and renewed_review_eligible_at is null;
  update jobbot.monitor_inbound_events
     set processing_state = 'promoted', promoted_interaction_id = new_id, updated_at = now()
   where id = e.id;
  return new_id;
end $$;

-- Manual import of message text the owner pasted (fills a needs_message_context item or a new one).
-- Creates exactly one Layer-B task; resume/CV requests get a resume_share_draft task (approval item).
create or replace function public.jf_monitor_import_message(
  p_text text, p_sender_name text, p_contact_id uuid default null,
  p_sender_profile_url text default null, p_observed_at timestamptz default null,
  p_context_event_id uuid default null, p_external_ref text default null)
returns jsonb
language plpgsql set search_path = '' as $$
declare uid uuid := (select auth.uid()); ext text; cid uuid; cmatch text; conv uuid; ev uuid;
        ttype text; task uuid; obs timestamptz := coalesce(p_observed_at, now()); ctx jobbot.monitor_inbound_events;
begin
  if uid is distinct from 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid then raise exception 'Unauthorized'; end if;
  if nullif(trim(p_text),'') is null then raise exception 'Message text is required'; end if;
  ext := coalesce(nullif(trim(p_external_ref),''),
                  'import:' || encode(extensions.digest(lower(coalesce(p_sender_name,''))||'|'||p_text,'sha256'),'hex'));
  if exists (select 1 from jobbot.monitor_inbound_events
              where source_key = 'manual_import' and external_message_id = ext) then
    return jsonb_build_object('result','duplicate','external_message_id',ext);
  end if;
  if p_contact_id is not null then
    cmatch := 'owner_selected';
    select id into cid from jobbot.outreach_contacts where id = p_contact_id and not do_not_contact;
    if cid is null then raise exception 'Contact not found or opted out'; end if;
  else
    -- owner-side matching by exact full name (RLS-visible rows only)
    select id into cid from jobbot.outreach_contacts
     where lower(trim(full_name)) = lower(trim(p_sender_name)) limit 1;
    cmatch := case when cid is not null then 'exact_name' else 'new_contact_proposed' end;
  end if;
  if cid is not null and exists (select 1 from jobbot.outreach_contacts where id = cid and do_not_contact) then
    raise exception 'Contact opted out; not processing';
  end if;

  insert into jobbot.monitor_conversations(owner_id, source_key, external_thread_id, contact_id, contact_match,
         counterpart_name, last_message_at, last_processed_message_id, compact_context, state)
  values (uid, 'manual_import', 'import-thread:' || coalesce(cid::text, lower(trim(p_sender_name))),
          cid, cmatch, p_sender_name, obs, ext, left(p_text, 2000), 'awaiting_ai')
  on conflict (owner_id, source_key, external_thread_id) do nothing
  returning id into conv;
  if conv is null then
    select id into conv from jobbot.monitor_conversations
     where source_key = 'manual_import'
       and external_thread_id = 'import-thread:' || coalesce(cid::text, lower(trim(p_sender_name)));
  end if;

  ttype := case when p_text ~* '\m(resume|résumé|cv|curriculum vitae)\M' then 'resume_share_draft' else 'reply_draft' end;

  insert into jobbot.monitor_inbound_events(owner_id, source_key, external_message_id, external_thread_id,
         fingerprint, conversation_id, event_kind, sender_name, sender_profile_url, contact_id, contact_match,
         observed_at, full_text_available, imported_text, processing_state, classification)
  values (uid, 'manual_import', ext, 'import-thread:' || coalesce(cid::text, lower(trim(p_sender_name))),
          encode(extensions.digest('manual_import|'||ext,'sha256'),'hex'), conv, 'message_imported',
          left(p_sender_name,240), p_sender_profile_url, cid, cmatch, obs, true, left(p_text, 8000), 'needs_ai',
          jsonb_build_object('method','deterministic','direction','inbound',
                             'intents', case when ttype = 'resume_share_draft' then '["resume_request"]'::jsonb else '[]'::jsonb end,
                             'response_required', true))
  returning id into ev;

  insert into jobbot.monitor_ai_tasks(owner_id, idempotency_key, task_type, inbound_event_id, contact_id, payload)
  values (uid, ttype || ':' || ev, ttype, ev, cid,
          jsonb_build_object('contact_id', cid, 'sender_name', p_sender_name, 'contact_match', cmatch,
                             'new_message', left(p_text, 4000), 'observed_at', obs,
                             'exact_task', case when ttype = 'resume_share_draft'
                               then 'Draft a short reply acknowledging the resume request; propose which resume to share. Do not send or attach anything.'
                               else 'Draft a short, natural reply for owner approval. Do not send.' end))
  on conflict (owner_id, idempotency_key) do nothing
  returning id into task;

  if p_context_event_id is not null then
    select * into ctx from jobbot.monitor_inbound_events where id = p_context_event_id;
    if ctx.id is not null and ctx.processing_state = 'needs_message_context' then
      update jobbot.monitor_inbound_events
         set processing_state = 'matched', updated_at = now(),
             contact_id = coalesce(contact_id, cid),
             contact_match = case when contact_id is null and cid is not null then cmatch else contact_match end
       where id = ctx.id;
    end if;
  end if;
  return jsonb_build_object('result','inserted','event_id',ev,'ai_task_id',task,'task_type',ttype,
                            'contact_id',cid,'contact_match',cmatch);
end $$;

-- Turn a completed Layer-B suggestion into a normal pending-approval draft (existing approval queue).
create or replace function public.jf_monitor_promote_ai_draft(p_task_id uuid, p_action_type text default 'reply')
returns uuid
language plpgsql set search_path = '' as $$
declare t jobbot.monitor_ai_tasks; c jobbot.outreach_contacts; aid uuid;
begin
  if (select auth.uid()) is distinct from 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid then raise exception 'Unauthorized'; end if;
  select * into t from jobbot.monitor_ai_tasks where id = p_task_id for update;
  if t.id is null or t.state <> 'completed' or nullif(trim(t.result_draft),'') is null or t.contact_id is null or t.is_test then
    raise exception 'Task is not a completed draft for a known contact';
  end if;
  select * into c from jobbot.outreach_contacts where id = t.contact_id;
  if c.do_not_contact then raise exception 'Contact opted out'; end if;
  aid := public.jf_outreach_create_draft(t.contact_id, p_action_type, 'linkedin', c.full_name, c.linkedin_url,
           t.result_draft, 'monitor_ai_task:' || t.id, left(coalesce(t.payload->>'new_message',''), 2000),
           null, null, null, null);
  update jobbot.monitor_ai_tasks set state = 'promoted', promoted_action_id = aid, updated_at = now()
   where id = t.id;
  return aid;
end $$;

revoke all on function public.jf_monitor_set_interval(integer,text) from public, anon;
revoke all on function public.jf_monitor_set_enabled(boolean) from public, anon;
revoke all on function public.jf_monitor_set_paused(boolean) from public, anon;
revoke all on function public.jf_monitor_run_now() from public, anon;
revoke all on function public.jf_monitor_promote_acceptance(uuid) from public, anon;
revoke all on function public.jf_monitor_import_message(text,text,uuid,text,timestamptz,uuid,text) from public, anon;
revoke all on function public.jf_monitor_promote_ai_draft(uuid,text) from public, anon;
revoke all on function public.jf_monitor_request_source_check() from public, anon;
revoke all on function public.jf_monitor_set_ai_dispatch(boolean) from public, anon;
grant execute on function public.jf_monitor_set_interval(integer,text),
                          public.jf_monitor_set_enabled(boolean),
                          public.jf_monitor_set_paused(boolean),
                          public.jf_monitor_run_now(),
                          public.jf_monitor_promote_acceptance(uuid),
                          public.jf_monitor_import_message(text,text,uuid,text,timestamptz,uuid,text),
                          public.jf_monitor_promote_ai_draft(uuid,text),
                          public.jf_monitor_request_source_check(),
                          public.jf_monitor_set_ai_dispatch(boolean) to authenticated;

-- 12. Dashboard read views (security_invoker) --------------------------
create or replace view public.jf_monitor_status with (security_invoker = true) as
select s.enabled, s.paused, s.interval_minutes, s.interval_preset, s.tick_granularity_min, s.status, s.status_detail,
       s.interval_minutes as ai_interval_minutes, s.poll_interval_minutes, s.source_check_requested_at,
       s.ai_dispatch_enabled, s.ai_next_dispatch_at, s.last_ai_dispatch_at, s.last_ai_dispatch_count,
       s.last_ai_dispatch_result,
       s.last_success_at, s.last_attempt_at, s.next_run_at, s.run_now_requested_at,
       s.fully_active, s.fully_active_evidence, s.updated_at,
       (select count(*) from jobbot.monitor_inbound_events e where e.owner_id = s.owner_id and not e.is_test
          and e.created_at > now() - interval '24 hours') as new_events_24h,
       (select count(*) from jobbot.monitor_inbound_events e where e.owner_id = s.owner_id and not e.is_test
          and e.processing_state = 'needs_message_context') as needs_context_open,
       (select count(*) from jobbot.monitor_inbound_events e where e.owner_id = s.owner_id and not e.is_test
          and e.processing_state = 'ready_for_promotion') as ready_for_promotion,
       (select coalesce(sum(r.drafts_created),0) from jobbot.monitor_runs r where r.owner_id = s.owner_id
          and not r.is_test and r.claimed_at > now() - interval '24 hours') as drafts_created_24h,
       (select count(*) from jobbot.monitor_ai_tasks t where t.owner_id = s.owner_id and not t.is_test
          and t.state in ('pending','claimed')) as ai_tasks_open,
       (select count(*) from jobbot.monitor_ai_tasks t where t.owner_id = s.owner_id and not t.is_test
          and t.state = 'completed') as ai_suggestions_awaiting_review,
       (select count(*) from jobbot.outreach_action_revisions rv
          where rv.owner_id = s.owner_id
            and rv.revision_no = (select max(r2.revision_no) from jobbot.outreach_action_revisions r2 where r2.action_id = rv.action_id)
            and not exists (select 1 from jobbot.outreach_decisions d where d.revision_id = rv.id)) as pending_approvals,
       (select count(*) from jobbot.monitor_runs r where r.owner_id = s.owner_id and not r.is_test
          and r.status in ('failed','source_unavailable','expired') and r.claimed_at > now() - interval '24 hours') as errors_24h
from jobbot.monitor_settings s;

create or replace view public.jf_monitor_runs with (security_invoker = true) as
  select id, trigger, is_test, status, source_key, claimed_at, finished_at, events_seen, events_new,
         events_duplicate, needs_context, ai_tasks_created, drafts_created, ai_invoked, errors,
         cursor_before, cursor_after
  from jobbot.monitor_runs order by claimed_at desc limit 50;
create or replace view public.jf_monitor_sources with (security_invoker = true) as
  select s.source_key, s.display_name, s.adapter, s.capabilities, s.limitations, s.connection_status,
         s.verification_status, s.last_verified_at, s.verification_ref, s.updated_at,
         c.last_success_at as cursor_last_success_at, c.last_observed_at, c.last_external_id,
         c.overlap_minutes, c.consecutive_failures, c.last_error
  from jobbot.monitor_sources s left join jobbot.sync_cursors c using (owner_id, source_key);
create or replace view public.jf_monitor_inbox with (security_invoker = true) as
  select id, source_key, event_kind, sender_name, contact_id, contact_match, observed_at, external_thread_id,
         conversation_id, full_text_available, preview_excerpt, processing_state, classification, is_test, created_at
  from jobbot.monitor_inbound_events order by observed_at desc;
create or replace view public.jf_monitor_ai_tasks with (security_invoker = true) as
  select id, task_type, assignee, state, inbound_event_id, contact_id, result_draft, result_meta,
         promoted_action_id, attempts, last_error, is_test, created_at, updated_at
  from jobbot.monitor_ai_tasks order by created_at desc;
revoke all on public.jf_monitor_status, public.jf_monitor_runs, public.jf_monitor_sources,
              public.jf_monitor_inbox, public.jf_monitor_ai_tasks from anon;
grant select on public.jf_monitor_status, public.jf_monitor_runs, public.jf_monitor_sources,
                public.jf_monitor_inbox, public.jf_monitor_ai_tasks to authenticated;

-- 13. Seed (configuration only) ---------------------------------------
insert into jobbot.monitor_settings(owner_id, enabled, paused, interval_minutes, interval_preset, status, status_detail)
values ('f2729195-5445-4272-ab85-cac5b03b0967', false, false, 20, '20', 'not_configured',
        'Awaiting Gmail OAuth in Vault and a first successful real sync run')
on conflict (owner_id) do nothing;

insert into jobbot.monitor_sources(source_key, owner_id, display_name, adapter, capabilities, limitations, connection_status)
values
 ('gmail_linkedin_notifications','f2729195-5445-4272-ab85-cac5b03b0967','LinkedIn notification emails (Gmail API)',
  'edge_function_gmail_api',
  '{"connection_accepted":"display name + timestamp","message_digest":"count only","message_notification":"sender name + short preview when LinkedIn sends one","invitation_received":"name or count","incremental":"Gmail after:<cursor-overlap> + message-id dedupe"}',
  'Notifications only, never full DM text. Digest emails say "You have N new message(s)" without sender or text. Acceptance emails carry a display name only (name match needs review). No outbound history. Requires Gmail OAuth (gmail.readonly) refresh token in Supabase Vault.',
  'needs_auth'),
 ('manual_import','f2729195-5445-4272-ab85-cac5b03b0967','User-approved message import','dashboard_import',
  '{"full_text":"as pasted/approved by user"}','Requires the user to paste message text in the dashboard.','connected'),
 ('linkedin_official_messaging','f2729195-5445-4272-ab85-cac5b03b0967','LinkedIn official messaging API','none',
  '{}','Not available to this account: LinkedIn messaging APIs are restricted to approved partners; no connector installed.','unavailable')
on conflict (source_key) do nothing;

insert into jobbot.sync_cursors(owner_id, source_key)
values ('f2729195-5445-4272-ab85-cac5b03b0967','gmail_linkedin_notifications')
on conflict do nothing;

-- Random invoke token for cron -> edge function (generated in-DB; never written to any file).
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'jf_monitor_invoke_token') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'), 'jf_monitor_invoke_token',
                                'Shared secret: pg_cron tick -> linkedin-monitor edge function');
  end if;
end $$;
;
