-- Rollback Migration: 20261109230000_permanent_grok_dynamic_oauth_rollback.sql
-- Restores jf_owner_runtime_status to baseline 20261109193000 definition

DROP FUNCTION IF EXISTS public.jf_validate_grok_oauth_client(uuid);
DROP FUNCTION IF EXISTS jobbot.validate_grok_oauth_client(uuid, uuid);

CREATE OR REPLACE FUNCTION public.jf_owner_runtime_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  cfg jobbot.outreach_webhook_config;
  m jobbot.monitor_settings;
  v_client_id text;
BEGIN
  v_client_id := auth.jwt()->>'client_id';
  IF v_client_id IS NOT NULL AND v_client_id != '16bdb57f-c2cd-40d8-b6e1-c1a1b17e3f32' THEN
    RAISE EXCEPTION 'Unauthorized OAuth client: %', v_client_id;
  END IF;
  PERFORM jobbot.require_owner_processing_auth();
  SELECT * INTO cfg FROM jobbot.outreach_webhook_config WHERE owner_id=(SELECT auth.uid());
  SELECT * INTO m FROM jobbot.monitor_settings WHERE owner_id=(SELECT auth.uid());
  IF cfg.owner_id IS NULL OR m.owner_id IS NULL THEN
    RAISE EXCEPTION 'Runtime configuration unavailable';
  END IF;
  RETURN jsonb_build_object(
    'owner_user_id', (SELECT auth.uid()),
    'request_role', current_setting('role', true),
    'oauth_client_id', auth.jwt()->>'client_id',
    'owner_session_checked', true,
    'work_dispatch_enabled', cfg.enabled,
    'ai_dispatch_enabled', m.ai_dispatch_enabled,
    'gmail_enabled', m.enabled,
    'gmail_paused', m.paused,
    'gmail_poll_minutes', m.poll_interval_minutes,
    'fixture_allowlist_empty', NOT EXISTS(SELECT 1 FROM jobbot.outreach_owner_test_allowlist),
    'execution_mode', 'authentication_only'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.jf_owner_runtime_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.jf_owner_runtime_status() TO authenticated, service_role;
