-- Migration: 20261109210000_create_recruitment_intelligence_rpcs.sql
-- Description: Narrowly-scoped recruitment intelligence RPCs for Grok MCP.
-- Enforces approved Grok client ID validation, bounded pagination, idempotency,
-- and strict read-only boundary on application statuses (writes only to review queue).

-- 1. Helper to validate caller is owner + approved client
CREATE OR REPLACE FUNCTION jobbot.require_grok_intelligence_auth()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_role text := coalesce(current_setting('role', true), '');
  v_client_id text := auth.jwt()->>'client_id';
BEGIN
  -- Must be authenticated owner
  IF v_uid IS DISTINCT FROM 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid THEN
    RAISE EXCEPTION 'Owner authentication required';
  END IF;

  -- If OAuth client_id is present, must be the approved Grok client
  IF v_client_id IS NOT NULL AND v_client_id != '16bdb57f-c2cd-40d8-b6e1-c1a1b17e3f32' THEN
    RAISE EXCEPTION 'Unauthorized OAuth client: %', v_client_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION jobbot.require_grok_intelligence_auth() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION jobbot.require_grok_intelligence_auth() TO authenticated, service_role;

-- 2. List pending recruitment emails in bounded batches
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

  -- Bounded limit (default 10, max 25, min 1)
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

-- 3. Get recruitment email details by queue ID
CREATE OR REPLACE FUNCTION public.jf_grok_get_email_details(
  p_queue_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_rec record;
BEGIN
  PERFORM jobbot.require_grok_intelligence_auth();

  IF p_queue_id IS NULL THEN
    RAISE EXCEPTION 'queue_id is required';
  END IF;

  SELECT
    q.id,
    q.mailbox,
    q.message_id,
    q.thread_id,
    q.message_timestamp,
    q.subject_clean,
    q.sender_clean,
    q.content_hash,
    q.attempt_count,
    q.processing_status,
    q.review_status,
    q.created_at
  INTO v_rec
  FROM jobbot.gmail_processing_queue q
  WHERE q.id = p_queue_id
    AND q.owner_id = (SELECT auth.uid());

  IF v_rec.id IS NULL THEN
    RAISE EXCEPTION 'Queue record not found or inaccessible';
  END IF;

  RETURN to_jsonb(v_rec);
END;
$$;

REVOKE ALL ON FUNCTION public.jf_grok_get_email_details(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.jf_grok_get_email_details(uuid) TO authenticated, service_role;

-- 4. Find candidate applications matching company/title
CREATE OR REPLACE FUNCTION public.jf_grok_find_candidate_applications(
  p_query text,
  p_limit integer DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_clean_query text;
  v_effective_limit integer;
  v_result jsonb;
BEGIN
  PERFORM jobbot.require_grok_intelligence_auth();

  v_clean_query := trim(coalesce(p_query, ''));
  IF length(v_clean_query) < 2 THEN
    RAISE EXCEPTION 'Search query must be at least 2 characters';
  END IF;

  -- Bounded limit (max 10, min 1)
  v_effective_limit := LEAST(GREATEST(coalesce(p_limit, 5), 1), 10);

  SELECT coalesce(jsonb_agg(app), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      a.id,
      a.company,
      a.job_title,
      a.application_status,
      a.hiring_stage,
      a.applied_at,
      a.posting_url
    FROM jobbot.job_applications a
    WHERE (
      a.company ILIKE '%' || v_clean_query || '%'
      OR a.job_title ILIKE '%' || v_clean_query || '%'
    )
    ORDER BY a.applied_at DESC NULLS LAST
    LIMIT v_effective_limit
  ) app;

  RETURN jsonb_build_object(
    'query', v_clean_query,
    'count', jsonb_array_length(v_result),
    'applications', v_result
  );
END;
$$;

REVOKE ALL ON FUNCTION public.jf_grok_find_candidate_applications(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.jf_grok_find_candidate_applications(text, integer) TO authenticated, service_role;

-- 5. Submit classification proposal into review queue (NEVER modifies application_status)
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
  v_existing_review_id uuid;
  v_new_review_id uuid;
  v_review_payload jsonb;
BEGIN
  PERFORM jobbot.require_grok_intelligence_auth();

  -- 1. Validate inputs
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

  -- 2. Fetch and lock queue record
  SELECT * INTO v_q
  FROM jobbot.gmail_processing_queue
  WHERE id = p_queue_id AND owner_id = (SELECT auth.uid())
  FOR UPDATE;

  IF v_q.id IS NULL THEN
    RAISE EXCEPTION 'Queue record not found or inaccessible';
  END IF;

  -- 3. Validate application if provided
  IF p_application_id IS NOT NULL THEN
    SELECT id, company, job_title, application_status, hiring_stage
    INTO v_app
    FROM jobbot.job_applications
    WHERE id = p_application_id;

    IF v_app.id IS NULL THEN
      RAISE EXCEPTION 'Referenced application % does not exist', p_application_id;
    END IF;
  END IF;

  -- 4. Idempotency check: see if a proposal already exists for this message
  SELECT id INTO v_existing_review_id
  FROM jobbot.recruitment_review_items
  WHERE message_id = v_q.message_id
    AND state = 'pending_owner_review'
  LIMIT 1;

  IF v_existing_review_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'status', 'idempotent_duplicate',
      'review_item_id', v_existing_review_id,
      'queue_id', v_q.id,
      'message', 'Review proposal already exists for this message'
    );
  END IF;

  -- 5. Construct review item payload
  v_review_payload := jsonb_build_object(
    'application_id', p_application_id,
    'company', coalesce(v_app.company, 'Unknown'),
    'job_title', coalesce(v_app.job_title, 'Unknown'),
    'current_status', v_app.application_status,
    'confidence', p_confidence,
    'ambiguity_notes', p_ambiguity_notes,
    'idempotency_key', p_idempotency_key
  );

  -- 6. Insert into recruitment_review_items for owner review
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
    gen_random_uuid(),
    v_q.mailbox,
    v_q.message_id,
    coalesce(v_q.thread_id, v_q.message_id),
    v_q.message_timestamp,
    p_classification,
    p_proposed_stage,
    v_review_payload,
    p_evidence_summary,
    'pending_owner_review',
    p_application_id,
    now(),
    now()
  )
  RETURNING id INTO v_new_review_id;

  -- 7. Update queue record metadata (keep processing_status pending until owner confirms)
  UPDATE jobbot.gmail_processing_queue
  SET
    analysis_version = 'grok-recruitment-intel-v1',
    classification_result = jsonb_build_object(
      'classification', p_classification,
      'confidence', p_confidence,
      'evaluated_at', now()
    ),
    proposed_application_match = v_review_payload,
    evidence_references = jsonb_build_object(
      'evidence_summary', p_evidence_summary,
      'ambiguity_notes', p_ambiguity_notes,
      'review_item_id', v_new_review_id
    ),
    review_status = 'pending_review',
    updated_at = now()
  WHERE id = v_q.id;

  -- 8. Audit log entry
  INSERT INTO jobbot.outreach_audit (
    owner_id,
    actor_id,
    actor_role,
    action,
    entity_type,
    entity_id,
    summary,
    created_at
  ) VALUES (
    (SELECT auth.uid()),
    (SELECT auth.uid()),
    'grok_intelligence',
    'submit_classification_proposal',
    'gmail_queue',
    v_q.id,
    format('Classification proposal %s submitted for message %s (confidence: %s, review_id: %s)', p_classification, v_q.message_id, p_confidence, v_new_review_id),
    now()
  );

  RETURN jsonb_build_object(
    'status', 'proposal_submitted',
    'review_item_id', v_new_review_id,
    'queue_id', v_q.id,
    'classification', p_classification,
    'confidence', p_confidence,
    'requires_owner_review', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.jf_grok_submit_classification_proposal(uuid, text, numeric, uuid, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.jf_grok_submit_classification_proposal(uuid, text, numeric, uuid, text, text, text, uuid) TO authenticated, service_role;
