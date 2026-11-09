-- ============================================================================
-- Migration: Isolate Third-Party OAuth Client Tokens from Direct Supabase Data API
-- Schema: jobbot
-- Purpose: Ensure third-party OAuth access tokens (which carry client_id) cannot
--          directly query or mutate jobbot tables/views via PostgREST Data API,
--          while preserving full access for direct owner dashboard sessions (client_id IS NULL).
-- Status: PROPOSED FOR OWNER APPROVAL (DO NOT APPLY AUTOMATICALLY)
-- ============================================================================

-- 1. jobbot.gmail_processing_queue
-- Existing policy permits owner_id = auth.uid() regardless of client_id.
-- Restrict direct PostgREST access to first-party owner sessions only.
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

-- 2. jobbot.job_applications
-- Restrict direct SELECT to first-party owner sessions.
DROP POLICY IF EXISTS "jf_owner_read" ON jobbot.job_applications;

CREATE POLICY "jf_owner_read"
ON jobbot.job_applications
FOR SELECT
TO authenticated
USING (
    (SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid
    AND (auth.jwt()->>'client_id' IS NULL)
);

-- 3. jobbot.application_events
-- Restrict direct SELECT to first-party owner sessions.
DROP POLICY IF EXISTS "jf_owner_read" ON jobbot.application_events;

CREATE POLICY "jf_owner_read"
ON jobbot.application_events
FOR SELECT
TO authenticated
USING (
    (SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid
    AND (auth.jwt()->>'client_id' IS NULL)
);

-- 4. jobbot.recruitment_review_items
-- Restrict direct SELECT to first-party owner sessions.
DROP POLICY IF EXISTS "jf_owner_read_recruitment_review" ON jobbot.recruitment_review_items;

CREATE POLICY "jf_owner_read_recruitment_review"
ON jobbot.recruitment_review_items
FOR SELECT
TO authenticated
USING (
    (SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid
    AND (auth.jwt()->>'client_id' IS NULL)
);

