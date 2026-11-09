-- ============================================================================
-- Migration: Complete Isolation of Third-Party OAuth Tokens from Supabase Data API
-- Schema: jobbot & public
-- Purpose: 
--   1. Enforce strict least-privilege boundary: Third-party OAuth tokens (carrying client_id)
--      cannot directly query or mutate ANY jobbot tables or public views via PostgREST Data API.
--   2. Preserve full functionality for direct owner dashboard sessions (where client_id IS NULL).
--   3. Revoke EXECUTE from authenticated on legacy grok task RPCs.
--   4. Revoke existing unauthorized / unapproved OAuth client consent grants in auth.oauth_consents
--      while preserving legitimate owner sessions (auth.sessions).
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
-- PART 6: LEAST-PRIVILEGE RPC RESTRICTIONS
-- Revoke EXECUTE on legacy / probe / AI test RPCs from authenticated
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.jf_grok_claim_ai_task(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.jf_grok_claim_work(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.jf_grok_complete_ai_task(uuid, uuid, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.jf_grok_complete_work(uuid, uuid, uuid, text, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.jf_grok_ack_probe(uuid, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.jf_grok_runtime_status() FROM authenticated;

-- ----------------------------------------------------------------------------
-- PART 7: REVOKE UNAPPROVED HISTORICAL CLIENT CONSENTS
-- Revoke existing Cursor client consents in auth.oauth_consents
-- Leaves active owner sessions (auth.sessions) completely intact
-- ----------------------------------------------------------------------------
UPDATE auth.oauth_consents 
SET revoked_at = now() 
WHERE client_id != '16bdb57f-c2cd-40d8-b6e1-c1a1b17e3f32' 
  AND revoked_at IS NULL;
