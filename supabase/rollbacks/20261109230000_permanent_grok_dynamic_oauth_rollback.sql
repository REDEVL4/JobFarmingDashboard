-- Rollback Migration: 20261109230000_permanent_grok_dynamic_oauth_rollback.sql
-- Description: Restores 20261109210000 / 20261109193000 baseline function definitions.

DROP FUNCTION IF EXISTS public.jf_get_gmail_fetch_credentials();
DROP FUNCTION IF EXISTS public.jf_validate_grok_oauth_client(uuid);
DROP FUNCTION IF EXISTS jobbot.validate_grok_oauth_client(uuid, uuid);

-- 1. Restore jobbot.get_gmail_fetch_credentials from 20261109210000
CREATE OR REPLACE FUNCTION jobbot.get_gmail_fetch_credentials()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_client_id text;
  v_client_secret text;
  v_refresh_token text;
BEGIN
  PERFORM jobbot.require_grok_intelligence_auth();

  v_client_id := jobbot.monitor_get_secret('jf_gmail_client_id');
  v_client_secret := jobbot.monitor_get_secret('jf_gmail_client_secret');
  v_refresh_token := jobbot.monitor_get_secret('jf_gmail_refresh_token');

  IF v_client_id IS NULL OR v_client_secret IS NULL OR v_refresh_token IS NULL THEN
    RAISE EXCEPTION 'Gmail OAuth credentials unavailable in Vault';
  END IF;

  RETURN jsonb_build_object(
    'client_id', v_client_id,
    'client_secret', v_client_secret,
    'refresh_token', v_refresh_token
  );
END;
$$;

REVOKE ALL ON FUNCTION jobbot.get_gmail_fetch_credentials() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION jobbot.get_gmail_fetch_credentials() TO authenticated, service_role;

-- 2. Restore jf_owner_runtime_status from 20261109193000
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

-- 3. Restore jobbot.require_grok_intelligence_auth from 20261109210000
CREATE OR REPLACE FUNCTION jobbot.require_grok_intelligence_auth()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_client_id text := auth.jwt()->>'client_id';
BEGIN
  IF v_uid IS DISTINCT FROM 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid THEN
    RAISE EXCEPTION 'Owner authentication required';
  END IF;
  IF v_client_id IS NOT NULL AND v_client_id != '16bdb57f-c2cd-40d8-b6e1-c1a1b17e3f32' THEN
    RAISE EXCEPTION 'Unauthorized OAuth client: %', v_client_id;
  END IF;
  IF v_client_id IS NULL THEN
    PERFORM jobbot.require_owner_processing_auth();
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION jobbot.require_grok_intelligence_auth() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION jobbot.require_grok_intelligence_auth() TO authenticated, service_role;

-- 4. Restore public.jf_grok_list_pending_emails from 20261109210000
CREATE OR REPLACE FUNCTION public.jf_grok_list_pending_emails(
  p_limit integer DEFAULT 10,
  p_after_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_effective_limit integer;
  v_result jsonb;
BEGIN
  PERFORM jobbot.require_grok_intelligence_auth();
  v_effective_limit := LEAST(GREATEST(coalesce(p_limit, 10), 1), 25);
  SELECT coalesce(jsonb_agg(item), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      q.id,
      q.message_id,
      q.thread_id,
      q.subject_clean,
      q.sender_clean,
      q.message_timestamp,
      q.attempt_count,
      q.review_status
    FROM jobbot.gmail_processing_queue q
    WHERE q.owner_id = (SELECT auth.uid())
      AND q.processing_status = 'pending'
      AND (p_after_id IS NULL OR q.id > p_after_id)
    ORDER BY q.message_timestamp ASC, q.id ASC
    LIMIT v_effective_limit
  ) item;
  RETURN jsonb_build_object(
    'count', jsonb_array_length(v_result),
    'limit', v_effective_limit,
    'messages', v_result
  );
END;
$$;

REVOKE ALL ON FUNCTION public.jf_grok_list_pending_emails(integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.jf_grok_list_pending_emails(integer, uuid) TO authenticated, service_role;
