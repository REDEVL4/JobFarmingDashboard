-- Rollback Migration: 20261110000000_cursor_desktop_oauth_and_recruitment_review_rollback.sql
-- Description: Reverts Cursor Desktop OAuth, drops jf_owner_resolve_recruitment_review and jf_grok_exclude_irrelevant_email,
--              and restores Grok-only database validator and submission RPCs.

-- 1. Drop owner review resolution RPC
DROP FUNCTION IF EXISTS public.jf_owner_resolve_recruitment_review(uuid, text, text, uuid);
DROP FUNCTION IF EXISTS public.jf_owner_resolve_recruitment_review(uuid, text, text);

-- 2. Drop dedicated exclusion RPC
DROP FUNCTION IF EXISTS public.jf_grok_exclude_irrelevant_email(uuid, text, numeric, uuid);

-- 3. Restore Grok-only database validator
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

REVOKE ALL ON FUNCTION jobbot.validate_grok_oauth_client(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION jobbot.validate_grok_oauth_client(uuid, uuid) TO authenticated, service_role;

-- 4. Restore original 8-parameter jf_grok_submit_classification_proposal
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

  SELECT * INTO v_q
  FROM jobbot.gmail_processing_queue
  WHERE id = p_queue_id AND owner_id = (SELECT auth.uid())
  FOR UPDATE;

  IF v_q.id IS NULL THEN
    RAISE EXCEPTION 'Queue record not found or inaccessible';
  END IF;

  IF p_idempotency_key IS NOT NULL AND
     v_q.classification_result->>'idempotency_key' = p_idempotency_key::text THEN
    RETURN jsonb_build_object(
      'status', 'idempotent_duplicate',
      'queue_id', v_q.id,
      'review_item_id', v_q.evidence_references->>'review_item_id',
      'classification', v_q.classification_result->>'classification',
      'confidence', (v_q.classification_result->>'confidence')::numeric,
      'review_status', v_q.review_status,
      'processing_status', v_q.processing_status,
      'message', 'Proposal already submitted with this idempotency key'
    );
  END IF;

  v_thread_id := coalesce(v_q.thread_id, v_q.message_id);

  SELECT id, state, reason_code, proposed_stage INTO v_existing_review
  FROM jobbot.recruitment_review_items
  WHERE mailbox = v_q.mailbox
    AND message_id = v_q.message_id
  LIMIT 1;

  IF v_existing_review.id IS NOT NULL THEN
    IF v_existing_review.state IN ('resolved', 'ignored') THEN
      RETURN jsonb_build_object(
        'status', 'already_resolved',
        'review_item_id', v_existing_review.id,
        'queue_id', v_q.id,
        'state', v_existing_review.state,
        'message', 'Review item has already been resolved or ignored by the owner; preserved without change'
      );
    END IF;

    RETURN jsonb_build_object(
      'status', 'proposal_exists',
      'review_item_id', v_existing_review.id,
      'queue_id', v_q.id,
      'state', 'open',
      'existing_classification', v_existing_review.reason_code,
      'message', 'An open proposal already exists for this message; open proposals are not silently overwritten'
    );
  END IF;

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
