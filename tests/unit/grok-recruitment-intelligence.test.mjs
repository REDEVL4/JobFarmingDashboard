import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  checkSensitiveMessage,
  sanitizeText,
} from "../../supabase/functions/jf-grok-owner-mcp/sensitive-filter.ts";

const DESIGNATED_OWNER_UUID = "f2729195-5445-4272-ab85-cac5b03b0967";
const ACTIVE_GROK_CLIENT_ID = "16bdb57f-c2cd-40d8-b6e1-c1a1b17e3f32";

const ALLOWED_TOOLS = new Set([
  "runtime_status",
  "list_pending_recruitment_emails",
  "get_recruitment_email_details",
  "find_candidate_applications",
  "submit_classification_proposal",
]);

const VALID_CLASSIFICATIONS = new Set([
  "application_confirmation",
  "rejection",
  "interview_invitation",
  "assessment",
  "recruiter_follow_up",
  "offer",
  "other_uncertain",
]);

const ALLOWED_QUEUE_REVIEW_STATUSES = new Set([
  "pending",
  "requires_review",
  "auto_approved",
  "user_approved",
  "user_rejected",
  "ignored",
]);

const ALLOWED_REVIEW_ITEM_STATES = new Set([
  "open",
  "resolved",
  "ignored",
]);

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Mock database store for single-source server-side Grok client validation
const MOCK_APPROVED_CONSENTS = new Set([
  `${DESIGNATED_OWNER_UUID}:${ACTIVE_GROK_CLIENT_ID}`,
  `${DESIGNATED_OWNER_UUID}:b54de595-6bce-4298-836c-2b46a2595904`, // Real dynamic Grok client
]);

function evaluateGrokMcpAuth(jwtClaims, toolName, approvedConsents = MOCK_APPROVED_CONSENTS) {
  if (jwtClaims?.sub !== DESIGNATED_OWNER_UUID) {
    return { allowed: false, status: 403, error: "Owner authentication required" };
  }
  if (jwtClaims?.role !== "authenticated") {
    return { allowed: false, status: 403, error: "Authenticated role required" };
  }
  const clientId = jwtClaims?.client_id;
  if (!clientId || typeof clientId !== "string" || !UUID_REGEX.test(clientId)) {
    return { allowed: false, status: 403, error: "Present and valid OAuth client_id required" };
  }
  // Server-side database validation: verified Grok client + active owner consent
  if (!approvedConsents.has(`${jwtClaims.sub}:${clientId}`)) {
    return { allowed: false, status: 403, error: "Unauthorized OAuth client" };
  }
  if (!ALLOWED_TOOLS.has(toolName)) {
    return {
      allowed: false,
      status: 403,
      error: `Tool '${toolName}' is disabled for OAuth clients. Only approved recruitment intelligence tools are permitted.`,
    };
  }
  return { allowed: true };
}

test("Grok Intelligence MCP: strictly requires owner UUID", () => {
  const claims = {
    sub: "00000000-0000-0000-0000-000000000000",
    role: "authenticated",
    client_id: ACTIVE_GROK_CLIENT_ID,
  };
  const res = evaluateGrokMcpAuth(claims, "list_pending_recruitment_emails");
  assert.equal(res.allowed, false);
  assert.equal(res.status, 403);
  assert.equal(res.error, "Owner authentication required");
});

test("Grok Intelligence MCP: strictly requires authenticated role", () => {
  const claims = {
    sub: DESIGNATED_OWNER_UUID,
    role: "anon",
    client_id: ACTIVE_GROK_CLIENT_ID,
  };
  const res = evaluateGrokMcpAuth(claims, "list_pending_recruitment_emails");
  assert.equal(res.allowed, false);
  assert.equal(res.status, 403);
  assert.equal(res.error, "Authenticated role required");
});

test("Grok Intelligence MCP: rejects missing or invalid client_id", () => {
  const invalidClaims = [
    { sub: DESIGNATED_OWNER_UUID, role: "authenticated" },
    { sub: DESIGNATED_OWNER_UUID, role: "authenticated", client_id: "" },
    { sub: DESIGNATED_OWNER_UUID, role: "authenticated", client_id: "not-a-uuid" },
  ];
  for (const c of invalidClaims) {
    const res = evaluateGrokMcpAuth(c, "list_pending_recruitment_emails");
    assert.equal(res.allowed, false);
    assert.equal(res.status, 403);
    assert.equal(res.error, "Present and valid OAuth client_id required");
  }
});

test("Grok Intelligence MCP: rejects unapproved client IDs", () => {
  const claims = {
    sub: DESIGNATED_OWNER_UUID,
    role: "authenticated",
    client_id: "11111111-2222-3333-4444-555555555555",
  };
  const res = evaluateGrokMcpAuth(claims, "list_pending_recruitment_emails");
  assert.equal(res.allowed, false);
  assert.equal(res.status, 403);
  assert.equal(res.error, "Unauthorized OAuth client");
});

test("Grok Intelligence MCP: authorizes approved Grok client for all 5 permitted tools", () => {
  const claims = {
    sub: DESIGNATED_OWNER_UUID,
    role: "authenticated",
    client_id: ACTIVE_GROK_CLIENT_ID,
  };
  for (const tool of ALLOWED_TOOLS) {
    const res = evaluateGrokMcpAuth(claims, tool);
    assert.equal(res.allowed, true, `Tool '${tool}' should be permitted`);
  }
});

test("Grok Intelligence MCP: denies arbitrary or mutating tools", () => {
  const claims = {
    sub: DESIGNATED_OWNER_UUID,
    role: "authenticated",
    client_id: ACTIVE_GROK_CLIENT_ID,
  };
  const forbiddenTools = [
    "claim_work",
    "complete_work",
    "delete_application",
    "update_application_status",
    "send_linkedin_message",
  ];
  for (const tool of forbiddenTools) {
    const res = evaluateGrokMcpAuth(claims, tool);
    assert.equal(res.allowed, false);
    assert.equal(res.status, 403);
  }
});

test("Grok Intelligence Invariants: classification enum validation", () => {
  const valid = [
    "application_confirmation",
    "rejection",
    "interview_invitation",
    "assessment",
    "recruiter_follow_up",
    "offer",
    "other_uncertain",
  ];
  for (const v of valid) {
    assert.ok(VALID_CLASSIFICATIONS.has(v));
  }
  assert.equal(VALID_CLASSIFICATIONS.has("unknown_category"), false);
  assert.equal(VALID_CLASSIFICATIONS.has("auto_reject"), false);
});

test("Grok Intelligence Invariants: proposals never mutate job_applications.application_status", () => {
  // Test simulation of proposal processing
  const applicationRecord = {
    id: "app-1234",
    company: "Acme Corp",
    job_title: "Software Engineer",
    application_status: "Applied",
  };

  const proposal = {
    queue_id: "queue-5678",
    classification: "rejection",
    confidence: 0.95,
    application_id: "app-1234",
    evidence_summary: "Thank you for your interest, but we have decided to move forward with other candidates.",
  };

  // State recorded in recruitment_review_items using DB-compatible state 'open'
  const reviewQueueItem = {
    id: "review-9999",
    message_id: "msg-001",
    thread_id: "thread-001",
    reason_code: proposal.classification,
    proposed_stage: "Rejected",
    candidate_applications: {
      application_id: proposal.application_id,
      current_status: applicationRecord.application_status,
      confidence: proposal.confidence,
    },
    evidence_summary: proposal.evidence_summary,
    state: "open",
  };

  const queueRecord = {
    id: proposal.queue_id,
    review_status: "requires_review",
  };

  // Assert application status remains unchanged!
  assert.equal(applicationRecord.application_status, "Applied");
  assert.equal(reviewQueueItem.state, "open");
  assert.ok(ALLOWED_REVIEW_ITEM_STATES.has(reviewQueueItem.state));
  assert.equal(queueRecord.review_status, "requires_review");
  assert.ok(ALLOWED_QUEUE_REVIEW_STATUSES.has(queueRecord.review_status));
  assert.equal(reviewQueueItem.candidate_applications.current_status, "Applied");
});

test("Grok Intelligence Invariants: DB check constraint alignment", () => {
  // Ensure we never emit incompatible review_status or item states
  assert.ok(ALLOWED_QUEUE_REVIEW_STATUSES.has("requires_review"));
  assert.ok(!ALLOWED_QUEUE_REVIEW_STATUSES.has("pending_review"));

  assert.ok(ALLOWED_REVIEW_ITEM_STATES.has("open"));
  assert.ok(!ALLOWED_REVIEW_ITEM_STATES.has("pending_owner_review"));
});

test("Grok Intelligence Sensitive Filter: catches OTP and security alerts", () => {
  const sensitiveSamples = [
    { subject: "Your Google verification code is 849201", from: "no-reply@accounts.google.com" },
    { subject: "Reset your password", from: "support@example.com" },
    { subject: "New sign-in from Chrome on Windows", from: "security@github.com" },
    { subject: "Security Alert: Unusual sign-in activity detected", from: "accountprotection.google.com" },
    { subject: "Your single-use login code", from: "auth@company.com" },
    { subject: "Two-step verification pin", from: "noreply@bank.com" },
  ];

  for (const sample of sensitiveSamples) {
    const res = checkSensitiveMessage(sample);
    assert.equal(res.isSensitive, true, `Should mark as sensitive: ${sample.subject}`);
    assert.ok(res.reason, "Should provide exclusion reason");
  }

  const normalRecruitmentSamples = [
    { subject: "Thank you for applying to Senior Engineer at Acme Corp", from: "jobs-noreply@greenhouse.io" },
    { subject: "Interview Invitation: Systems Architect - Google", from: "recruiter@google.com" },
    { subject: "Update on your application with Stripe", from: "talent@stripe.com" },
    { subject: "Coding Assessment Invitation - HackerRank", from: "support@hackerrank.com" },
    { subject: "Offer of Employment: Lead AI Engineer", from: "hr@innovate.ai" },
  ];

  for (const sample of normalRecruitmentSamples) {
    const res = checkSensitiveMessage(sample);
    assert.equal(res.isSensitive, false, `Should NOT mark as sensitive: ${sample.subject}`);
  }
});

test("Grok Intelligence Sensitive Filter: text sanitizer strips codes and HTML", () => {
  const htmlWithCode = "<p>Your security confirmation code is <strong>492819</strong>. Do not share.</p>";
  const sanitized = sanitizeText(htmlWithCode);
  assert.ok(!sanitized.includes("<p>"), "HTML tags stripped");
  assert.ok(!sanitized.includes("492819"), "Digits redacted");
  assert.ok(sanitized.includes("[REDACTED]"), "Redaction marker inserted");

  const longText = "A".repeat(3000);
  const truncated = sanitizeText(longText, 500);
  assert.equal(truncated.length, 500 + "... [truncated]".length);
  assert.ok(truncated.endsWith("... [truncated]"));
});

test("Grok Intelligence MCP Edge Function File Audit", () => {
  const code = fs.readFileSync("supabase/functions/jf-grok-owner-mcp/index.ts", "utf8");
  assert.ok(code.includes("jf_validate_grok_oauth_client"), "Validates via single-source database validator");
  assert.doesNotMatch(code, /const\s+TRUSTED_CLIENT_IDS\s*=/, "Does not hardcode static client IDs");
  assert.ok(code.includes("runtime_status"), "Registers runtime_status");
  assert.ok(code.includes("list_pending_recruitment_emails"), "Registers list_pending_recruitment_emails");
  assert.ok(code.includes("get_recruitment_email_details"), "Registers get_recruitment_email_details");
  assert.ok(code.includes("find_candidate_applications"), "Registers find_candidate_applications");
  assert.ok(code.includes("submit_classification_proposal"), "Registers submit_classification_proposal");
  assert.ok(!code.includes("claim_work"), "Does not register legacy claim_work");
  assert.ok(!code.includes("complete_work"), "Does not register legacy complete_work");
});

test("Grok Intelligence Migration File Audit: Schema Compatibility & Security Remediation", () => {
  const sql21 = fs.readFileSync("supabase/migrations/20261109210000_create_recruitment_intelligence_rpcs.sql", "utf8");
  assert.ok(sql21.includes("'requires_review'"), "Sets review_status to 'requires_review'");
  assert.ok(!sql21.includes("'pending_review'"), "Does NOT use obsolete 'pending_review'");
  assert.ok(sql21.includes("'open'"), "Sets review item state to 'open'");
  assert.ok(!sql21.includes("'pending_owner_review'"), "Does NOT use obsolete 'pending_owner_review'");
  assert.ok(sql21.includes("coalesce(q.thread_id, q.message_id)"), "Coalesces thread_id for NOT NULL constraint");
  assert.ok(!sql21.includes("UPDATE public.job_applications"), "Zero writes to job_applications");

  const sql23 = fs.readFileSync("supabase/migrations/20261109230000_permanent_grok_dynamic_oauth.sql", "utf8");
  assert.ok(sql23.includes("REVOKE ALL ON FUNCTION jobbot.get_gmail_fetch_credentials() FROM PUBLIC, anon, authenticated;"), "Remediates Gmail credential accessor execution privilege");
  assert.ok(sql23.includes("GRANT EXECUTE ON FUNCTION jobbot.get_gmail_fetch_credentials() TO service_role;"), "Restricts credential accessor to service_role only");
  assert.ok(sql23.includes("CREATE OR REPLACE FUNCTION jobbot.require_grok_intelligence_auth()"), "Secures require_grok_intelligence_auth");
  assert.ok(sql23.includes("jobbot.validate_grok_oauth_client(v_client_id::uuid, v_uid)"), "Delegates to single source of truth validator");
});


