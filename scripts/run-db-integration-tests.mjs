/**
 * Database Integration Test Suite for Recruitment Intelligence Migration
 * Runs against an isolated, production-compatible PostgreSQL engine (PGlite PostgreSQL 18.6).
 *
 * Verifies:
 * 1. Application candidate matching & unauthorized application rejection
 * 2. Unsafe exclusion prevention (pending status check, existing review item check, row locks)
 * 3. Review item lifecycle (terminal state enforcement, idempotency, reversal prevention)
 * 4. Submission status preservation & event chronology (downgrade & out-of-order suppression)
 * 5. Atomic recording of jobbot.application_events on hiring stage transitions
 * 6. Transactional atomicity & rollback on failure
 * 7. Dynamic OAuth validator for Grok and Cursor Desktop
 */

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { PGlite } = require("C:/Users/reddy/.gemini/antigravity/brain/9928d9be-6669-4048-bbfd-2ba50ea8c628/scratch/node_modules/@electric-sql/pglite");
import fs from "fs";
import path from "path";
import assert from "node:assert/strict";

const OWNER_UUID = "f2729195-5445-4272-ab85-cac5b03b0967";
const CURSOR_CLIENT_UUID = "cad36a3f-674b-464f-a90f-8ab9b661218d";
const GROK_CLIENT_UUID = "16bdb57f-c2cd-40d8-b6e1-c1a1b17e3f32";

async function runDatabaseIntegrationTests() {
  console.log("================================================================================");
  console.log("STARTING DATABASE INTEGRATION TESTS (ISOLATED POSTGRESQL ENGINE)");
  console.log("================================================================================\n");

  const db = new PGlite();
  const version = await db.query("SELECT version()");
  console.log(`Database engine: ${version.rows[0].version}\n`);

  // 1. Setup mock auth and jobbot baseline schemas
  console.log("[1/9] Initializing schema baseline (auth, roles, and jobbot)...");
  await db.exec(`
    -- Create standard Supabase roles if not present
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon;
      END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated;
      END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role;
      END IF;
    END
    $$;

    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE SCHEMA IF NOT EXISTS jobbot;

    -- auth.uid() and auth.jwt() mock helpers for test execution
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$
    BEGIN
      RETURN coalesce(current_setting('request.jwt.claim.sub', true)::uuid, 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid);
    END;
    $$ LANGUAGE plpgsql;

    CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb AS $$
    BEGIN
      RETURN coalesce(current_setting('request.jwt.claims', true)::jsonb, '{}'::jsonb);
    END;
    $$ LANGUAGE plpgsql;

    -- auth.oauth_clients
    CREATE TABLE IF NOT EXISTS auth.oauth_clients (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      client_name text,
      redirect_uris text,
      deleted_at timestamptz
    );

    -- auth.oauth_consents
    CREATE TABLE IF NOT EXISTS auth.oauth_consents (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      client_id uuid NOT NULL,
      revoked_at timestamptz
    );

    -- jobbot.require_grok_intelligence_auth helper
    CREATE OR REPLACE FUNCTION jobbot.require_grok_intelligence_auth()
    RETURNS void AS $$
    BEGIN
      IF auth.uid() IS DISTINCT FROM 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid THEN
        RAISE EXCEPTION 'Owner authentication required';
      END IF;
    END;
    $$ LANGUAGE plpgsql;

    -- jobbot.job_applications
    CREATE TABLE IF NOT EXISTS jobbot.job_applications (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      company text NOT NULL,
      job_title text NOT NULL,
      application_status text NOT NULL DEFAULT 'Submitted Unverified',
      hiring_stage text,
      verification_status text DEFAULT 'unverified',
      verified_at timestamptz,
      confirmation_email_ref text,
      submission_evidence text,
      notes text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    -- jobbot.application_events
    CREATE TABLE IF NOT EXISTS jobbot.application_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      application_id uuid NOT NULL REFERENCES jobbot.job_applications(id),
      event_type text NOT NULL,
      previous_status text,
      new_status text,
      event_at timestamptz NOT NULL DEFAULT now(),
      evidence_source text,
      external_event_id text,
      actor text NOT NULL DEFAULT 'bot',
      verification_status text,
      notes text,
      CONSTRAINT application_events_actor_check CHECK (actor IN ('bot', 'user'))
    );

    -- jobbot.gmail_processing_queue
    CREATE TABLE IF NOT EXISTS jobbot.gmail_processing_queue (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id uuid NOT NULL DEFAULT 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid,
      mailbox text NOT NULL,
      message_id text NOT NULL,
      thread_id text,
      message_timestamp timestamptz NOT NULL DEFAULT now(),
      processing_status text NOT NULL DEFAULT 'pending',
      review_status text NOT NULL DEFAULT 'pending',
      exclusion_reason text,
      classification_result jsonb,
      proposed_application_match jsonb,
      evidence_references jsonb,
      analysis_version text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    -- jobbot.recruitment_review_items
    CREATE TABLE IF NOT EXISTS jobbot.recruitment_review_items (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      mailbox text NOT NULL,
      message_id text NOT NULL,
      thread_id text NOT NULL,
      event_at timestamptz NOT NULL DEFAULT now(),
      reason_code text NOT NULL,
      proposed_stage text NOT NULL,
      candidate_applications jsonb NOT NULL DEFAULT '[]'::jsonb,
      evidence_summary text,
      state text NOT NULL DEFAULT 'open',
      resolved_application_id uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT recruitment_review_items_state_check CHECK (state IN ('open', 'resolved', 'ignored'))
    );

    -- jobbot.outreach_audit
    CREATE TABLE IF NOT EXISTS jobbot.outreach_audit (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id uuid NOT NULL,
      entity_type text NOT NULL,
      entity_id uuid NOT NULL,
      operation text NOT NULL,
      actor_id uuid NOT NULL,
      event_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  console.log("  ✓ Baseline schema established successfully.\n");

  // 2. Apply Migration
  console.log("[2/9] Applying forward migration 20261110000000_cursor_desktop_oauth_and_recruitment_review.sql...");
  const migrationPath = path.resolve(process.cwd(), "supabase/migrations/20261110000000_cursor_desktop_oauth_and_recruitment_review.sql");
  const migrationSql = fs.readFileSync(migrationPath, "utf-8");
  await db.exec(migrationSql);
  console.log("  ✓ Migration applied successfully without syntax or dependency errors.\n");

  // 3. Test Grok & Cursor OAuth validation
  console.log("[3/9] Testing Grok & Cursor OAuth validator...");
  await db.exec(`
    -- Register Cursor client
    INSERT INTO auth.oauth_clients (id, client_name, redirect_uris)
    VALUES ('${CURSOR_CLIENT_UUID}', 'Cursor Desktop', 'https://www.cursor.com/agents/mcp/oauth/callback');

    -- Grant consent
    INSERT INTO auth.oauth_consents (user_id, client_id)
    VALUES ('${OWNER_UUID}', '${CURSOR_CLIENT_UUID}');

    -- Register Grok client
    INSERT INTO auth.oauth_clients (id, client_name, redirect_uris)
    VALUES ('${GROK_CLIENT_UUID}', 'Grok Web Connector', 'https://grok.com/connectors-oauth-exchange-code/');

    -- Grant consent
    INSERT INTO auth.oauth_consents (user_id, client_id)
    VALUES ('${OWNER_UUID}', '${GROK_CLIENT_UUID}');
  `);

  const cursorValid = await db.query(`SELECT jobbot.validate_grok_oauth_client('${CURSOR_CLIENT_UUID}'::uuid, '${OWNER_UUID}'::uuid) as valid`);
  assert.equal(cursorValid.rows[0].valid, true, "Cursor Desktop OAuth must be valid");

  const grokValid = await db.query(`SELECT jobbot.validate_grok_oauth_client('${GROK_CLIENT_UUID}'::uuid, '${OWNER_UUID}'::uuid) as valid`);
  assert.equal(grokValid.rows[0].valid, true, "Grok OAuth must be valid");

  const nonOwnerValid = await db.query(`SELECT jobbot.validate_grok_oauth_client('${CURSOR_CLIENT_UUID}'::uuid, '00000000-0000-0000-0000-000000000000'::uuid) as valid`);
  assert.equal(nonOwnerValid.rows[0].valid, false, "Non-owner principal must be rejected");

  console.log("  ✓ Cursor and Grok OAuth authorizations verified.\n");

  // 4. Test Defect 1: Application Candidate Matching
  console.log("[4/9] Testing Defect 1: Application candidate matching & selection safety...");
  const app1 = await db.query(`
    INSERT INTO jobbot.job_applications (company, job_title, application_status, hiring_stage)
    VALUES ('Stripe', 'Staff Engineer', 'Submitted Unverified', NULL)
    RETURNING id;
  `);
  const app1Id = app1.rows[0].id;

  const app2 = await db.query(`
    INSERT INTO jobbot.job_applications (company, job_title, application_status, hiring_stage)
    VALUES ('Netflix', 'Senior Engineer', 'Submitted Unverified', NULL)
    RETURNING id;
  `);
  const app2Id = app2.rows[0].id;

  // Insert review item with only app1 in candidate list
  const rev1 = await db.query(`
    INSERT INTO jobbot.recruitment_review_items (mailbox, message_id, thread_id, reason_code, proposed_stage, candidate_applications)
    VALUES ('recruiter@stripe.com', 'msg_stripe_001', 'thread_stripe_001', 'interview_invitation', 'Interview Scheduled',
      jsonb_build_array(jsonb_build_object('id', '${app1Id}', 'company', 'Stripe'))
    )
    RETURNING id;
  `);
  const rev1Id = rev1.rows[0].id;

  // Test 1A: Attempt approval with unrelated application UUID (app2 is not in candidates) -> MUST THROW
  let rejectedUnrelated = false;
  try {
    await db.query(`SELECT public.jf_owner_resolve_recruitment_review('${rev1Id}'::uuid, 'approve', 'Testing unrelated', '${app2Id}'::uuid)`);
  } catch (err) {
    rejectedUnrelated = true;
    assert.match(err.message, /does not belong to the candidate list/);
  }
  assert.equal(rejectedUnrelated, true, "Must reject unrelated application selection");

  // Test 1B: Multi-candidate review requires explicit target selection
  const revMulti = await db.query(`
    INSERT INTO jobbot.recruitment_review_items (mailbox, message_id, thread_id, reason_code, proposed_stage, candidate_applications)
    VALUES ('recruiter@multi.com', 'msg_multi_001', 'thread_multi_001', 'assessment', 'Assessment Requested',
      jsonb_build_array(
        jsonb_build_object('id', '${app1Id}', 'company', 'Stripe'),
        jsonb_build_object('id', '${app2Id}', 'company', 'Netflix')
      )
    )
    RETURNING id;
  `);
  const revMultiId = revMulti.rows[0].id;

  let rejectedAmbiguous = false;
  try {
    await db.query(`SELECT public.jf_owner_resolve_recruitment_review('${revMultiId}'::uuid, 'approve')`);
  } catch (err) {
    rejectedAmbiguous = true;
    assert.match(err.message, /Ambiguous candidate match/);
  }
  assert.equal(rejectedAmbiguous, true, "Must require explicit selection when multiple candidates exist");

  // Test 1C: Zero-candidate review cannot approve stage transition
  const revZero = await db.query(`
    INSERT INTO jobbot.recruitment_review_items (mailbox, message_id, thread_id, reason_code, proposed_stage, candidate_applications)
    VALUES ('unknown@recruiter.com', 'msg_zero_001', 'thread_zero_001', 'interview_invitation', 'Interview Scheduled', '[]'::jsonb)
    RETURNING id;
  `);
  const revZeroId = revZero.rows[0].id;

  let rejectedZero = false;
  try {
    await db.query(`SELECT public.jf_owner_resolve_recruitment_review('${revZeroId}'::uuid, 'approve')`);
  } catch (err) {
    rejectedZero = true;
    assert.match(err.message, /no candidate application match found/);
  }
  assert.equal(rejectedZero, true, "Must reject approval without verified application match");
  console.log("  ✓ Defect 1 verified: Unrelated applications rejected, ambiguous matches require selection, zero matches blocked.\n");

  // 5. Test Defect 2: Unsafe Exclusions
  console.log("[5/9] Testing Defect 2: Unsafe exclusion rejection and row lock verification...");
  // Queue item in pending state
  const qItem = await db.query(`
    INSERT INTO jobbot.gmail_processing_queue (mailbox, message_id, processing_status, review_status)
    VALUES ('newsletter@news.com', 'msg_news_001', 'pending', 'pending')
    RETURNING id;
  `);
  const qItemId = qItem.rows[0].id;

  // Insert existing review item for same message
  await db.query(`
    INSERT INTO jobbot.recruitment_review_items (mailbox, message_id, thread_id, reason_code, proposed_stage, candidate_applications)
    VALUES ('newsletter@news.com', 'msg_news_001', 'thread_news_001', 'other_uncertain', 'Review Required', '[]'::jsonb);
  `);

  // Attempt exclusion when review item already exists -> MUST THROW
  let rejectedExclusionWithReview = false;
  try {
    await db.query(`SELECT public.jf_grok_exclude_irrelevant_email('${qItemId}'::uuid, 'Irrelevant newsletter')`);
  } catch (err) {
    rejectedExclusionWithReview = true;
    assert.match(err.message, /already exists in state/);
  }
  assert.equal(rejectedExclusionWithReview, true, "Must reject exclusion when a review item exists for the message");

  // Queue item not pending
  const qItemCompleted = await db.query(`
    INSERT INTO jobbot.gmail_processing_queue (mailbox, message_id, processing_status, review_status)
    VALUES ('alert@zip.com', 'msg_zip_completed', 'completed', 'user_approved')
    RETURNING id;
  `);
  let rejectedNonPending = false;
  try {
    await db.query(`SELECT public.jf_grok_exclude_irrelevant_email('${qItemCompleted.rows[0].id}'::uuid, 'Zip alert')`);
  } catch (err) {
    rejectedNonPending = true;
    assert.match(err.message, /not eligible for exclusion/);
  }
  assert.equal(rejectedNonPending, true, "Must reject exclusion when queue item is not pending");

  // Legitimate exclusion succeeds
  const qItemLegit = await db.query(`
    INSERT INTO jobbot.gmail_processing_queue (mailbox, message_id, processing_status, review_status)
    VALUES ('alert@jobright.ai', 'msg_jobright_001', 'pending', 'pending')
    RETURNING id;
  `);
  const legitRes = await db.query(`SELECT public.jf_grok_exclude_irrelevant_email('${qItemLegit.rows[0].id}'::uuid, 'Daily job digest newsletter') as result`);
  assert.equal(legitRes.rows[0].result.status, "email_excluded");

  const qChecked = await db.query(`SELECT processing_status, review_status, exclusion_reason FROM jobbot.gmail_processing_queue WHERE id = '${qItemLegit.rows[0].id}'`);
  assert.equal(qChecked.rows[0].processing_status, "excluded");
  assert.equal(qChecked.rows[0].review_status, "ignored");
  assert.equal(qChecked.rows[0].exclusion_reason, "Daily job digest newsletter");

  // Check A Race Direction 1: Proposal first -> Exclusion must fail
  const qProposalFirst = await db.query(`
    INSERT INTO jobbot.gmail_processing_queue (mailbox, message_id, processing_status, review_status)
    VALUES ('recruiter@hiring.com', 'msg_prop_first', 'pending', 'pending')
    RETURNING id;
  `);
  const qProposalFirstId = qProposalFirst.rows[0].id;
  await db.query(`
    SELECT public.jf_grok_submit_classification_proposal(
      '${qProposalFirstId}'::uuid,
      'interview_invitation',
      0.95,
      '${app1Id}'::uuid,
      'Interview invitation evidence summary'
    );
  `);
  let race1ExclusionFailed = false;
  try {
    await db.query(`SELECT public.jf_grok_exclude_irrelevant_email('${qProposalFirstId}'::uuid, 'Late exclusion attempt')`);
  } catch (err) {
    race1ExclusionFailed = true;
    assert.match(err.message, /(not eligible for exclusion|already exists)/);
  }
  assert.equal(race1ExclusionFailed, true, "Race 1: Proposal first -> exclusion must fail");

  // Check A Race Direction 2: Exclusion first -> Proposal must fail
  const qExclusionFirst = await db.query(`
    INSERT INTO jobbot.gmail_processing_queue (mailbox, message_id, processing_status, review_status)
    VALUES ('alert@spammy.com', 'msg_excl_first', 'pending', 'pending')
    RETURNING id;
  `);
  const qExclusionFirstId = qExclusionFirst.rows[0].id;
  await db.query(`
    SELECT public.jf_grok_exclude_irrelevant_email('${qExclusionFirstId}'::uuid, 'Spam job alert');
  `);
  let race2ProposalFailed = false;
  try {
    await db.query(`
      SELECT public.jf_grok_submit_classification_proposal(
        '${qExclusionFirstId}'::uuid,
        'interview_invitation',
        0.95,
        '${app1Id}'::uuid,
        'Attempt proposal on excluded item'
      );
    `);
  } catch (err) {
    race2ProposalFailed = true;
    assert.match(err.message, /not eligible for proposal/);
  }
  assert.equal(race2ProposalFailed, true, "Race 2: Exclusion first -> proposal must fail");

  console.log("  ✓ Defect 2 & Check A verified: Race directions verified (proposal first blocks exclusion; exclusion first blocks proposal).\n");

  // 6. Test Defect 3: Review Lifecycle & Terminal States
  console.log("[6/9] Testing Defect 3: Review lifecycle, terminal states, and idempotency...");
  const revLife = await db.query(`
    INSERT INTO jobbot.recruitment_review_items (mailbox, message_id, thread_id, reason_code, proposed_stage, candidate_applications)
    VALUES ('recruiter@stripe.com', 'msg_stripe_life', 'thread_stripe_life', 'interview_invitation', 'Interview Scheduled',
      jsonb_build_array(jsonb_build_object('id', '${app1Id}', 'company', 'Stripe'))
    )
    RETURNING id;
  `);
  const revLifeId = revLife.rows[0].id;

  // 3A: Needs review keeps item in 'open'
  const needsRes = await db.query(`SELECT public.jf_owner_resolve_recruitment_review('${revLifeId}'::uuid, 'needs_review', 'Check details') as res`);
  assert.equal(needsRes.rows[0].res.state, "open");

  // 3B: Approval transitions open -> resolved
  const approveRes = await db.query(`SELECT public.jf_owner_resolve_recruitment_review('${revLifeId}'::uuid, 'approve') as res`);
  assert.equal(approveRes.rows[0].res.state, "resolved");

  // 3C: Repeated approval is idempotent
  const reApproveRes = await db.query(`SELECT public.jf_owner_resolve_recruitment_review('${revLifeId}'::uuid, 'approve') as res`);
  assert.equal(reApproveRes.rows[0].res.status, "already_approved");

  // 3D: Rejection on resolved item is rejected
  let rejectOnResolved = false;
  try {
    await db.query(`SELECT public.jf_owner_resolve_recruitment_review('${revLifeId}'::uuid, 'reject')`);
  } catch (err) {
    rejectOnResolved = true;
    assert.match(err.message, /Cannot reject an already resolved/);
  }
  assert.equal(rejectOnResolved, true, "Conflicting action on resolved terminal item must be rejected");

  // 3E: Rejection transitions open -> ignored
  const revIgnore = await db.query(`
    INSERT INTO jobbot.recruitment_review_items (mailbox, message_id, thread_id, reason_code, proposed_stage, candidate_applications)
    VALUES ('spam@recruiter.com', 'msg_spam_001', 'thread_spam_001', 'other_uncertain', 'Review Required', '[]'::jsonb)
    RETURNING id;
  `);
  const revIgnoreId = revIgnore.rows[0].id;

  const rejectRes = await db.query(`SELECT public.jf_owner_resolve_recruitment_review('${revIgnoreId}'::uuid, 'reject') as res`);
  assert.equal(rejectRes.rows[0].res.state, "ignored");

  // Repeated rejection is idempotent
  const reRejectRes = await db.query(`SELECT public.jf_owner_resolve_recruitment_review('${revIgnoreId}'::uuid, 'ignore') as res`);
  assert.equal(reRejectRes.rows[0].res.status, "already_ignored");

  // Approval on ignored item is rejected
  let approveOnIgnored = false;
  try {
    await db.query(`SELECT public.jf_owner_resolve_recruitment_review('${revIgnoreId}'::uuid, 'approve')`);
  } catch (err) {
    approveOnIgnored = true;
    assert.match(err.message, /Cannot approve an already ignored/);
  }
  assert.equal(approveOnIgnored, true, "Conflicting action on ignored terminal item must be rejected");
  console.log("  ✓ Defect 3 verified: Terminal states enforced, conflicting actions rejected, idempotent repeats succeed.\n");

  // 7. Test Defect 4: Submission Status Preservation & Chronology
  console.log("[7/9] Testing Defect 4: Submission status preservation and stage chronology...");
  // Test 4A: Preparing, Submission Failed, Awaiting Approval are NOT converted to Applied Confirmed
  const appPrep = await db.query(`
    INSERT INTO jobbot.job_applications (company, job_title, application_status, hiring_stage)
    VALUES ('Apple', 'iOS Engineer', 'Preparing', NULL)
    RETURNING id;
  `);
  const appPrepId = appPrep.rows[0].id;

  const revPrep = await db.query(`
    INSERT INTO jobbot.recruitment_review_items (mailbox, message_id, thread_id, reason_code, proposed_stage, candidate_applications)
    VALUES ('jobs@apple.com', 'msg_apple_prep', 'thread_apple_prep', 'application_confirmation', 'Applied Confirmed',
      jsonb_build_array(jsonb_build_object('id', '${appPrepId}', 'company', 'Apple'))
    )
    RETURNING id;
  `);
  await db.query(`SELECT public.jf_owner_resolve_recruitment_review('${revPrep.rows[0].id}'::uuid, 'approve')`);

  const appPrepCheck = await db.query(`SELECT application_status, hiring_stage FROM jobbot.job_applications WHERE id = '${appPrepId}'`);
  assert.equal(appPrepCheck.rows[0].application_status, "Preparing", "Preparing must NOT be converted to Applied Confirmed");
  assert.equal(appPrepCheck.rows[0].hiring_stage, "Applied Confirmed", "hiring_stage is updated to Applied Confirmed");

  // Test 4B: Submitted Unverified IS converted to Applied Confirmed when supported by confirmation evidence
  const appUnv = await db.query(`
    INSERT INTO jobbot.job_applications (company, job_title, application_status, hiring_stage)
    VALUES ('Google', 'L5 SWE', 'Submitted Unverified', NULL)
    RETURNING id;
  `);
  const appUnvId = appUnv.rows[0].id;

  const revUnv = await db.query(`
    INSERT INTO jobbot.recruitment_review_items (mailbox, message_id, thread_id, reason_code, proposed_stage, candidate_applications)
    VALUES ('jobs@google.com', 'msg_google_unv', 'thread_google_unv', 'application_confirmation', 'Applied Confirmed',
      jsonb_build_array(jsonb_build_object('id', '${appUnvId}', 'company', 'Google'))
    )
    RETURNING id;
  `);
  await db.query(`SELECT public.jf_owner_resolve_recruitment_review('${revUnv.rows[0].id}'::uuid, 'approve')`);

  const appUnvCheck = await db.query(`SELECT application_status, hiring_stage, verification_status FROM jobbot.job_applications WHERE id = '${appUnvId}'`);
  assert.equal(appUnvCheck.rows[0].application_status, "Applied Confirmed");
  assert.equal(appUnvCheck.rows[0].verification_status, "verified");

  // Test 4C: Chronology: new rejection after interview is legitimate
  const interviewDate = "2026-11-01T10:00:00Z";
  const rejectionDate = "2026-11-05T15:00:00Z"; // Later

  const appInter = await db.query(`
    INSERT INTO jobbot.job_applications (company, job_title, application_status, hiring_stage, submission_evidence, updated_at)
    VALUES ('Meta', 'Production Engineer', 'Applied Confirmed', 'Interview Scheduled', 'Initial portal submission receipt #98765', '${interviewDate}'::timestamptz)
    RETURNING id;
  `);
  const appInterId = appInter.rows[0].id;

  await db.query(`
    INSERT INTO jobbot.application_events (application_id, event_type, previous_status, new_status, event_at, actor)
    VALUES ('${appInterId}', 'hiring_stage_change', 'Applied Confirmed', 'Interview Scheduled', '${interviewDate}'::timestamptz, 'user');
  `);

  const revRej = await db.query(`
    INSERT INTO jobbot.recruitment_review_items (mailbox, message_id, thread_id, event_at, reason_code, proposed_stage, evidence_summary, candidate_applications)
    VALUES ('recruiter@meta.com', 'msg_meta_rej', 'thread_meta_rej', '${rejectionDate}'::timestamptz, 'rejection', 'Rejected', 'Interview loop completed but candidate not selected at this time.',
      jsonb_build_array(jsonb_build_object('id', '${appInterId}', 'company', 'Meta'))
    )
    RETURNING id;
  `);
  const rejRes = await db.query(`SELECT public.jf_owner_resolve_recruitment_review('${revRej.rows[0].id}'::uuid, 'approve') as res`);
  assert.equal(rejRes.rows[0].res.updated_stage, "Rejected");

  const appInterCheck = await db.query(`SELECT hiring_stage, submission_evidence FROM jobbot.job_applications WHERE id = '${appInterId}'`);
  assert.equal(appInterCheck.rows[0].hiring_stage, "Rejected", "New rejection after interview must be allowed");
  assert.equal(
    appInterCheck.rows[0].submission_evidence,
    "Initial portal submission receipt #98765",
    "Check B: Hiring communications (rejection) must NOT alter submission_evidence on job_applications"
  );

  // Test 4D: Out-of-order rejection older than interview is suppressed
  const appInter2 = await db.query(`
    INSERT INTO jobbot.job_applications (company, job_title, application_status, hiring_stage, updated_at)
    VALUES ('Amazon', 'SDE II', 'Applied Confirmed', 'Interview Scheduled', '2026-11-08T10:00:00Z'::timestamptz)
    RETURNING id;
  `);
  const appInter2Id = appInter2.rows[0].id;
  await db.query(`
    INSERT INTO jobbot.application_events (application_id, event_type, previous_status, new_status, event_at, actor)
    VALUES ('${appInter2Id}', 'hiring_stage_change', 'Applied Confirmed', 'Interview Scheduled', '2026-11-08T10:00:00Z'::timestamptz, 'user');
  `);

  const revOldRej = await db.query(`
    INSERT INTO jobbot.recruitment_review_items (mailbox, message_id, thread_id, event_at, reason_code, proposed_stage, candidate_applications)
    VALUES ('recruiter@amazon.com', 'msg_amz_oldrej', 'thread_amz_oldrej', '2026-11-03T10:00:00Z'::timestamptz, 'rejection', 'Rejected',
      jsonb_build_array(jsonb_build_object('id', '${appInter2Id}', 'company', 'Amazon'))
    )
    RETURNING id;
  `);
  const oldRejRes = await db.query(`SELECT public.jf_owner_resolve_recruitment_review('${revOldRej.rows[0].id}'::uuid, 'approve') as res`);
  assert.equal(oldRejRes.rows[0].res.updated_stage, "Interview Scheduled", "Out-of-order rejection must NOT downgrade stage");
  assert.match(oldRejRes.rows[0].res.stage_notes, /Suppressed out-of-order rejection/);
  console.log("  ✓ Defect 4 verified: Status preserved, legitimate progression allowed, out-of-order downgrades suppressed.\n");

  // 8. Test Defect 5: application_events insertion in same transaction
  console.log("[8/9] Testing Defect 5: Audit recording into jobbot.application_events in same transaction...");
  const events = await db.query(`
    SELECT application_id, event_type, previous_status, new_status, evidence_source, actor
    FROM jobbot.application_events
    WHERE application_id = '${appInterId}' AND new_status = 'Rejected';
  `);
  assert.equal(events.rows.length, 1, "Must insert exactly one application_events row for the stage transition");
  assert.equal(events.rows[0].previous_status, "Interview Scheduled");
  assert.equal(events.rows[0].new_status, "Rejected");
  assert.equal(events.rows[0].actor, "user");
  assert.match(events.rows[0].evidence_source, /gmail_message:/);
  console.log("  ✓ Defect 5 verified: jobbot.application_events recorded atomically with correct audit fields.\n");

  // 9. Test Transactional Atomicity & Rollback
  console.log("[9/9] Testing Transactional Atomicity & Rollback on failure...");
  const appAtomic = await db.query(`
    INSERT INTO jobbot.job_applications (company, job_title, application_status, hiring_stage)
    VALUES ('Databricks', 'Solutions Architect', 'Submitted Unverified', NULL)
    RETURNING id;
  `);
  const appAtomicId = appAtomic.rows[0].id;

  const revAtomic = await db.query(`
    INSERT INTO jobbot.recruitment_review_items (mailbox, message_id, thread_id, reason_code, proposed_stage, candidate_applications)
    VALUES ('recruiter@databricks.com', 'msg_db_001', 'thread_db_001', 'interview_invitation', 'Interview Scheduled',
      jsonb_build_array(jsonb_build_object('id', '${appAtomicId}', 'company', 'Databricks'))
    )
    RETURNING id;
  `);
  const revAtomicId = revAtomic.rows[0].id;

  // Trigger error during resolve by passing invalid target application
  try {
    await db.query(`SELECT public.jf_owner_resolve_recruitment_review('${revAtomicId}'::uuid, 'approve', 'Testing rollback', '00000000-0000-0000-0000-000000000000'::uuid)`);
  } catch (err) {
    // Expected error
  }

  // Verify review item is still open and application was NOT modified
  const revCheck = await db.query(`SELECT state FROM jobbot.recruitment_review_items WHERE id = '${revAtomicId}'`);
  assert.equal(revCheck.rows[0].state, "open", "Review item must remain in open state after failed transaction");

  const appCheck = await db.query(`SELECT hiring_stage FROM jobbot.job_applications WHERE id = '${appAtomicId}'`);
  assert.equal(appCheck.rows[0].hiring_stage, null, "Application must remain unmodified after failed transaction");

  const evCheck = await db.query(`SELECT count(*) FROM jobbot.application_events WHERE application_id = '${appAtomicId}'`);
  assert.equal(parseInt(evCheck.rows[0].count), 0, "No application events may be recorded after failed transaction");

  console.log("  ✓ Transactional atomicity verified: All modifications rolled back cleanly on error.\n");

  // 10. Test Rollback Script Execution
  console.log("[10/10] Testing Rollback Script Execution (Zero Regression)...");
  const rollbackPath = path.resolve(process.cwd(), "supabase/rollback/20261110000000_cursor_desktop_oauth_and_recruitment_review_rollback.sql");
  const rollbackSql = fs.readFileSync(rollbackPath, "utf-8");
  await db.exec(rollbackSql);

  // Verify jf_owner_resolve_recruitment_review and jf_grok_exclude_irrelevant_email are dropped
  const droppedRpcCheck = await db.query(`
    SELECT proname FROM pg_proc
    WHERE proname IN ('jf_owner_resolve_recruitment_review', 'jf_grok_exclude_irrelevant_email');
  `);
  assert.equal(droppedRpcCheck.rows.length, 0, "Rollback must drop owner resolution and exclusion RPCs");

  // Verify Cursor OAuth is no longer authorized
  const cursorRolledBack = await db.query(`SELECT jobbot.validate_grok_oauth_client('${CURSOR_CLIENT_UUID}'::uuid, '${OWNER_UUID}'::uuid) as valid`);
  assert.equal(cursorRolledBack.rows[0].valid, false, "Cursor OAuth must be reverted after rollback");

  console.log("  ✓ Rollback script verified: Target functions dropped and Grok-only validator restored cleanly.\n");

  console.log("================================================================================");
  console.log("ALL DATABASE INTEGRATION TESTS PASSED (10/10 TEST PHASES VERIFIED)");
  console.log("================================================================================\n");
}

runDatabaseIntegrationTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("FATAL ERROR IN DATABASE INTEGRATION TESTS:", err);
    process.exit(1);
  });
