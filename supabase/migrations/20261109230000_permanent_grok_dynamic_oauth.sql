-- Migration: 20261109230000_permanent_grok_dynamic_oauth.sql
-- Description: Unified Grok OAuth authorization and recruitment intelligence security.
-- 1. Remediates Gmail credential accessor (revokes from authenticated, grants only to service_role).
-- 2. Establishes single-source database validator for dynamically registered Grok clients.
-- 3. Updates jf_owner_runtime_status and require_grok_intelligence_auth to use unified validator.
-- 4. Preserves all RLS policies and workflow mutation RPC blocks.

-- 1. Remediate Critical Issue A: Lock down server-side Gmail credential accessor
REVOKE ALL ON FUNCTION jobbot.get_gmail_fetch_credentials() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION jobbot.get_gmail_fetch_credentials() TO service_role;

-- 2. Single source of truth validator in jobbot schema
CREATE OR REPLACE FUNCTION jobbot.validate_grok_oauth_client(
  p_client_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_client auth.oauth_clients;
  v_consent auth.oauth_consents;
BEGIN
  -- 1. Caller/principal must be the designated owner
  IF p_user_id IS DISTINCT FROM 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid THEN
    RETURN false;
  END IF;

  -- 2. Client ID must be provided
  IF p_client_id IS NULL THEN
    RETURN false;
  END IF;

  -- 3. Client must be registered in auth.oauth_clients and not deleted
  SELECT * INTO v_client
  FROM auth.oauth_clients
  WHERE id = p_client_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- 4. Client redirect URIs must contain the verified Grok callback URI
  IF v_client.redirect_uris IS NULL OR
     NOT ('https://grok.com/connectors-oauth-exchange-code/' = ANY(string_to_array(v_client.redirect_uris, ','))) THEN
    RETURN false;
  END IF;

  -- 5. Client name must match Grok (required expected metadata)
  IF coalesce(v_client.client_name, '') !~* '^Grok' THEN
    RETURN false;
  END IF;

  -- 6. Active, unrevoked owner consent must exist for this exact client ID and owner
  SELECT * INTO v_consent
  FROM auth.oauth_consents
  WHERE user_id = p_user_id
    AND client_id = p_client_id
    AND revoked_at IS NULL;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION jobbot.validate_grok_oauth_client(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION jobbot.validate_grok_oauth_client(uuid, uuid) TO authenticated, service_role;

-- 3. Public RPC wrapper for Edge Function / server-side verification
CREATE OR REPLACE FUNCTION public.jf_validate_grok_oauth_client(
  p_client_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;
  RETURN jobbot.validate_grok_oauth_client(p_client_id, v_uid);
END;
$$;

REVOKE ALL ON FUNCTION public.jf_validate_grok_oauth_client(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.jf_validate_grok_oauth_client(uuid) TO authenticated, service_role;

-- 4. Update public.jf_owner_runtime_status to use single source of truth validator
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
  v_uid uuid := (SELECT auth.uid());
BEGIN
  v_client_id := auth.jwt()->>'client_id';

  -- If client_id is present (OAuth token), validate via single-source database validator
  IF v_client_id IS NOT NULL THEN
    IF v_client_id !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'Invalid OAuth client_id format';
    END IF;

    IF NOT jobbot.validate_grok_oauth_client(v_client_id::uuid, v_uid) THEN
      RAISE EXCEPTION 'Unauthorized OAuth client: %', v_client_id;
    END IF;
  END IF;

  -- Enforce active owner session authentication
  PERFORM jobbot.require_owner_processing_auth();

  SELECT * INTO cfg FROM jobbot.outreach_webhook_config WHERE owner_id=v_uid;
  SELECT * INTO m FROM jobbot.monitor_settings WHERE owner_id=v_uid;
  IF cfg.owner_id IS NULL OR m.owner_id IS NULL THEN
    RAISE EXCEPTION 'Runtime configuration unavailable';
  END IF;

  RETURN jsonb_build_object(
    'owner_user_id', v_uid,
    'request_role', current_setting('role', true),
    'oauth_client_id', v_client_id,
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

-- 5. Update jobbot.require_grok_intelligence_auth to use unified validator
-- Eliminates hardcoded client ID across all recruitment RPCs
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
  -- Caller must be the designated owner
  IF v_uid IS DISTINCT FROM 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid THEN
    RAISE EXCEPTION 'Owner authentication required';
  END IF;

  -- If OAuth client_id is present, must be an active, verified Grok client with owner consent
  IF v_client_id IS NOT NULL THEN
    IF v_client_id !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'Invalid OAuth client_id format';
    END IF;

    IF NOT jobbot.validate_grok_oauth_client(v_client_id::uuid, v_uid) THEN
      RAISE EXCEPTION 'Unauthorized OAuth client: %', v_client_id;
    END IF;
  END IF;

  -- First party sessions (v_client_id IS NULL) must satisfy owner session check
  IF v_client_id IS NULL THEN
    PERFORM jobbot.require_owner_processing_auth();
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION jobbot.require_grok_intelligence_auth() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION jobbot.require_grok_intelligence_auth() TO authenticated, service_role;
