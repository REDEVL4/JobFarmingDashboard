-- ============================================================================
-- Migration: Grant outreach_proposals access and expose public views for dashboard
-- Purpose:
--   Allow authenticated owner dashboard sessions to read and update
--   jobbot.outreach_proposals via Supabase PostgREST data API.
-- ============================================================================

-- 1. Ensure authenticated has usage on jobbot schema
GRANT USAGE ON SCHEMA jobbot TO authenticated;

-- 2. Grant table-level permissions to authenticated role
GRANT SELECT, UPDATE ON jobbot.outreach_proposals TO authenticated;

-- 3. Configure Row-Level Security on jobbot.outreach_proposals
ALTER TABLE jobbot.outreach_proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "jf_owner_read_outreach_proposals" ON jobbot.outreach_proposals;
CREATE POLICY "jf_owner_read_outreach_proposals"
ON jobbot.outreach_proposals
FOR SELECT
TO authenticated
USING (
    (owner_id = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid OR auth.uid() = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid)
    AND (auth.jwt()->>'client_id' IS NULL)
);

DROP POLICY IF EXISTS "jf_owner_update_outreach_proposals" ON jobbot.outreach_proposals;
CREATE POLICY "jf_owner_update_outreach_proposals"
ON jobbot.outreach_proposals
FOR UPDATE
TO authenticated
USING (
    (owner_id = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid OR auth.uid() = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid)
    AND (auth.jwt()->>'client_id' IS NULL)
)
WITH CHECK (
    (owner_id = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid OR auth.uid() = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid)
    AND (auth.jwt()->>'client_id' IS NULL)
);

-- 4. Create public views so PostgREST (which exposes public schema) can access outreach_proposals
CREATE OR REPLACE VIEW public.jf_outreach_proposals WITH (security_invoker = true) AS
SELECT * FROM jobbot.outreach_proposals;

CREATE OR REPLACE VIEW public.outreach_proposals WITH (security_invoker = true) AS
SELECT * FROM jobbot.outreach_proposals;

REVOKE ALL ON public.jf_outreach_proposals, public.outreach_proposals FROM PUBLIC, anon;
GRANT SELECT, UPDATE ON public.jf_outreach_proposals TO authenticated;
GRANT SELECT, UPDATE ON public.outreach_proposals TO authenticated;

