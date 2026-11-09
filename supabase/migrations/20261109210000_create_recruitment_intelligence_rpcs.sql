-- Migration: 20261109210000_create_recruitment_intelligence_rpcs.sql
-- Description: Schema-compatible recruitment intelligence RPCs for Grok MCP.
-- Strictly aligns with live table constraints:
--   - gmail_processing_queue.review_status: 'requires_review'
--   - recruitment_review_items.state: 'open', 'resolved', 'ignored'
--   - recruitment_review_items.thread_id: NOT NULL (handled via coalesce)
--   - recruitment_review_items unique (mailbox, message_id) conflict handling
--   - Bounded batch pagination (max 25 emails, max 10 applications)
--   - Zero writes to job_applications.application_status (ENABLE_GMAIL_STATUS_WRITES locked)

-- 1. Helper to validate caller is owner + approved Grok client
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

  -- If OAuth client_id is present, must be the approved Grok connector client ID
  IF v_client_id IS NOT NULL AND v_client_id != '16bdb57f-c2cd-40d8-b6e1-c1a1b17e3f32' THEN
    RAISE EXCEPTION 'Unauthorized OAuth client: %', v_client_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION jobbot.require_grok_intelligence_auth() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION jobbot.require_grok_intelligence_auth() TO authenticated, service_role;

-- 2. Server-side Gmail OAuth credential accessor (for internal Edge Function use only)
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

-- 3. List pending recruitment emails in bounded batches
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

-- 4. Get recruitment email metadata from queue record
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
    coalesce(q.thread_id, q.message_id) AS thread_id,
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

-- 5. Find candidate applications matching company/title
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

-- 6. Submit classification proposal into recruitment_review_items
--    Strictly satisfies:
--      recruitment_review_items.state IN ('open', 'resolved', 'ignored')
--      recruitment_review_items.thread_id NOT NULL
--      recruitment_review_items UNIQUE (mailbox, message_id)
--      gmail_processing_queue.review_status: 'requires_review'
--      Never modifies job_applications.application_status
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

  -- 2. Fetch and lock queue record
  SELECT * INTO v_q
  FROM jobbot.gmail_processing_queue
  WHERE id = p_queue_id AND owner_id = (SELECT auth.uid())
  FOR UPDATE;

  IF v_q.id IS NULL THEN
    RAISE EXCEPTION 'Queue record not found or inaccessible';
  END IF;

  -- 3. Validate candidate application if provided
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

  -- Ensure thread_id is not null (mandatory per schema constraint)
  v_thread_id := coalesce(v_q.thread_id, v_q.message_id);

  -- 4. Check existing review item for (mailbox, message_id)
  SELECT id, state INTO v_existing_review
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

    -- If still open, update in-place idempotently
    UPDATE jobbot.recruitment_review_items
    SET
      thread_id = v_thread_id,
      event_at = coalesce(v_q.message_timestamp, now()),
      reason_code = p_classification,
      proposed_stage = coalesce(p_proposed_stage, 'Review Required'),
      candidate_applications = v_candidate_apps,
      evidence_summary = p_evidence_summary,
      resolved_application_id = p_application_id,
      updated_at = now()
    WHERE id = v_existing_review.id;

    v_review_id := v_existing_review.id;
  ELSE
    -- Insert new review item in state 'open'
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
  END IF;

  -- 5. Update queue record metadata with review_status = 'requires_review'
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

  -- 6. Audit logging
  INSERT INTO jobbot.outreach_audit (
    owner_id,
    entity_type,
    entity_id,
    operation,
    actor_id,
    event_at
  ) VALUES (
    (SELECT auth.uid()),
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
    'state', 'open',
    'review_status', 'requires_review'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.jf_grok_submit_classification_proposal(uuid, text, numeric, uuid, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.jf_grok_submit_classification_proposal(uuid, text, numeric, uuid, text, text, text, uuid) TO authenticated, service_role;
