-- ============================================================================
-- Migration: Refresh public.jf_outreach_proposals view for attachment_path
-- Purpose:
--   Refresh the public.jf_outreach_proposals and public.outreach_proposals views
--   so PostgREST projects the new attachment_path column added to jobbot.outreach_proposals.
-- ============================================================================

CREATE OR REPLACE VIEW public.jf_outreach_proposals WITH (security_invoker = true) AS
SELECT * FROM jobbot.outreach_proposals;

CREATE OR REPLACE VIEW public.outreach_proposals WITH (security_invoker = true) AS
SELECT * FROM jobbot.outreach_proposals;

REVOKE ALL ON public.jf_outreach_proposals, public.outreach_proposals FROM PUBLIC, anon;
GRANT SELECT, UPDATE ON public.jf_outreach_proposals TO authenticated;
GRANT SELECT, UPDATE ON public.outreach_proposals TO authenticated;
