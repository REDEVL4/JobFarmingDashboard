-- Migration: 20261109230000_permanent_grok_dynamic_oauth.sql
-- Description: Consolidated dynamic Grok OAuth authorization, recruitment intelligence MCP RPC fixes, and server-role-only credential accessor.
-- Fixes verified defects:
--   1. Server-role-only Gmail credential accessor (public.jf_get_gmail_fetch_credentials).
--   2. Prevents repeated email classification: excludes messages with existing review proposals or non-pending status; handles duplicate idempotency keys without overwriting open proposals.
--   3. Stable keyset pagination aligned with (message_timestamp ASC, id ASC) with owner cursor verification.
--   4. Preserves dynamic Grok OAuth database validation and fails closed for unapproved/revoked clients.

-- ============================================================================
-- 1. SERVER-ROLE-ONLY GMAIL CREDENTIAL ACCESSOR (DEFECT 1)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.jf_get_gmail_fetch_credentials()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_jwt_role text;
  v_client_id text;
  v_client_id_val text;
  v_client_secret_val text;
  v_refresh_token_val text;
BEGIN
  -- Strictly require verified service_role execution:
  -- - JWT role claim must be 'service_role'
  -- - OAuth client_id must be NULL (rejects all third-party OAuth access tokens)
  v_jwt_role := (SELECT auth.jwt()->>'role');
  v_client_id := (SELECT auth.jwt()->>'client_id');

  IF v_jwt_role IS DISTINCT FROM 'service_role' OR v_client_id IS NOT NULL THEN
    RAISE EXCEPTION 'Access denied: service_role authorization required';
  END IF;

  v_client_id_val := jobbot.monitor_get_secret('jf_gmail_client_id');
  v_client_secret_val := jobbot.monitor_get_secret('jf_gmail_client_secret');
  v_refresh_token_val := jobbot.monitor_get_secret('jf_gmail_refresh_token');

  IF v_client_id_val IS NULL OR v_client_secret_val IS NULL OR v_refresh_token_val IS NULL THEN
    RAISE EXCEPTION 'Gmail OAuth credentials unavailable in Vault';
  END IF;

  RETURN jsonb_build_object(
    'client_id', v_client_id_val,
    'client_secret', v_client_secret_val,
    'refresh_token', v_refresh_token_val
  );
END;
$$;

-- Revoke all permissions from PUBLIC, anon, and authenticated
REVOKE ALL ON FUNCTION public.jf_get_gmail_fetch_credentials() FROM PUBLIC, anon, authenticated;
-- Grant execution strictly to service_role
GRANT EXECUTE ON FUNCTION public.jf_get_gmail_fetch_credentials() TO service_role;

-- Backward compatibility alias in jobbot schema
CREATE OR REPLACE FUNCTION jobbot.get_gmail_fetch_credentials()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  RETURN public.jf_get_gmail_fetch_credentials();
END;
$$;

REVOKE ALL ON FUNCTION jobbot.get_gmail_fetch_credentials() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION jobbot.get_gmail_fetch_credentials() TO service_role;

-- ============================================================================
-- 2. DYNAMIC GROK OAUTH DATABASE VALIDATOR (DEFECT 4)
-- ============================================================================

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

-- ============================================================================
-- 3. UNIFIED RECRUITMENT INTELLIGENCE AUTHENTICATION HELPER
-- ============================================================================

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

-- ============================================================================
-- 4. RUNTIME STATUS RPC (USES UNIFIED VALIDATOR)
-- ============================================================================

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

  IF v_client_id IS NOT NULL THEN
    IF v_client_id !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'Invalid OAuth client_id format';
    END IF;

    IF NOT jobbot.validate_grok_oauth_client(v_client_id::uuid, v_uid) THEN
      RAISE EXCEPTION 'Unauthorized OAuth client: %', v_client_id;
    END IF;
  END IF;

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

-- ============================================================================
-- 5. REPAIR QUEUE PAGINATION & EXCLUDE REVIEWED PROPOSALS (DEFECTS 2 & 3)
-- ============================================================================

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
  v_cursor_timestamp timestamptz;
  v_cursor_id uuid;
  v_uid uuid := (SELECT auth.uid());
  v_fetch_count integer;
  v_has_more boolean := false;
  v_next_cursor uuid := NULL;
BEGIN
  PERFORM jobbot.require_grok_intelligence_auth();

  -- Bounded limit (default 10, max 25, min 1)
  v_effective_limit := LEAST(GREATEST(coalesce(p_limit, 10), 1), 25);

  -- Keyset cursor resolution:
  -- A cursor must reference an eligible record belonging to the owner
  IF p_after_id IS NOT NULL THEN
    SELECT q.message_timestamp, q.id
    INTO v_cursor_timestamp, v_cursor_id
    FROM jobbot.gmail_processing_queue q
    WHERE q.id = p_after_id
      AND q.owner_id = v_uid;

    IF v_cursor_id IS NULL THEN
      RAISE EXCEPTION 'Cursor record % not found or ineligible for owner', p_after_id;
    END IF;
  END IF;

  -- Keyset pagination strictly aligned with (message_timestamp ASC, id ASC)
  -- Exclude messages that have existing review proposals or non-pending review status
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
    WHERE q.owner_id = v_uid
      AND q.processing_status = 'pending'
      AND q.review_status = 'pending'
      AND NOT EXISTS (
        SELECT 1 FROM jobbot.recruitment_review_items r
        WHERE r.mailbox = q.mailbox AND r.message_id = q.message_id
      )
      AND (
        v_cursor_id IS NULL
        OR (q.message_timestamp, q.id) > (v_cursor_timestamp, v_cursor_id)
      )
    ORDER BY q.message_timestamp ASC, q.id ASC
    LIMIT v_effective_limit + 1
  ) item;

  v_fetch_count := jsonb_array_length(v_result);

  IF v_fetch_count > v_effective_limit THEN
    v_has_more := true;
    v_next_cursor := (v_result->(v_effective_limit - 1)->>'id')::uuid;
    SELECT jsonb_agg(elem)
    INTO v_result
    FROM (
      SELECT elem
      FROM jsonb_array_elements(v_result) WITH ORDINALITY AS t(elem, idx)
      WHERE idx <= v_effective_limit
    ) sub;
  ELSIF v_fetch_count > 0 THEN
    v_has_more := false;
    v_next_cursor := NULL;
  ELSE
    v_has_more := false;
    v_next_cursor := NULL;
  END IF;

  RETURN jsonb_build_object(
    'count', jsonb_array_length(v_result),
    'limit', v_effective_limit,
    'has_more', v_has_more,
    'next_cursor', v_next_cursor,
    'messages', v_result
  );
END;
$$;

REVOKE ALL ON FUNCTION public.jf_grok_list_pending_emails(integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.jf_grok_list_pending_emails(integer, uuid) TO authenticated, service_role;

-- ============================================================================
-- 6. ATOMIC SUBMIT CLASSIFICATION PROPOSAL (DEFECT 2)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.jf_grok_submit_classification_proposal(
  p_queue_id uuid,
  p_classification text,
  p_confidence numeric,
  p_application_id uuid DEFAULT NULL,
  p_evidence_summary text DEFAULT '',
  p_proposed_stage text DEFAULT NULL,
  p_ambiguity_notes text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_q record;
  v_app record;
  v_valid_classes text[] := ARRAY[
    'application_confirmation',
    'rejection',
    'interview_invitation',
    'assessment',
    'recruiter_follow_up',
    'offer',
    'other_uncertain'
  ];
  v_existing_review record;
  v_review_id uuid;
  v_candidate_apps jsonb;
  v_thread_id text;
BEGIN
  PERFORM jobbot.require_grok_intelligence_auth();

  -- 1. Input validation
  IF p_queue_id IS NULL THEN
    RAISE EXCEPTION 'queue_id is required';
  END IF;

  IF p_classification IS NULL OR NOT (p_classification = ANY(v_valid_classes)) THEN
    RAISE EXCEPTION 'Invalid classification: %. Must be one of: %', p_classification, array_to_string(v_valid_classes, ', ');
  END IF;

  IF p_confidence IS NULL OR p_confidence < 0.0 OR p_confidence > 1.0 THEN
    RAISE EXCEPTION 'Confidence must be between 0.0 and 1.0';
  END IF;

  IF length(trim(coalesce(p_evidence_summary, ''))) < 5 THEN
    RAISE EXCEPTION 'Evidence summary must be at least 5 characters';
  END IF;

  -- 2. Fetch and lock queue record for update (atomic transaction)
  SELECT * INTO v_q
  FROM jobbot.gmail_processing_queue
  WHERE id = p_queue_id AND owner_id = (SELECT auth.uid())
  FOR UPDATE;

  IF v_q.id IS NULL THEN
    RAISE EXCEPTION 'Queue record not found or inaccessible';
  END IF;

  -- 3. Duplicate idempotency key check: return original result
  IF p_idempotency_key IS NOT NULL AND
     v_q.classification_result->>'idempotency_key' = p_idempotency_key::text THEN
    RETURN jsonb_build_object(
      'status', 'idempotent_duplicate',
      'queue_id', v_q.id,
      'review_item_id', v_q.evidence_references->>'review_item_id',
      'classification', v_q.classification_result->>'classification',
      'confidence', (v_q.classification_result->>'confidence')::numeric,
      'review_status', v_q.review_status,
      'message', 'Proposal already submitted with this idempotency key'
    );
  END IF;

  v_thread_id := coalesce(v_q.thread_id, v_q.message_id);

  -- 4. Check existing review item for (mailbox, message_id)
  SELECT id, state, reason_code, proposed_stage INTO v_existing_review
  FROM jobbot.recruitment_review_items
  WHERE mailbox = v_q.mailbox
    AND message_id = v_q.message_id
  LIMIT 1;

  IF v_existing_review.id IS NOT NULL THEN
    -- If already resolved or ignored by owner, do not overwrite!
    IF v_existing_review.state IN ('resolved', 'ignored') THEN
      RETURN jsonb_build_object(
        'status', 'already_resolved',
        'review_item_id', v_existing_review.id,
        'queue_id', v_q.id,
        'state', v_existing_review.state,
        'message', 'Review item has already been resolved or ignored by the owner; preserved without change'
      );
    END IF;

    -- Existing open proposals are NOT silently overwritten!
    RETURN jsonb_build_object(
      'status', 'proposal_exists',
      'review_item_id', v_existing_review.id,
      'queue_id', v_q.id,
      'state', 'open',
      'existing_classification', v_existing_review.reason_code,
      'message', 'An open proposal already exists for this message; open proposals are not silently overwritten'
    );
  END IF;

  -- 5. Validate candidate application if provided
  IF p_application_id IS NOT NULL THEN
    SELECT id, company, job_title, application_status, hiring_stage
    INTO v_app
    FROM jobbot.job_applications
    WHERE id = p_application_id;

    IF v_app.id IS NULL THEN
      RAISE EXCEPTION 'Referenced application % does not exist', p_application_id;
    END IF;

    v_candidate_apps := jsonb_build_array(
      jsonb_build_object(
        'id', v_app.id,
        'company', v_app.company,
        'job_title', v_app.job_title,
        'current_status', v_app.application_status,
        'confidence', p_confidence,
        'ambiguity_notes', p_ambiguity_notes
      )
    );
  ELSE
    v_candidate_apps := '[]'::jsonb;
  END IF;

  -- 6. Insert new review item in state 'open'
  v_review_id := gen_random_uuid();
  INSERT INTO jobbot.recruitment_review_items (
    id,
    mailbox,
    message_id,
    thread_id,
    event_at,
    reason_code,
    proposed_stage,
    candidate_applications,
    evidence_summary,
    state,
    resolved_application_id,
    created_at,
    updated_at
  ) VALUES (
    v_review_id,
    v_q.mailbox,
    v_q.message_id,
    v_thread_id,
    coalesce(v_q.message_timestamp, now()),
    p_classification,
    coalesce(p_proposed_stage, 'Review Required'),
    v_candidate_apps,
    p_evidence_summary,
    'open',
    p_application_id,
    now(),
    now()
  );

  -- 7. Update queue record atomically: review_status = 'requires_review'
  UPDATE jobbot.gmail_processing_queue
  SET
    analysis_version = 'grok-recruitment-intel-v1',
    classification_result = jsonb_build_object(
      'classification', p_classification,
      'confidence', p_confidence,
      'evaluated_at', now(),
      'idempotency_key', p_idempotency_key
    ),
    proposed_application_match = v_candidate_apps,
    evidence_references = jsonb_build_object(
      'evidence_summary', p_evidence_summary,
      'ambiguity_notes', p_ambiguity_notes,
      'review_item_id', v_review_id
    ),
    review_status = 'requires_review',
    updated_at = now()
  WHERE id = v_q.id;

  -- 8. Audit logging
  INSERT INTO jobbot.outreach_audit (
    owner_id,
    entity_type,
    entity_id,
    operation,
    actor_id,
    event_at
  ) VALUES (
    v_q.owner_id,
    'gmail_queue',
    v_q.id,
    'submit_classification_proposal',
    (SELECT auth.uid()),
    now()
  );

  RETURN jsonb_build_object(
    'status', 'proposal_submitted',
    'review_item_id', v_review_id,
    'queue_id', v_q.id,
    'classification', p_classification,
    'confidence', p_confidence,
    'proposed_stage', coalesce(p_proposed_stage, 'Review Required'),
    'state', 'open',
    'review_status', 'requires_review'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.jf_grok_submit_classification_proposal(uuid, text, numeric, uuid, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.jf_grok_submit_classification_proposal(uuid, text, numeric, uuid, text, text, text, uuid) TO authenticated, service_role;
