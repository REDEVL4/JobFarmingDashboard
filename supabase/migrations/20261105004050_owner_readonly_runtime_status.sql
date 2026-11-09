-- REVIEW ONLY: new read-only RPC; do not apply without separate approval.
BEGIN;
CREATE FUNCTION public.jf_owner_runtime_status() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cfg jobbot.outreach_webhook_config; m jobbot.monitor_settings;
BEGIN
 PERFORM jobbot.require_owner_processing_auth();
 SELECT * INTO cfg FROM jobbot.outreach_webhook_config WHERE owner_id=(SELECT auth.uid());
 SELECT * INTO m FROM jobbot.monitor_settings WHERE owner_id=(SELECT auth.uid());
 IF cfg.owner_id IS NULL OR m.owner_id IS NULL THEN RAISE EXCEPTION 'Runtime configuration unavailable'; END IF;
 RETURN jsonb_build_object('owner_user_id',(SELECT auth.uid()),'request_role',current_setting('role',true),
  'oauth_client_id',auth.jwt()->>'client_id','owner_session_checked',true,
  'work_dispatch_enabled',cfg.enabled,'ai_dispatch_enabled',m.ai_dispatch_enabled,
  'gmail_enabled',m.enabled,'gmail_paused',m.paused,'gmail_poll_minutes',m.poll_interval_minutes,
  'fixture_allowlist_empty',NOT EXISTS(SELECT 1 FROM jobbot.outreach_owner_test_allowlist),
  'execution_mode','authentication_only');
END $$;
REVOKE ALL ON FUNCTION public.jf_owner_runtime_status() FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.jf_owner_runtime_status() TO authenticated;
COMMIT;
;
