-- Migration: 20261110000000_cursor_desktop_oauth_and_recruitment_review.sql
-- Description: Supports Cursor Desktop OAuth client, enables durable irrelevant email exclusions via dedicated RPC,
--              and implements atomic owner review actions (Approve, Reject/Ignore, Needs Review) with strict
--              candidate application validation, terminal review state lifecycle enforcement,
--              submission-verification preservation, event chronology protection, and jobbot.application_events audit logging.

-- ============================================================================
-- 1. TASK A: EXPAND DATABASE VALIDATOR TO SUPPORT CURSOR DESKTOP OAUTH
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
  v_is_grok boolean := false;
  v_is_cursor boolean := false;
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

  -- 4. Check client identity against authorized connectors
  -- A) Approved Grok Connector:
  -- - redirect_uris contains https://grok.com/connectors-oauth-exchange-code/
  -- - client_name matches ^Grok
  IF v_client.redirect_uris IS NOT NULL AND
     ('https://grok.com/connectors-oauth-exchange-code/' = ANY(string_to_array(v_client.redirect_uris, ','))) AND
     coalesce(v_client.client_name, '') ~* '^Grok' THEN
    v_is_grok := true;
  END IF;

  -- B) Approved Cursor Desktop MCP Connector:
  -- - exact client_id cad36a3f-674b-464f-a90f-8ab9b661218d
  -- - redirect_uris contains https://www.cursor.com/agents/mcp/oauth/callback (HTTPS only; loopback disallowed)
  -- - client_name matches ^Cursor
  IF p_client_id = 'cad36a3f-674b-464f-a90f-8ab9b661218d'::uuid AND
     v_client.redirect_uris IS NOT NULL AND
     ('https://www.cursor.com/agents/mcp/oauth/callback' = ANY(string_to_array(v_client.redirect_uris, ','))) AND
     coalesce(v_client.client_name, '') ~* '^Cursor' THEN
    v_is_cursor := true;
  END IF;

  IF NOT v_is_grok AND NOT v_is_cursor THEN
    RETURN false;
  END IF;

  -- 5. Active, unrevoked owner consent must exist for this exact client ID and owner
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

-- Backward-compatibility wrapper in public schema
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
-- 2. TASK B: PRESERVE 8-PARAMETER CLASSIFICATION RPC & CREATE DEDICATED EXCLUSION RPC
-- ============================================================================

-- A) Preserve exact 8-parameter signature of jf_grok_submit_classification_proposal
-- (Guarantees zero PostgREST RPC overload ambiguity)
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

  -- Cannot submit proposal if queue record is already completed, excluded, ignored, rejected, or ineligible
  IF (v_q.processing_status != 'pending' OR v_q.review_status != 'pending') AND
     (p_idempotency_key IS NULL OR v_q.classification_result->>'idempotency_key' IS DISTINCT FROM p_idempotency_key::text) THEN
    RAISE EXCEPTION 'Queue record % is not eligible for proposal: processing_status is %, review_status is %',
      v_q.id, v_q.processing_status, v_q.review_status;
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
      'processing_status', v_q.processing_status,
      'message', 'Proposal already submitted with this idempotency key'
    );
  END IF;

  v_thread_id := coalesce(v_q.thread_id, v_q.message_id);

  -- 4. Check existing review item for (mailbox, message_id)
  SELECT id, state, reason_code, proposed_stage INTO v_existing_review
  FROM jobbot.recruitment_review_items
  WHERE mailbox = v_q.mailbox
    AND message_id = v_q.message_id
  FOR UPDATE;

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
  -- Note: resolved_application_id remains NULL until an owner explicitly resolves the review item
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
    NULL,
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


-- B) Dedicated exclusion RPC: marks email as excluded/ignored with durable audit trail
-- Critical defect 2 resolution:
-- - Rejects exclusions unless processing_status = 'pending' AND review_status = 'pending'
-- - Rejects exclusions if ANY review item exists for the same mailbox and message
-- - Rejects exclusions if reason is invalid (< 3 non-whitespace chars)
-- - Executes all checks under FOR UPDATE row locks to prevent race conditions or proposal overwriting
CREATE OR REPLACE FUNCTION public.jf_grok_exclude_irrelevant_email(
  p_queue_id uuid,
  p_reason text,
  p_confidence numeric DEFAULT 1.0,
  p_idempotency_key uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_q record;
  v_effective_reason text;
  v_existing_review record;
BEGIN
  PERFORM jobbot.require_grok_intelligence_auth();

  IF p_queue_id IS NULL THEN
    RAISE EXCEPTION 'queue_id is required';
  END IF;

  v_effective_reason := trim(coalesce(p_reason, ''));
  IF length(v_effective_reason) < 3 THEN
    RAISE EXCEPTION 'Valid exclusion reason of at least 3 characters is required';
  END IF;

  IF p_confidence IS NULL OR p_confidence < 0.0 OR p_confidence > 1.0 THEN
    RAISE EXCEPTION 'Confidence must be between 0.0 and 1.0';
  END IF;

  -- Lock queue record under FOR UPDATE
  SELECT * INTO v_q
  FROM jobbot.gmail_processing_queue
  WHERE id = p_queue_id AND owner_id = (SELECT auth.uid())
  FOR UPDATE;

  IF v_q.id IS NULL THEN
    RAISE EXCEPTION 'Queue record not found or inaccessible';
  END IF;

  -- Idempotency check: if already excluded with this exact idempotency key, return harmless duplicate
  IF p_idempotency_key IS NOT NULL AND
     v_q.classification_result->>'idempotency_key' = p_idempotency_key::text THEN
    RETURN jsonb_build_object(
      'status', 'idempotent_duplicate',
      'queue_id', v_q.id,
      'review_status', v_q.review_status,
      'processing_status', v_q.processing_status,
      'message', 'Email was already excluded with this idempotency key'
    );
  END IF;

  -- Eligibility Check 1: Queue record MUST be pending processing and review
  IF v_q.processing_status != 'pending' OR v_q.review_status != 'pending' THEN
    RAISE EXCEPTION 'Queue record % is not eligible for exclusion: processing_status is %, review_status is %',
      v_q.id, v_q.processing_status, v_q.review_status;
  END IF;

  -- Eligibility Check 2: Must NOT have an existing recruitment review item for same message
  -- Checked under FOR UPDATE row lock to block concurrent proposals or updates
  SELECT id, state INTO v_existing_review
  FROM jobbot.recruitment_review_items
  WHERE mailbox = v_q.mailbox AND message_id = v_q.message_id
  FOR UPDATE;

  IF v_existing_review.id IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot exclude email: review item % already exists in state % for message %',
      v_existing_review.id, v_existing_review.state, v_q.message_id;
  END IF;

  -- Update queue record: processing_status = 'excluded', review_status = 'ignored'
  UPDATE jobbot.gmail_processing_queue
  SET
    processing_status = 'excluded',
    review_status = 'ignored',
    exclusion_reason = v_effective_reason,
    analysis_version = 'grok-recruitment-intel-v1',
    classification_result = jsonb_build_object(
      'classification', 'irrelevant_exclusion',
      'confidence', coalesce(p_confidence, 1.0),
      'evaluated_at', now(),
      'idempotency_key', p_idempotency_key,
      'disposition', 'excluded'
    ),
    evidence_references = jsonb_build_object(
      'exclusion_reason', v_effective_reason,
      'disposition', 'excluded'
    ),
    updated_at = now()
  WHERE id = v_q.id;

  -- Audit log for exclusion
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
    'exclude_irrelevant_email',
    (SELECT auth.uid()),
    now()
  );

  RETURN jsonb_build_object(
    'status', 'email_excluded',
    'queue_id', v_q.id,
    'review_status', 'ignored',
    'processing_status', 'excluded',
    'message', 'Irrelevant email excluded with durable disposition'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.jf_grok_exclude_irrelevant_email(uuid, text, numeric, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.jf_grok_exclude_irrelevant_email(uuid, text, numeric, uuid) TO authenticated, service_role;


-- ============================================================================
-- 3. TASK C: ATOMIC OWNER REVIEW RESOLUTION RPC WITH STRICT APPLICATION VERIFICATION,
--    TERMINAL LIFECYCLE ENFORCEMENT, SUBMISSION STATUS PRESERVATION,
--    STAGE CHRONOLOGY PROTECTION, AND JOBBOT.APPLICATION_EVENTS LOGGING
-- ============================================================================

CREATE OR REPLACE FUNCTION public.jf_owner_resolve_recruitment_review(
  p_review_item_id uuid,
  p_action text,
  p_notes text DEFAULT NULL,
  p_target_application_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_client_id text := auth.jwt()->>'client_id';
  v_item record;
  v_queue record;
  v_app record;
  v_target_app_id uuid;
  v_is_candidate boolean := false;
  v_valid_actions text[] := ARRAY['approve', 'reject', 'ignore', 'needs_review'];
  v_proposed_stage text;
  v_effective_new_stage text;
  v_new_status text;
  v_update_submission boolean := false;
  v_new_verification_status text;
  v_new_verified_at timestamptz;
  v_new_confirmation_ref text;
  v_new_evidence text;
  v_candidate_count integer := 0;
  v_item_time timestamptz;
  v_latest_app_event_time timestamptz;
  v_app_reference_time timestamptz;
  v_stage_change_allowed boolean := true;
  v_stage_notes text := NULL;
  v_app_updated boolean := false;
BEGIN
  -- 1. Strictly require authenticated owner
  IF v_uid IS DISTINCT FROM 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid THEN
    RAISE EXCEPTION 'Owner authentication required';
  END IF;

  -- 2. Reject all third-party OAuth access tokens (owner interactive UI only)
  IF v_client_id IS NOT NULL THEN
    RAISE EXCEPTION 'OAuth tokens are not permitted to resolve review items';
  END IF;

  -- 3. Action validation
  IF p_action IS NULL OR NOT (lower(p_action) = ANY(v_valid_actions)) THEN
    RAISE EXCEPTION 'Invalid action: %. Must be one of: approve, reject, ignore, needs_review', p_action;
  END IF;

  -- 4. Lock review item under FOR UPDATE
  SELECT * INTO v_item
  FROM jobbot.recruitment_review_items
  WHERE id = p_review_item_id
  FOR UPDATE;

  IF v_item.id IS NULL THEN
    RAISE EXCEPTION 'Review item % not found', p_review_item_id;
  END IF;

  -- 5. Critical defect 3 resolution: Strict Review Lifecycle & Terminal State Machine
  -- Terminal State: resolved
  IF v_item.state = 'resolved' THEN
    IF lower(p_action) = 'approve' THEN
      RETURN jsonb_build_object(
        'status', 'already_approved',
        'review_item_id', v_item.id,
        'state', 'resolved',
        'target_application_id', v_item.resolved_application_id,
        'message', 'Review item was already approved'
      );
    ELSE
      RAISE EXCEPTION 'Cannot % an already resolved/approved review item without an explicit authorized correction workflow', p_action;
    END IF;
  END IF;

  -- Terminal State: ignored
  IF v_item.state = 'ignored' THEN
    IF lower(p_action) IN ('reject', 'ignore') THEN
      RETURN jsonb_build_object(
        'status', 'already_ignored',
        'review_item_id', v_item.id,
        'state', 'ignored',
        'message', 'Review item was already rejected/ignored'
      );
    ELSE
      RAISE EXCEPTION 'Cannot % an already ignored/rejected review item without an explicit authorized correction workflow', p_action;
    END IF;
  END IF;

  -- Enforce review item is currently open
  IF v_item.state != 'open' THEN
    RAISE EXCEPTION 'Invalid review item state: %. Only open review items can be resolved', v_item.state;
  END IF;

  -- Find corresponding queue item
  SELECT * INTO v_queue
  FROM jobbot.gmail_processing_queue
  WHERE mailbox = v_item.mailbox AND message_id = v_item.message_id
  FOR UPDATE;

  -- 6. Execute Action
  IF lower(p_action) = 'approve' THEN
    -- Critical defect 1 resolution: Strict Application Candidate Matching Validation
    v_candidate_count := coalesce(jsonb_array_length(v_item.candidate_applications), 0);

    IF p_target_application_id IS NOT NULL THEN
      -- Target application MUST belong to the candidate application list
      SELECT EXISTS (
        SELECT 1 
        FROM jsonb_array_elements(coalesce(v_item.candidate_applications, '[]'::jsonb)) elem 
        WHERE (elem->>'id')::uuid = p_target_application_id
      ) INTO v_is_candidate;

      IF NOT v_is_candidate THEN
        RAISE EXCEPTION 'Invalid application selection: application % does not belong to the candidate list for review item %',
          p_target_application_id, p_review_item_id;
      END IF;

      v_target_app_id := p_target_application_id;

    ELSE
      -- No explicit target application provided
      IF v_candidate_count = 1 THEN
        v_target_app_id := (v_item.candidate_applications->0->>'id')::uuid;
      ELSIF v_candidate_count > 1 THEN
        RAISE EXCEPTION 'Ambiguous candidate match: review item contains % applications. Explicit target application selection is required.', v_candidate_count;
      ELSE
        -- Zero candidate applications matched: cannot approve a stage transition without a verified application match
        RAISE EXCEPTION 'Cannot approve review item %: no candidate application match found', p_review_item_id;
      END IF;
    END IF;

    -- Fetch and lock candidate application
    SELECT * INTO v_app
    FROM jobbot.job_applications
    WHERE id = v_target_app_id
    FOR UPDATE;

    IF v_app.id IS NULL THEN
      RAISE EXCEPTION 'Target application % does not exist', v_target_app_id;
    END IF;

    -- Map proposed hiring stage based on review classification
    IF lower(v_item.reason_code) = 'application_confirmation' OR lower(coalesce(v_item.proposed_stage, '')) IN ('applied confirmed', 'applied', 'confirmed') THEN
      v_proposed_stage := 'Applied Confirmed';
    ELSIF lower(v_item.reason_code) = 'assessment' OR lower(coalesce(v_item.proposed_stage, '')) IN ('assessment requested', 'assessment') THEN
      v_proposed_stage := 'Assessment Requested';
    ELSIF lower(v_item.reason_code) = 'interview_invitation' OR lower(coalesce(v_item.proposed_stage, '')) IN ('interview scheduled', 'interview', 'interviewing') THEN
      v_proposed_stage := 'Interview Scheduled';
    ELSIF lower(v_item.reason_code) = 'offer' OR lower(coalesce(v_item.proposed_stage, '')) IN ('offer received', 'offer') THEN
      v_proposed_stage := 'Offer Received';
    ELSIF lower(v_item.reason_code) = 'rejection' OR lower(coalesce(v_item.proposed_stage, '')) IN ('rejected', 'rejection') THEN
      v_proposed_stage := 'Rejected';
    ELSE
      v_proposed_stage := coalesce(v_app.hiring_stage, 'Applied Confirmed');
    END IF;

    -- Reference timestamps for chronology checks
    v_item_time := coalesce(v_item.event_at, v_item.created_at, now());
    
    SELECT max(event_at) INTO v_latest_app_event_time
    FROM jobbot.application_events
    WHERE application_id = v_app.id;

    v_app_reference_time := coalesce(v_latest_app_event_time, v_app.updated_at, v_app.verified_at, v_app.created_at, now());

    -- Critical defect 4 resolution (Part 1): Chronology & Out-of-Order Transition Rules
    -- Respect event chronology: a new rejection following an interview may be legitimate,
    -- while an old confirmation must not overwrite a later hiring outcome.
    v_stage_change_allowed := true;

    -- Rule 1: Application is already at 'Offer Received'
    IF v_app.hiring_stage = 'Offer Received' THEN
      IF v_proposed_stage = 'Rejected' THEN
        IF v_item_time < v_app_reference_time THEN
          v_stage_change_allowed := false;
          v_stage_notes := 'Suppressed out-of-order rejection: email timestamp (' || v_item_time || ') is older than offer (' || v_app_reference_time || ')';
        END IF;
      ELSIF v_proposed_stage IN ('Interview Scheduled', 'Assessment Requested', 'Applied Confirmed') THEN
        v_stage_change_allowed := false;
        v_stage_notes := 'Suppressed stage downgrade: application is already at Offer Received';
      END IF;

    -- Rule 2: Application is already at 'Rejected'
    ELSIF v_app.hiring_stage = 'Rejected' THEN
      IF v_proposed_stage IN ('Interview Scheduled', 'Assessment Requested', 'Applied Confirmed') THEN
        IF v_item_time <= v_app_reference_time THEN
          v_stage_change_allowed := false;
          v_stage_notes := 'Suppressed out-of-order stage update: email timestamp (' || v_item_time || ') is older than rejection (' || v_app_reference_time || ')';
        END IF;
      END IF;

    -- Rule 3: Application is already at 'Interview Scheduled'
    ELSIF v_app.hiring_stage = 'Interview Scheduled' THEN
      IF v_proposed_stage = 'Rejected' THEN
        -- A new rejection following an interview is legitimate if timestamp is >= interview event
        IF v_item_time < v_app_reference_time THEN
          v_stage_change_allowed := false;
          v_stage_notes := 'Suppressed out-of-order rejection: email timestamp (' || v_item_time || ') is older than interview (' || v_app_reference_time || ')';
        END IF;
      ELSIF v_proposed_stage IN ('Applied Confirmed', 'Assessment Requested') THEN
        v_stage_change_allowed := false;
        v_stage_notes := 'Suppressed stage downgrade: application is already at Interview Scheduled';
      END IF;

    -- Rule 4: Application is already at 'Assessment Requested'
    ELSIF v_app.hiring_stage = 'Assessment Requested' THEN
      IF v_proposed_stage = 'Rejected' THEN
        IF v_item_time < v_app_reference_time THEN
          v_stage_change_allowed := false;
          v_stage_notes := 'Suppressed out-of-order rejection: email timestamp (' || v_item_time || ') is older than assessment (' || v_app_reference_time || ')';
        END IF;
      ELSIF v_proposed_stage = 'Applied Confirmed' THEN
        v_stage_change_allowed := false;
        v_stage_notes := 'Suppressed stage downgrade: application is already at Assessment Requested';
      END IF;
    END IF;

    -- Effective hiring stage
    IF v_stage_change_allowed THEN
      v_effective_new_stage := v_proposed_stage;
    ELSE
      v_effective_new_stage := v_app.hiring_stage;
    END IF;

    -- Critical defect 4 resolution (Part 2): Submission Verification Status Preservation
    -- application_status represents submission-verification lifecycle:
    -- ('Preparing', 'Form Completed', 'Awaiting Approval', 'Submission Pending',
    --  'Submission Failed', 'Submitted Unverified', 'Applied Confirmed', 'Reported Submitted')
    --
    -- Remove unconditional conversion of Preparing, Submission Failed, Awaiting Approval, Submission Pending!
    -- Hiring communications ordinarily update hiring_stage, not submission verification fields.
    -- ONLY update submission-verification fields when directly supported by verified submission evidence
    -- (i.e. reason_code is application_confirmation AND application was in Submitted Unverified or Reported Submitted).
    IF (lower(v_item.reason_code) = 'application_confirmation' OR lower(coalesce(v_item.proposed_stage, '')) IN ('applied confirmed', 'applied', 'confirmed')) AND
       v_app.application_status IN ('Submitted Unverified', 'Reported Submitted') THEN
      v_new_status := 'Applied Confirmed';
      v_update_submission := true;
    ELSE
      v_new_status := v_app.application_status;
      v_update_submission := false;
    END IF;

    IF v_update_submission THEN
      v_new_verification_status := 'verified';
      v_new_verified_at := coalesce(v_app.verified_at, now());
      v_new_confirmation_ref := coalesce(v_app.confirmation_email_ref, v_item.message_id);
      -- Only update submission evidence when an actual application confirmation establishes it
      IF length(trim(coalesce(v_item.evidence_summary, ''))) > 0 AND 
         (v_app.submission_evidence IS NULL OR v_app.submission_evidence NOT LIKE '%' || v_item.evidence_summary || '%') THEN
        v_new_evidence := coalesce(v_app.submission_evidence, '') || 
          CASE WHEN length(coalesce(v_app.submission_evidence, '')) > 0 THEN E'\n---\n' ELSE '' END ||
          'Verified submission confirmation from recruitment email: ' || v_item.evidence_summary;
      ELSE
        v_new_evidence := v_app.submission_evidence;
      END IF;
    ELSE
      -- Hiring communications (rejection, interview, assessment, offer) do NOT alter submission-verification fields
      v_new_verification_status := v_app.verification_status;
      v_new_verified_at := v_app.verified_at;
      v_new_confirmation_ref := v_app.confirmation_email_ref;
      v_new_evidence := v_app.submission_evidence;
    END IF;

    -- Update job_applications atomically
    UPDATE jobbot.job_applications
    SET
      application_status = v_new_status,
      hiring_stage = v_effective_new_stage,
      verification_status = v_new_verification_status,
      verified_at = v_new_verified_at,
      confirmation_email_ref = v_new_confirmation_ref,
      submission_evidence = v_new_evidence,
      notes = coalesce(p_notes, v_app.notes),
      updated_at = now()
    WHERE id = v_app.id;

    v_app_updated := true;

    -- Critical defect 5 resolution: Record application_events row in the same transaction
    IF v_effective_new_stage IS DISTINCT FROM v_app.hiring_stage THEN
      INSERT INTO jobbot.application_events (
        id,
        application_id,
        event_type,
        previous_status,
        new_status,
        event_at,
        evidence_source,
        external_event_id,
        actor,
        verification_status,
        notes
      ) VALUES (
        gen_random_uuid(),
        v_app.id,
        'hiring_stage_change',
        v_app.hiring_stage,
        v_effective_new_stage,
        now(),
        'gmail_message:' || v_item.message_id,
        v_item.id::text,
        'user',
        v_new_verification_status,
        'Owner approved review item ' || v_item.id::text || ' (' || v_item.reason_code || '). ' || coalesce(v_stage_notes, p_notes, v_item.evidence_summary, '')
      );
    END IF;

    IF v_new_status IS DISTINCT FROM v_app.application_status THEN
      INSERT INTO jobbot.application_events (
        id,
        application_id,
        event_type,
        previous_status,
        new_status,
        event_at,
        evidence_source,
        external_event_id,
        actor,
        verification_status,
        notes
      ) VALUES (
        gen_random_uuid(),
        v_app.id,
        'status_change',
        v_app.application_status,
        v_new_status,
        now(),
        'gmail_message:' || v_item.message_id,
        v_item.id::text,
        'user',
        v_new_verification_status,
        'Submission verified by owner from recruitment email confirmation'
      );
    END IF;

    -- Update review item to 'resolved'
    UPDATE jobbot.recruitment_review_items
    SET
      state = 'resolved',
      resolved_application_id = v_target_app_id,
      updated_at = now()
    WHERE id = v_item.id;

    -- Update queue record to 'user_approved' / 'completed'
    IF v_queue.id IS NOT NULL THEN
      UPDATE jobbot.gmail_processing_queue
      SET
        review_status = 'user_approved',
        processing_status = 'completed',
        updated_at = now()
      WHERE id = v_queue.id;
    END IF;

    -- Immutable audit event
    INSERT INTO jobbot.outreach_audit (
      owner_id, entity_type, entity_id, operation, actor_id, event_at
    ) VALUES (
      v_uid, 'recruitment_review', v_item.id, 'owner_approve_proposal', v_uid, now()
    );

    RETURN jsonb_build_object(
      'status', 'approved',
      'review_item_id', v_item.id,
      'state', 'resolved',
      'target_application_id', v_target_app_id,
      'application_updated', v_app_updated,
      'updated_stage', v_effective_new_stage,
      'updated_status', v_new_status,
      'stage_notes', v_stage_notes
    );

  ELSIF lower(p_action) IN ('reject', 'ignore') THEN
    UPDATE jobbot.recruitment_review_items
    SET
      state = 'ignored',
      updated_at = now()
    WHERE id = v_item.id;

    IF v_queue.id IS NOT NULL THEN
      UPDATE jobbot.gmail_processing_queue
      SET
        review_status = 'user_rejected',
        processing_status = 'skipped',
        updated_at = now()
      WHERE id = v_queue.id;
    END IF;

    INSERT INTO jobbot.outreach_audit (
      owner_id, entity_type, entity_id, operation, actor_id, event_at
    ) VALUES (
      v_uid, 'recruitment_review', v_item.id, 'owner_reject_proposal', v_uid, now()
    );

    RETURN jsonb_build_object(
      'status', 'rejected',
      'review_item_id', v_item.id,
      'state', 'ignored'
    );

  ELSE -- needs_review
    UPDATE jobbot.recruitment_review_items
    SET
      evidence_summary = coalesce(v_item.evidence_summary, '') ||
        CASE WHEN p_notes IS NOT NULL THEN E'\n[Owner Note]: ' || p_notes ELSE '' END,
      updated_at = now()
    WHERE id = v_item.id;

    INSERT INTO jobbot.outreach_audit (
      owner_id, entity_type, entity_id, operation, actor_id, event_at
    ) VALUES (
      v_uid, 'recruitment_review', v_item.id, 'owner_flag_needs_review', v_uid, now()
    );

    RETURN jsonb_build_object(
      'status', 'needs_review',
      'review_item_id', v_item.id,
      'state', 'open'
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.jf_owner_resolve_recruitment_review(uuid, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.jf_owner_resolve_recruitment_review(uuid, text, text, uuid) TO authenticated;
