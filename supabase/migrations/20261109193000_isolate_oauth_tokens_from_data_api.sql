-- ============================================================================
-- Migration: Complete Isolation of Third-Party OAuth Tokens from Supabase Data API & Privileged RPCs
-- Schema: jobbot & public
-- Purpose: 
--   1. Enforce strict least-privilege boundary: Third-party OAuth tokens (carrying client_id)
--      cannot directly query or mutate ANY jobbot tables or public views via PostgREST Data API.
--   2. Preserve full functionality for direct owner dashboard sessions (where client_id IS NULL).
--   3. Restrict privileged RPCs: All workflow mutation and management RPCs strictly reject OAuth tokens.
--      Only jf_owner_runtime_status remains callable by the approved Grok client (16bdb57f-c2cd-40d8-b6e1-c1a1b17e3f32).
--   4. Revoke EXECUTE from authenticated on legacy grok task RPCs.
--   5. Existing OAuth client consents (including Cursor) are preserved without modification.
-- Status: PROPOSED FOR OWNER APPROVAL (DO NOT APPLY AUTOMATICALLY)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- PART 1: APPLICATION RECORDS & DOCUMENTS
-- ----------------------------------------------------------------------------

-- 1. jobbot.job_applications
DROP POLICY IF EXISTS "jf_owner_read" ON jobbot.job_applications;
CREATE POLICY "jf_owner_read"
ON jobbot.job_applications
FOR SELECT
TO authenticated
USING (
    (SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid
    AND (auth.jwt()->>'client_id' IS NULL)
);

-- 2. jobbot.application_documents
DROP POLICY IF EXISTS "jf_owner_read" ON jobbot.application_documents;
CREATE POLICY "jf_owner_read"
ON jobbot.application_documents
FOR SELECT
TO authenticated
USING (
    (SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid
    AND (auth.jwt()->>'client_id' IS NULL)
);

-- 3. jobbot.application_events
DROP POLICY IF EXISTS "jf_owner_read" ON jobbot.application_events;
CREATE POLICY "jf_owner_read"
ON jobbot.application_events
FOR SELECT
TO authenticated
USING (
    (SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid
    AND (auth.jwt()->>'client_id' IS NULL)
);

-- 4. jobbot.job_opportunities
DROP POLICY IF EXISTS "jf_owner_read" ON jobbot.job_opportunities;
CREATE POLICY "jf_owner_read"
ON jobbot.job_opportunities
FOR SELECT
TO authenticated
USING (
    (SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid
    AND (auth.jwt()->>'client_id' IS NULL)
);

-- 5. jobbot.recruitment_review_items
DROP POLICY IF EXISTS "jf_owner_read_recruitment_review" ON jobbot.recruitment_review_items;
CREATE POLICY "jf_owner_read_recruitment_review"
ON jobbot.recruitment_review_items
FOR SELECT
TO authenticated
USING (
    (SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid
    AND (auth.jwt()->>'client_id' IS NULL)
);

-- ----------------------------------------------------------------------------
-- PART 2: GMAIL QUEUE & SYNC INFRASTRUCTURE
-- ----------------------------------------------------------------------------

-- 6. jobbot.gmail_processing_queue
DROP POLICY IF EXISTS "owner_access_gmail_processing_queue" ON jobbot.gmail_processing_queue;
CREATE POLICY "owner_access_gmail_processing_queue"
ON jobbot.gmail_processing_queue
FOR ALL
TO authenticated
USING (
    owner_id = auth.uid() 
    AND (auth.jwt()->>'client_id' IS NULL)
)
WITH CHECK (
    owner_id = auth.uid() 
    AND (auth.jwt()->>'client_id' IS NULL)
);

-- 7. jobbot.sync_cursors
DROP POLICY IF EXISTS "owner_read" ON jobbot.sync_cursors;
CREATE POLICY "owner_read"
ON jobbot.sync_cursors
FOR SELECT
TO authenticated
USING (
    owner_id = (SELECT auth.uid()) 
    AND (SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid
    AND (auth.jwt()->>'client_id' IS NULL)
);

-- 8. jobbot.sync_logs
DROP POLICY IF EXISTS "jf_owner_read_gmail_sync" ON jobbot.sync_logs;
CREATE POLICY "jf_owner_read_gmail_sync"
ON jobbot.sync_logs
FOR SELECT
TO authenticated
USING (
    (SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid 
    AND bot_name = 'Gmail Status Agent'::text
    AND (auth.jwt()->>'client_id' IS NULL)
);

-- ----------------------------------------------------------------------------
-- PART 3: MONITORING RECORDS & SETTINGS
-- ----------------------------------------------------------------------------

-- 9. jobbot.monitor_runs
DROP POLICY IF EXISTS "owner_read" ON jobbot.monitor_runs;
CREATE POLICY "owner_read"
ON jobbot.monitor_runs
FOR SELECT
TO authenticated
USING (
    owner_id = (SELECT auth.uid()) 
    AND (SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid
    AND (auth.jwt()->>'client_id' IS NULL)
);

-- 10. jobbot.monitor_settings
DROP POLICY IF EXISTS "owner_read" ON jobbot.monitor_settings;
CREATE POLICY "owner_read"
ON jobbot.monitor_settings
FOR SELECT
TO authenticated
USING (
    owner_id = (SELECT auth.uid()) 
    AND (SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid
    AND (auth.jwt()->>'client_id' IS NULL)
);

DROP POLICY IF EXISTS "owner_update" ON jobbot.monitor_settings;
CREATE POLICY "owner_update"
ON jobbot.monitor_settings
FOR UPDATE
TO authenticated
USING (
    owner_id = (SELECT auth.uid()) 
    AND (SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid
    AND (auth.jwt()->>'client_id' IS NULL)
)
WITH CHECK (
    owner_id = (SELECT auth.uid()) 
    AND (SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid
    AND (auth.jwt()->>'client_id' IS NULL)
);

-- 11. jobbot.monitor_sources
DROP POLICY IF EXISTS "owner_read" ON jobbot.monitor_sources;
CREATE POLICY "owner_read"
ON jobbot.monitor_sources
FOR SELECT
TO authenticated
USING (
    owner_id = (SELECT auth.uid()) 
    AND (SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid
    AND (auth.jwt()->>'client_id' IS NULL)
);

-- 12. jobbot.monitor_conversations
DROP POLICY IF EXISTS "owner_read" ON jobbot.monitor_conversations;
CREATE POLICY "owner_read"
ON jobbot.monitor_conversations
FOR SELECT
TO authenticated
USING (
    owner_id = (SELECT auth.uid()) 
    AND (SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid
    AND (auth.jwt()->>'client_id' IS NULL)
);

DROP POLICY IF EXISTS "owner_upsert" ON jobbot.monitor_conversations;
CREATE POLICY "owner_upsert"
ON jobbot.monitor_conversations
FOR INSERT
TO authenticated
WITH CHECK (
    owner_id = (SELECT auth.uid()) 
    AND (SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid 
    AND source_key = 'manual_import'::text
    AND (auth.jwt()->>'client_id' IS NULL)
);

-- 13. jobbot.monitor_inbound_events
DROP POLICY IF EXISTS "owner_read" ON jobbot.monitor_inbound_events;
CREATE POLICY "owner_read"
ON jobbot.monitor_inbound_events
FOR SELECT
TO authenticated
USING (
    owner_id = (SELECT auth.uid()) 
    AND (SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid
    AND (auth.jwt()->>'client_id' IS NULL)
);

DROP POLICY IF EXISTS "owner_insert" ON jobbot.monitor_inbound_events;
CREATE POLICY "owner_insert"
ON jobbot.monitor_inbound_events
FOR INSERT
TO authenticated
WITH CHECK (
    owner_id = (SELECT auth.uid()) 
    AND (SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid 
    AND source_key = 'manual_import'::text 
    AND run_id IS NULL
    AND (auth.jwt()->>'client_id' IS NULL)
);

DROP POLICY IF EXISTS "owner_update" ON jobbot.monitor_inbound_events;
CREATE POLICY "owner_update"
ON jobbot.monitor_inbound_events
FOR UPDATE
TO authenticated
USING (
    owner_id = (SELECT auth.uid()) 
    AND (SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid
    AND (auth.jwt()->>'client_id' IS NULL)
)
WITH CHECK (
    owner_id = (SELECT auth.uid()) 
    AND (SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid
    AND (auth.jwt()->>'client_id' IS NULL)
);

-- ----------------------------------------------------------------------------
-- PART 4: AI TASKS
-- ----------------------------------------------------------------------------

-- 14. jobbot.monitor_ai_tasks
DROP POLICY IF EXISTS "owner_read" ON jobbot.monitor_ai_tasks;
CREATE POLICY "owner_read"
ON jobbot.monitor_ai_tasks
FOR SELECT
TO authenticated
USING (
    owner_id = (SELECT auth.uid()) 
    AND (SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid
    AND (auth.jwt()->>'client_id' IS NULL)
);

DROP POLICY IF EXISTS "owner_insert" ON jobbot.monitor_ai_tasks;
CREATE POLICY "owner_insert"
ON jobbot.monitor_ai_tasks
FOR INSERT
TO authenticated
WITH CHECK (
    owner_id = (SELECT auth.uid()) 
    AND (SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid 
    AND state = 'pending'::text
    AND (auth.jwt()->>'client_id' IS NULL)
);

DROP POLICY IF EXISTS "owner_update" ON jobbot.monitor_ai_tasks;
CREATE POLICY "owner_update"
ON jobbot.monitor_ai_tasks
FOR UPDATE
TO authenticated
USING (
    owner_id = (SELECT auth.uid()) 
    AND (SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid
    AND (auth.jwt()->>'client_id' IS NULL)
)
WITH CHECK (
    owner_id = (SELECT auth.uid()) 
    AND (SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid
    AND (auth.jwt()->>'client_id' IS NULL)
);

-- ----------------------------------------------------------------------------
-- PART 5: LINKEDIN OUTREACH DATA
-- ----------------------------------------------------------------------------

-- 15. jobbot.outreach_action_revisions
DROP POLICY IF EXISTS "owner_read" ON jobbot.outreach_action_revisions;
CREATE POLICY "owner_read"
ON jobbot.outreach_action_revisions
FOR SELECT
TO authenticated
USING (
    owner_id = (SELECT auth.uid()) 
    AND (SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid
    AND (auth.jwt()->>'client_id' IS NULL)
);

DROP POLICY IF EXISTS "owner_insert" ON jobbot.outreach_action_revisions;
CREATE POLICY "owner_insert"
ON jobbot.outreach_action_revisions
FOR INSERT
TO authenticated
WITH CHECK (
    owner_id = (SELECT auth.uid()) 
    AND (SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid
    AND (auth.jwt()->>'client_id' IS NULL)
);

-- 16. jobbot.outreach_actions
DROP POLICY IF EXISTS "owner_read" ON jobbot.outreach_actions;
CREATE POLICY "owner_read"
ON jobbot.outreach_actions
FOR SELECT
TO authenticated
USING (
    owner_id = (SELECT auth.uid()) 
    AND (SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid
    AND (auth.jwt()->>'client_id' IS NULL)
);

DROP POLICY IF EXISTS "owner_insert" ON jobbot.outreach_actions;
CREATE POLICY "owner_insert"
ON jobbot.outreach_actions
FOR INSERT
TO authenticated
WITH CHECK (
    owner_id = (SELECT auth.uid()) 
    AND (SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid
    AND (auth.jwt()->>'client_id' IS NULL)
);

DROP POLICY IF EXISTS "owner_update" ON jobbot.outreach_actions;
CREATE POLICY "owner_update"
ON jobbot.outreach_actions
FOR UPDATE
TO authenticated
USING (
    owner_id = (SELECT auth.uid()) 
    AND (SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid
    AND (auth.jwt()->>'client_id' IS NULL)
)
WITH CHECK (
    owner_id = (SELECT auth.uid()) 
    AND (SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid
    AND (auth.jwt()->>'client_id' IS NULL)
);

-- 17. jobbot.outreach_approval_work
DROP POLICY IF EXISTS "owner_read" ON jobbot.outreach_approval_work;
CREATE POLICY "owner_read"
ON jobbot.outreach_approval_work
FOR SELECT
TO authenticated
USING (
    owner_id = (SELECT auth.uid()) 
    AND (SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid
    AND (auth.jwt()->>'client_id' IS NULL)
);

-- 18. jobbot.outreach_audit
DROP POLICY IF EXISTS "owner_read" ON jobbot.outreach_audit;
CREATE POLICY "owner_read"
ON jobbot.outreach_audit
FOR SELECT
TO authenticated
USING (
    owner_id = (SELECT auth.uid()) 
    AND (SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid
    AND (auth.jwt()->>'client_id' IS NULL)
);

-- 19. jobbot.outreach_contacts
DROP POLICY IF EXISTS "owner_read" ON jobbot.outreach_contacts;
CREATE POLICY "owner_read"
ON jobbot.outreach_contacts
FOR SELECT
TO authenticated
USING (
    owner_id = (SELECT auth.uid()) 
    AND (SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid
    AND (auth.jwt()->>'client_id' IS NULL)
);

DROP POLICY IF EXISTS "owner_insert" ON jobbot.outreach_contacts;
CREATE POLICY "owner_insert"
ON jobbot.outreach_contacts
FOR INSERT
TO authenticated
WITH CHECK (
    owner_id = (SELECT auth.uid()) 
    AND (SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid
    AND (auth.jwt()->>'client_id' IS NULL)
);

DROP POLICY IF EXISTS "owner_update" ON jobbot.outreach_contacts;
CREATE POLICY "owner_update"
ON jobbot.outreach_contacts
FOR UPDATE
TO authenticated
USING (
    owner_id = (SELECT auth.uid()) 
    AND (SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid
    AND (auth.jwt()->>'client_id' IS NULL)
)
WITH CHECK (
    owner_id = (SELECT auth.uid()) 
    AND (SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid
    AND (auth.jwt()->>'client_id' IS NULL)
);

-- 20. jobbot.outreach_decisions
DROP POLICY IF EXISTS "owner_read" ON jobbot.outreach_decisions;
CREATE POLICY "owner_read"
ON jobbot.outreach_decisions
FOR SELECT
TO authenticated
USING (
    owner_id = (SELECT auth.uid()) 
    AND (SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid
    AND (auth.jwt()->>'client_id' IS NULL)
);

DROP POLICY IF EXISTS "owner_insert" ON jobbot.outreach_decisions;
CREATE POLICY "owner_insert"
ON jobbot.outreach_decisions
FOR INSERT
TO authenticated
WITH CHECK (
    owner_id = (SELECT auth.uid()) 
    AND (SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid
    AND (auth.jwt()->>'client_id' IS NULL)
);

-- 21. jobbot.outreach_followups
DROP POLICY IF EXISTS "owner_read" ON jobbot.outreach_followups;
CREATE POLICY "owner_read"
ON jobbot.outreach_followups
FOR SELECT
TO authenticated
USING (
    owner_id = (SELECT auth.uid()) 
    AND (SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid
    AND (auth.jwt()->>'client_id' IS NULL)
);

DROP POLICY IF EXISTS "owner_insert" ON jobbot.outreach_followups;
CREATE POLICY "owner_insert"
ON jobbot.outreach_followups
FOR INSERT
TO authenticated
WITH CHECK (
    owner_id = (SELECT auth.uid()) 
    AND (SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid
    AND (auth.jwt()->>'client_id' IS NULL)
);

DROP POLICY IF EXISTS "owner_update" ON jobbot.outreach_followups;
CREATE POLICY "owner_update"
ON jobbot.outreach_followups
FOR UPDATE
TO authenticated
USING (
    owner_id = (SELECT auth.uid()) 
    AND (SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid
    AND (auth.jwt()->>'client_id' IS NULL)
)
WITH CHECK (
    owner_id = (SELECT auth.uid()) 
    AND (SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid
    AND (auth.jwt()->>'client_id' IS NULL)
);

-- 22. jobbot.outreach_interactions
DROP POLICY IF EXISTS "owner_read" ON jobbot.outreach_interactions;
CREATE POLICY "owner_read"
ON jobbot.outreach_interactions
FOR SELECT
TO authenticated
USING (
    owner_id = (SELECT auth.uid()) 
    AND (SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid
    AND (auth.jwt()->>'client_id' IS NULL)
);

DROP POLICY IF EXISTS "owner_insert" ON jobbot.outreach_interactions;
CREATE POLICY "owner_insert"
ON jobbot.outreach_interactions
FOR INSERT
TO authenticated
WITH CHECK (
    owner_id = (SELECT auth.uid()) 
    AND (SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid
    AND (auth.jwt()->>'client_id' IS NULL)
);

-- 23. jobbot.outreach_job_leads
DROP POLICY IF EXISTS "owner_read" ON jobbot.outreach_job_leads;
CREATE POLICY "owner_read"
ON jobbot.outreach_job_leads
FOR SELECT
TO authenticated
USING (
    owner_id = (SELECT auth.uid()) 
    AND (SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid
    AND (auth.jwt()->>'client_id' IS NULL)
);

DROP POLICY IF EXISTS "owner_insert" ON jobbot.outreach_job_leads;
CREATE POLICY "owner_insert"
ON jobbot.outreach_job_leads
FOR INSERT
TO authenticated
WITH CHECK (
    owner_id = (SELECT auth.uid()) 
    AND (SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid
    AND (auth.jwt()->>'client_id' IS NULL)
);

DROP POLICY IF EXISTS "owner_update" ON jobbot.outreach_job_leads;
CREATE POLICY "owner_update"
ON jobbot.outreach_job_leads
FOR UPDATE
TO authenticated
USING (
    owner_id = (SELECT auth.uid()) 
    AND (SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid
    AND (auth.jwt()->>'client_id' IS NULL)
)
WITH CHECK (
    owner_id = (SELECT auth.uid()) 
    AND (SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid
    AND (auth.jwt()->>'client_id' IS NULL)
);

-- 24. jobbot.outreach_owner_processing
DROP POLICY IF EXISTS "owner_read" ON jobbot.outreach_owner_processing;
CREATE POLICY "owner_read"
ON jobbot.outreach_owner_processing
FOR SELECT
TO authenticated
USING (
    owner_id = (SELECT auth.uid()) 
    AND (auth.jwt()->>'client_id' IS NULL)
);

-- 25. jobbot.outreach_webhook_config
DROP POLICY IF EXISTS "owner_read" ON jobbot.outreach_webhook_config;
CREATE POLICY "owner_read"
ON jobbot.outreach_webhook_config
FOR SELECT
TO authenticated
USING (
    owner_id = (SELECT auth.uid()) 
    AND (auth.jwt()->>'client_id' IS NULL)
);

-- 26. jobbot.outreach_webhook_dispatches
DROP POLICY IF EXISTS "owner_read" ON jobbot.outreach_webhook_dispatches;
CREATE POLICY "owner_read"
ON jobbot.outreach_webhook_dispatches
FOR SELECT
TO authenticated
USING (
    owner_id = (SELECT auth.uid()) 
    AND (auth.jwt()->>'client_id' IS NULL)
);

-- 27. jobbot.outreach_webhook_events
DROP POLICY IF EXISTS "owner_read" ON jobbot.outreach_webhook_events;
CREATE POLICY "owner_read"
ON jobbot.outreach_webhook_events
FOR SELECT
TO authenticated
USING (
    owner_id = (SELECT auth.uid()) 
    AND (auth.jwt()->>'client_id' IS NULL)
);

-- 28. jobbot.outreach_work_requests
DROP POLICY IF EXISTS "owner_read" ON jobbot.outreach_work_requests;
CREATE POLICY "owner_read"
ON jobbot.outreach_work_requests
FOR SELECT
TO authenticated
USING (
    owner_id = (SELECT auth.uid()) 
    AND (SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid
    AND (auth.jwt()->>'client_id' IS NULL)
);

DROP POLICY IF EXISTS "owner_insert" ON jobbot.outreach_work_requests;
CREATE POLICY "owner_insert"
ON jobbot.outreach_work_requests
FOR INSERT
TO authenticated
WITH CHECK (
    owner_id = (SELECT auth.uid()) 
    AND (SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid
    AND (auth.jwt()->>'client_id' IS NULL)
);

DROP POLICY IF EXISTS "owner_update" ON jobbot.outreach_work_requests;
CREATE POLICY "owner_update"
ON jobbot.outreach_work_requests
FOR UPDATE
TO authenticated
USING (
    owner_id = (SELECT auth.uid()) 
    AND (SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid
    AND (auth.jwt()->>'client_id' IS NULL)
)
WITH CHECK (
    owner_id = (SELECT auth.uid()) 
    AND (SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid
    AND (auth.jwt()->>'client_id' IS NULL)
);

-- ----------------------------------------------------------------------------
-- PART 6: PRIVILEGED RPC RESTRICTIONS
-- ----------------------------------------------------------------------------

-- 1. public.jf_owner_runtime_status (READ-ONLY: Allowed for First-Party & Approved Grok Client)
CREATE OR REPLACE FUNCTION public.jf_owner_runtime_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE cfg jobbot.outreach_webhook_config; m jobbot.monitor_settings; cid text;
BEGIN
 PERFORM jobbot.require_owner_processing_auth();
 cid := auth.jwt()->>'client_id';
 -- If client_id is present, it MUST be the explicitly approved Grok client ID
 IF cid IS NOT NULL AND cid != '16bdb57f-c2cd-40d8-b6e1-c1a1b17e3f32' THEN
   RAISE EXCEPTION 'Unauthorized OAuth client';
 END IF;
 SELECT * INTO cfg FROM jobbot.outreach_webhook_config WHERE owner_id=(SELECT auth.uid());
 SELECT * INTO m FROM jobbot.monitor_settings WHERE owner_id=(SELECT auth.uid());
 IF cfg.owner_id IS NULL OR m.owner_id IS NULL THEN RAISE EXCEPTION 'Runtime configuration unavailable'; END IF;
 RETURN jsonb_build_object('owner_user_id',(SELECT auth.uid()),'request_role',current_setting('role',true),
  'oauth_client_id',cid,'owner_session_checked',true,
  'work_dispatch_enabled',cfg.enabled,'ai_dispatch_enabled',m.ai_dispatch_enabled,
  'gmail_enabled',m.enabled,'gmail_paused',m.paused,'gmail_poll_minutes',m.poll_interval_minutes,
  'fixture_allowlist_empty',NOT EXISTS(SELECT 1 FROM jobbot.outreach_owner_test_allowlist),
  'execution_mode','authentication_only');
END $function$;

-- 2. public.jf_owner_claim_work (WORKFLOW MUTATION: Rejects all OAuth tokens)
CREATE OR REPLACE FUNCTION public.jf_owner_claim_work(p_work_id uuid, p_revision_id uuid, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE w jobbot.outreach_approval_work; r jobbot.outreach_action_revisions; a jobbot.outreach_actions;
 x jobbot.outreach_owner_processing; d jobbot.outreach_webhook_dispatches;
BEGIN
 IF (auth.jwt()->>'client_id') IS NOT NULL THEN
   RAISE EXCEPTION 'OAuth tokens are not permitted to invoke work mutation functions';
 END IF;
 PERFORM jobbot.require_owner_processing_auth();
 PERFORM 1 FROM jobbot.outreach_owner_test_allowlist f
 WHERE f.work_id=p_work_id AND f.revision_id=p_revision_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Fixture not allowlisted'; END IF;
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'Explicit request required'; END IF;
 w:=jobbot.webhook_validate_work(p_work_id,ARRAY['queued','verification_required','manual_action_required','failed']);
 IF w.revision_id IS DISTINCT FROM p_revision_id THEN RAISE EXCEPTION 'Revision mismatch'; END IF;
 SELECT * INTO r FROM jobbot.outreach_action_revisions WHERE id=w.revision_id;
 SELECT * INTO a FROM jobbot.outreach_actions WHERE id=w.action_id;
 SELECT * INTO x FROM jobbot.outreach_owner_processing WHERE work_id=w.id;
 IF x.work_id IS NOT NULL THEN
  IF x.request_id IS DISTINCT FROM p_request_id THEN RETURN jsonb_build_object('status','already_claimed'); END IF;
  RETURN jsonb_build_object('status',CASE WHEN x.completed_at IS NULL THEN 'claimed' ELSE 'already_completed' END,
   'work_id',w.id,'revision_id',x.revision_id,'claim_id',x.claim_id,'action_type',a.action_type,'channel',a.channel,'contact_id',a.contact_id,'body',r.body,'target',r.target_snapshot,
   'target_url',r.target_url,'document_id',r.document_id,'document_sha256',r.document_sha256,'execution_mode','manual_only');
 END IF;
 IF w.state<>'queued' THEN RAISE EXCEPTION 'Work is not queued'; END IF;
 SELECT * INTO d FROM jobbot.outreach_webhook_dispatches WHERE work_id=w.id FOR UPDATE;
 IF d.id IS NULL OR d.state<>'pending' OR d.attempts<>0 OR d.dry_run THEN RAISE EXCEPTION 'Work reserved by another path'; END IF;
 IF EXISTS(SELECT 1 FROM jobbot.outreach_owner_processing WHERE request_id=p_request_id) THEN RAISE EXCEPTION 'Request already used'; END IF;
 INSERT INTO jobbot.outreach_owner_processing(work_id,owner_id,revision_id,request_id)
 VALUES(w.id,w.owner_id,w.revision_id,p_request_id) RETURNING * INTO x;
 UPDATE jobbot.outreach_approval_work SET state='verification_required',execution_started_at=now() WHERE id=w.id;
 INSERT INTO jobbot.outreach_webhook_events(owner_id,event_code,actor_id,actor_kind,correlation_id)
 VALUES(w.owner_id,'owner_processing_claimed',(SELECT auth.uid()),'owner',x.claim_id);
 RETURN jsonb_build_object('status','claimed','work_id',w.id,'revision_id',r.id,'claim_id',x.claim_id,
 'action_type',a.action_type,'channel',a.channel,'contact_id',a.contact_id,'body',r.body,'target',r.target_snapshot,'target_url',r.target_url,'document_id',r.document_id,
 'document_sha256',r.document_sha256,'execution_mode','manual_only');
END $function$;

-- 3. public.jf_owner_complete_work (WORKFLOW MUTATION: Rejects all OAuth tokens)
CREATE OR REPLACE FUNCTION public.jf_owner_complete_work(p_work_id uuid, p_revision_id uuid, p_claim_id uuid, p_outcome text, p_receipt_reference text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE w jobbot.outreach_approval_work; x jobbot.outreach_owner_processing;
BEGIN
 IF (auth.jwt()->>'client_id') IS NOT NULL THEN
   RAISE EXCEPTION 'OAuth tokens are not permitted to invoke work mutation functions';
 END IF;
 PERFORM jobbot.require_owner_processing_auth();
 PERFORM 1 FROM jobbot.outreach_owner_test_allowlist f
 WHERE f.work_id=p_work_id AND f.revision_id=p_revision_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Fixture not allowlisted'; END IF;
 w:=jobbot.webhook_validate_work(p_work_id,ARRAY['verification_required','manual_action_required','failed']);
 IF w.revision_id IS DISTINCT FROM p_revision_id OR p_outcome IS NULL
 OR p_outcome NOT IN ('manual_action_required','verification_required','failed')
 OR coalesce(length(trim(p_receipt_reference)),0) NOT BETWEEN 1 AND 240
 OR p_receipt_reference ~* '(bearer[[:space:]]|sb_secret_|service_role|access_token=|token=|key=)'
 THEN RAISE EXCEPTION 'Invalid completion'; END IF;
 SELECT * INTO x FROM jobbot.outreach_owner_processing WHERE work_id=w.id FOR UPDATE;
 IF x.work_id IS NULL OR x.revision_id IS DISTINCT FROM p_revision_id OR x.claim_id IS DISTINCT FROM p_claim_id
 OR p_claim_id IS NULL OR x.owner_id IS DISTINCT FROM (SELECT auth.uid()) THEN RAISE EXCEPTION 'Claim mismatch'; END IF;
 IF x.completed_at IS NOT NULL THEN
  IF x.outcome=p_outcome AND x.receipt_reference=trim(p_receipt_reference) THEN RETURN x.claim_id; END IF;
  RAISE EXCEPTION 'Conflicting completion';
 END IF;
 UPDATE jobbot.outreach_owner_processing SET completed_at=now(),outcome=p_outcome,receipt_reference=trim(p_receipt_reference) WHERE work_id=w.id;
 UPDATE jobbot.outreach_approval_work SET state=p_outcome,acknowledged_at=now() WHERE id=w.id;
 INSERT INTO jobbot.outreach_webhook_events(owner_id,event_code,actor_id,actor_kind,correlation_id)
 VALUES(w.owner_id,'owner_processing_completed',(SELECT auth.uid()),'owner',x.claim_id);
 RETURN x.claim_id;
END $function$;

-- 4. public.jf_configure_work_webhook (MANAGEMENT RPC: Rejects all OAuth tokens)
CREATE OR REPLACE FUNCTION public.jf_configure_work_webhook(p_host text, p_header text, p_auth_mode text, p_processor_user_id uuid, p_panel_verified boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF (auth.jwt()->>'client_id') IS NOT NULL THEN
   RAISE EXCEPTION 'OAuth tokens are not permitted to invoke configuration functions';
 END IF;
 IF current_setting('role', true) != 'service_role' AND (auth.jwt()->>'role') != 'service_role' THEN
   IF (SELECT auth.uid()) IS DISTINCT FROM 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid THEN RAISE EXCEPTION 'Owner required'; END IF;
 END IF;
 IF p_host IS NULL OR p_header IS NULL OR p_auth_mode IS NULL OR p_host !~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$' OR p_host NOT LIKE '%.%' OR p_header !~ '^[A-Za-z][A-Za-z0-9-]{0,63}$' OR lower(p_header) IN ('host','content-type','content-length','cookie') OR p_auth_mode NOT IN ('bearer','raw') OR p_panel_verified IS DISTINCT FROM true OR p_processor_user_id IS NULL OR p_processor_user_id=(SELECT auth.uid()) THEN RAISE EXCEPTION 'Verified panel settings and a separate processor identity required'; END IF;
 UPDATE jobbot.outreach_webhook_config SET webhook_host=p_host,header_name=p_header,auth_mode=p_auth_mode,processor_user_id=p_processor_user_id,panel_auth_verified=true,enabled=false,updated_at=now() WHERE owner_id=(SELECT auth.uid());
 INSERT INTO jobbot.outreach_webhook_events(owner_id,event_code,actor_id,actor_kind) VALUES((SELECT auth.uid()),'configuration_saved_disabled',(SELECT auth.uid()),'owner');
END $function$;

-- 5. public.jf_bind_work_processor (MANAGEMENT RPC: Rejects all OAuth tokens)
CREATE OR REPLACE FUNCTION public.jf_bind_work_processor(p_processor_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE cfg jobbot.outreach_webhook_config;
BEGIN
 IF (auth.jwt()->>'client_id') IS NOT NULL THEN
   RAISE EXCEPTION 'OAuth tokens are not permitted to invoke processor binding functions';
 END IF;
 IF (SELECT auth.uid()) IS DISTINCT FROM 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid THEN
  RAISE EXCEPTION 'Owner required';
 END IF;
 SELECT * INTO cfg FROM jobbot.outreach_webhook_config
 WHERE owner_id=(SELECT auth.uid()) FOR UPDATE;
 IF cfg.owner_id IS NULL THEN RAISE EXCEPTION 'Configuration unavailable'; END IF;
 IF cfg.enabled OR EXISTS(SELECT 1 FROM jobbot.monitor_settings WHERE owner_id=cfg.owner_id AND ai_dispatch_enabled) THEN
  RAISE EXCEPTION 'Disable webhook and AI dispatch before rebinding processor';
 END IF;
 UPDATE jobbot.outreach_webhook_config
 SET processor_user_id=p_processor_user_id,panel_auth_verified=false,enabled=false,updated_at=now()
 WHERE owner_id=cfg.owner_id;
 INSERT INTO jobbot.outreach_webhook_events(owner_id,event_code,actor_id,actor_kind)
 VALUES(cfg.owner_id,'processor_bound_disabled',(SELECT auth.uid()),'owner');
END $function$;

-- 6. public.jf_confirm_outreach_sent (WORKFLOW MUTATION: Rejects all OAuth tokens)
CREATE OR REPLACE FUNCTION public.jf_confirm_outreach_sent(p_work_id uuid, p_revision_id uuid, p_sent_at timestamp with time zone, p_evidence_source text, p_evidence_ref text, p_recipient_confirmed boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE w jobbot.outreach_approval_work; a jobbot.outreach_actions; r jobbot.outreach_action_revisions; event_kind text; old_event uuid; evidence text;
BEGIN
 IF (auth.jwt()->>'client_id') IS NOT NULL THEN
   RAISE EXCEPTION 'OAuth tokens are not permitted to invoke confirmation functions';
 END IF;
 IF current_setting('role', true) != 'service_role' AND (auth.jwt()->>'role') != 'service_role' THEN
   IF (SELECT auth.uid()) IS DISTINCT FROM 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid THEN RAISE EXCEPTION 'Owner required'; END IF;
 END IF;
 w:=jobbot.webhook_validate_work(p_work_id,ARRAY['manual_action_required','verification_required','sent_verified']);
 IF w.revision_id IS DISTINCT FROM p_revision_id THEN RAISE EXCEPTION 'Revision mismatch'; END IF;
 IF p_recipient_confirmed IS DISTINCT FROM true OR p_sent_at IS NULL OR p_sent_at<w.approved_at OR p_sent_at>now() THEN RAISE EXCEPTION 'Confirm recipient and actual delivery time'; END IF;
 IF p_evidence_source IS NULL OR p_evidence_source NOT IN ('linkedin_sent_view','linkedin_export','authorized_provider_receipt') OR coalesce(length(trim(p_evidence_ref)),0)<8 OR length(p_evidence_ref)>1000 OR p_evidence_ref ~* '(bearer[[:space:]]|sb_secret_|service_role|access_token=|token=|key=)' THEN RAISE EXCEPTION 'Credible delivery evidence required; no credentials'; END IF;
 evidence:=p_evidence_source||':'||trim(p_evidence_ref);
 SELECT * INTO a FROM jobbot.outreach_actions WHERE id=w.action_id;
 event_kind:=CASE a.action_type WHEN 'connect' THEN 'linkedin_connection_sent' WHEN 'message' THEN 'linkedin_message_sent' WHEN 'inmail' THEN 'linkedin_inmail_sent' ELSE 'outreach_sent' END;
 INSERT INTO jobbot.outreach_interactions(owner_id,contact_id,action_id,revision_id,event_type,channel,direction,message_summary,event_at,verification,evidence_source,evidence_ref,application_id,external_key)
 VALUES(w.owner_id,a.contact_id,w.action_id,w.revision_id,event_kind,a.channel,'outbound',left(coalesce(r.body,''),280),p_sent_at,'verified',p_evidence_source,p_evidence_ref,r.application_id,a.action_type||':'||w.id::text)
 RETURNING id INTO old_event;
 UPDATE jobbot.outreach_approval_work SET state='sent_verified',executed_at=p_sent_at,acknowledged_at=now(),result_evidence=evidence WHERE id=w.id;
 INSERT INTO jobbot.outreach_webhook_events(owner_id,event_code,actor_id,actor_kind,correlation_id)
 VALUES(w.owner_id,'outreach_delivery_confirmed',(SELECT auth.uid()),'owner',w.id);
 RETURN w.id;
END $function$;

-- 7. public.jf_retry_rejected_work_webhook (MANAGEMENT RPC: Rejects all OAuth tokens)
CREATE OR REPLACE FUNCTION public.jf_retry_rejected_work_webhook(p_dispatch_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE d jobbot.outreach_webhook_dispatches;
BEGIN
 IF (auth.jwt()->>'client_id') IS NOT NULL THEN
   RAISE EXCEPTION 'OAuth tokens are not permitted to invoke retry functions';
 END IF;
 IF current_setting('role', true) != 'service_role' AND (auth.jwt()->>'role') != 'service_role' THEN
   IF (SELECT auth.uid()) IS DISTINCT FROM 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid THEN RAISE EXCEPTION 'Owner required'; END IF;
 END IF;
 SELECT * INTO d FROM jobbot.outreach_webhook_dispatches WHERE id=p_dispatch_id AND owner_id=(SELECT auth.uid());
 IF d.id IS NULL THEN RAISE EXCEPTION 'Dispatch unavailable'; END IF;
 PERFORM jobbot.webhook_validate_work(d.work_id,ARRAY['queued']);
 SELECT * INTO d FROM jobbot.outreach_webhook_dispatches WHERE id=p_dispatch_id FOR UPDATE;
 IF d.state<>'rejected' OR d.attempts>=3 THEN RAISE EXCEPTION 'Retry requires a definite rejection and remaining attempts'; END IF;
 UPDATE jobbot.outreach_webhook_dispatches SET state='pending',http_status=NULL WHERE id=d.id;
END $function$;

-- 8. public.jf_wake_pending_work_webhook (MANAGEMENT RPC: Rejects all OAuth tokens)
CREATE OR REPLACE FUNCTION public.jf_wake_pending_work_webhook(p_dispatch_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE d jobbot.outreach_webhook_dispatches;
BEGIN
 IF (auth.jwt()->>'client_id') IS NOT NULL THEN
   RAISE EXCEPTION 'OAuth tokens are not permitted to invoke webhook wake functions';
 END IF;
 IF current_setting('role', true) != 'service_role' AND (auth.jwt()->>'role') != 'service_role' THEN
   IF (SELECT auth.uid()) IS DISTINCT FROM 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid THEN RAISE EXCEPTION 'Owner required'; END IF;
 END IF;
 SELECT * INTO d FROM jobbot.outreach_webhook_dispatches WHERE id=p_dispatch_id AND owner_id=(SELECT auth.uid());
 IF d.id IS NULL OR d.state<>'pending' THEN RAISE EXCEPTION 'Pending dispatch required'; END IF;
 PERFORM jobbot.webhook_validate_work(d.work_id,ARRAY['queued']);
 PERFORM jobbot.webhook_signal(d.id);
END $function$;

-- 9. public.jf_acknowledge_outreach_manual (MANAGEMENT RPC: Rejects all OAuth tokens)
CREATE OR REPLACE FUNCTION public.jf_acknowledge_outreach_manual(p_work_id uuid, p_revision_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE result uuid;
BEGIN
 IF (auth.jwt()->>'client_id') IS NOT NULL THEN
   RAISE EXCEPTION 'OAuth tokens are not permitted to invoke manual outreach acknowledgment functions';
 END IF;
 IF (SELECT auth.uid()) IS DISTINCT FROM 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid THEN RAISE EXCEPTION 'Owner required'; END IF;
 SELECT jobbot.acknowledge_outreach_manual(p_work_id,p_revision_id) INTO result;
 RETURN result;
END $function$;

-- 10. public.jf_outreach_create_draft (MANAGEMENT RPC: Rejects all OAuth tokens)
CREATE OR REPLACE FUNCTION public.jf_outreach_create_draft(p_contact_id uuid, p_action_type text, p_channel text, p_target text, p_target_url text, p_body text, p_reason text, p_context text, p_document_id uuid, p_document_sha256 text, p_application_id uuid, p_opportunity_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare new_action uuid;
begin
 if (auth.jwt()->>'client_id') is not null then
   raise exception 'OAuth tokens are not permitted to invoke draft creation functions';
 end if;
 if (select auth.uid()) is distinct from 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid then raise exception 'Unauthorized'; end if;
 insert into jobbot.outreach_actions(contact_id,action_type,channel) values(p_contact_id,p_action_type,p_channel) returning id into new_action;
 insert into jobbot.outreach_action_revisions(action_id,target_snapshot,target_url,body,reason,context_summary,document_id,document_sha256,application_id,opportunity_id)
 values(new_action,p_target,p_target_url,coalesce(p_body,''),p_reason,p_context,p_document_id,p_document_sha256,p_application_id,p_opportunity_id);
 return new_action;
end $function$;

-- 11. public.jf_monitor_set_enabled (MANAGEMENT RPC: Rejects all OAuth tokens)
CREATE OR REPLACE FUNCTION public.jf_monitor_set_enabled(p_enabled boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r jobbot.monitor_settings;
begin
  if (auth.jwt()->>'client_id') is not null then
    raise exception 'OAuth tokens are not permitted to invoke monitor management functions';
  end if;
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
end $function$;

-- 12. Revoke EXECUTE on legacy / probe / AI test RPCs from authenticated
REVOKE EXECUTE ON FUNCTION public.jf_grok_claim_ai_task(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.jf_grok_claim_work(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.jf_grok_complete_ai_task(uuid, uuid, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.jf_grok_complete_work(uuid, uuid, uuid, text, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.jf_grok_ack_probe(uuid, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.jf_grok_runtime_status() FROM authenticated;
