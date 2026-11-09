-- Integration Test: Dynamic Grok OAuth Client Server-Side Validation
-- Strictly transactional: executed in BEGIN ... ROLLBACK to prevent any state leakage.

BEGIN;

-- 1. Apply candidate validator function definitions within transaction
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
  IF p_user_id IS DISTINCT FROM 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid THEN
    RETURN false;
  END IF;

  IF p_client_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT * INTO v_client
  FROM auth.oauth_clients
  WHERE id = p_client_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_client.redirect_uris IS NULL OR
     NOT ('https://grok.com/connectors-oauth-exchange-code/' = ANY(string_to_array(v_client.redirect_uris, ','))) THEN
    RETURN false;
  END IF;

  IF coalesce(v_client.client_name, '') !~* '^Grok' THEN
    RETURN false;
  END IF;

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

DO $$
DECLARE
  v_owner_id uuid := 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid;
  v_non_owner_id uuid := '00000000-0000-0000-0000-000000000000'::uuid;
  v_dynamic_client_id uuid := 'b54de595-6bce-4298-836c-2b46a2595904'::uuid;
  v_cursor_client_id uuid := '3a6b0c2a-51fb-43c8-8625-3056092fad8e'::uuid;
  v_evil_client_id uuid := '99999999-9999-9999-9999-999999999999'::uuid;
  v_is_valid boolean;
  v_consent_id uuid;
BEGIN
  RAISE NOTICE '=== STARTING DYNAMIC GROK OAUTH INTEGRATION TESTS ===';

  -- TEST 1: Dynamically registered Grok client BEFORE owner consent MUST be rejected
  v_is_valid := jobbot.validate_grok_oauth_client(v_dynamic_client_id, v_owner_id);
  IF v_is_valid = true THEN
    RAISE EXCEPTION 'TEST 1 FAILED: Client without owner consent should be rejected';
  END IF;
  RAISE NOTICE 'TEST 1 PASSED: Unapproved dynamic client rejected (consent missing)';

  -- TEST 2: Grant owner consent to the dynamic Grok client
  v_consent_id := gen_random_uuid();
  INSERT INTO auth.oauth_consents (
    id,
    user_id,
    client_id,
    scopes,
    granted_at,
    revoked_at
  ) VALUES (
    v_consent_id,
    v_owner_id,
    v_dynamic_client_id,
    'openid profile email offline_access',
    now(),
    NULL
  );

  -- TEST 3: Dynamically registered Grok client AFTER active owner consent MUST be authorized
  v_is_valid := jobbot.validate_grok_oauth_client(v_dynamic_client_id, v_owner_id);
  IF v_is_valid != true THEN
    RAISE EXCEPTION 'TEST 3 FAILED: Client with active owner consent should be authorized';
  END IF;
  RAISE NOTICE 'TEST 3 PASSED: Dynamic Grok client authorized with active owner consent';

  -- TEST 4: Revoke consent for dynamic Grok client MUST immediately reject access
  UPDATE auth.oauth_consents
  SET revoked_at = now()
  WHERE id = v_consent_id;

  v_is_valid := jobbot.validate_grok_oauth_client(v_dynamic_client_id, v_owner_id);
  IF v_is_valid = true THEN
    RAISE EXCEPTION 'TEST 4 FAILED: Client with revoked consent should be rejected';
  END IF;
  RAISE NOTICE 'TEST 4 PASSED: Dynamic Grok client rejected immediately after consent revocation';

  -- TEST 5: Cursor client (different callback and name) even if consent exists MUST be rejected
  INSERT INTO auth.oauth_consents (
    id,
    user_id,
    client_id,
    scopes,
    granted_at,
    revoked_at
  ) VALUES (
    gen_random_uuid(),
    v_owner_id,
    v_cursor_client_id,
    'openid email',
    now(),
    NULL
  );

  v_is_valid := jobbot.validate_grok_oauth_client(v_cursor_client_id, v_owner_id);
  IF v_is_valid = true THEN
    RAISE EXCEPTION 'TEST 5 FAILED: Non-Grok client (Cursor) must be rejected';
  END IF;
  RAISE NOTICE 'TEST 5 PASSED: Non-Grok client rejected by callback URI and metadata check';

  -- TEST 6: Non-owner principal MUST be rejected even if client has valid Grok metadata
  v_is_valid := jobbot.validate_grok_oauth_client(v_dynamic_client_id, v_non_owner_id);
  IF v_is_valid = true THEN
    RAISE EXCEPTION 'TEST 6 FAILED: Non-owner principal must be rejected';
  END IF;
  RAISE NOTICE 'TEST 6 PASSED: Non-owner principal rejected';

  -- TEST 7: Unknown/Unregistered client ID MUST be rejected
  v_is_valid := jobbot.validate_grok_oauth_client(v_evil_client_id, v_owner_id);
  IF v_is_valid = true THEN
    RAISE EXCEPTION 'TEST 7 FAILED: Unregistered client ID must be rejected';
  END IF;
  RAISE NOTICE 'TEST 7 PASSED: Unregistered client ID rejected';

  RAISE NOTICE '=== ALL DYNAMIC OAUTH INTEGRATION TESTS PASSED CLEANLY ===';
END $$;

ROLLBACK;

