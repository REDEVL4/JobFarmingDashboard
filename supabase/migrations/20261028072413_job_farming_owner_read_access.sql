-- DRAFT ONLY. Do not execute until f2729195-5445-4272-ab85-cac5b03b0967 is replaced with the verified
-- Supabase Auth user ID and the deployment, exposed schema, and grants are reviewed.
-- The connector's existing tables and data must remain unchanged.
BEGIN;
GRANT USAGE ON SCHEMA jobbot TO authenticated;
GRANT SELECT ON jobbot.job_opportunities, jobbot.job_applications, jobbot.application_events, jobbot.application_documents TO authenticated;
CREATE POLICY jf_owner_read ON jobbot.job_opportunities FOR SELECT TO authenticated USING ((SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid);
CREATE POLICY jf_owner_read ON jobbot.job_applications FOR SELECT TO authenticated USING ((SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid);
CREATE POLICY jf_owner_read ON jobbot.application_events FOR SELECT TO authenticated USING ((SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid);
CREATE POLICY jf_owner_read ON jobbot.application_documents FOR SELECT TO authenticated USING ((SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid);
CREATE POLICY jf_owner_documents_read ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'jobbot-application-docs' AND (SELECT auth.uid()) = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid);
-- Security-invoker views retain underlying RLS. The precisely identified smoke
-- fixture is excluded without excluding real job titles containing 'test'.
CREATE VIEW public.jf_opportunities WITH (security_invoker = true) AS
 SELECT * FROM jobbot.job_opportunities WHERE external_key <> 'test:phase3:TEST-REQ-001';
CREATE VIEW public.jf_applications WITH (security_invoker = true) AS
 SELECT a.* FROM jobbot.job_applications a JOIN jobbot.job_opportunities o ON o.id=a.opportunity_id WHERE o.external_key <> 'test:phase3:TEST-REQ-001';
CREATE VIEW public.jf_events WITH (security_invoker = true) AS
 SELECT e.* FROM jobbot.application_events e JOIN jobbot.job_applications a ON a.id=e.application_id JOIN jobbot.job_opportunities o ON o.id=a.opportunity_id WHERE o.external_key <> 'test:phase3:TEST-REQ-001';
CREATE VIEW public.jf_documents WITH (security_invoker = true) AS
 SELECT d.* FROM jobbot.application_documents d JOIN jobbot.job_applications a ON a.id=d.application_id JOIN jobbot.job_opportunities o ON o.id=a.opportunity_id WHERE o.external_key <> 'test:phase3:TEST-REQ-001';
REVOKE ALL ON public.jf_opportunities, public.jf_applications, public.jf_events, public.jf_documents FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.jf_opportunities, public.jf_applications, public.jf_events, public.jf_documents TO authenticated;
COMMIT;
-- Verify with distinct owner, non-owner, and anonymous JWTs, including Storage
-- signed URLs, before a production deployment. Never rely on SQL role simulation
-- alone as proof of the end-to-end behavior. Run Supabase security advisors.
;
