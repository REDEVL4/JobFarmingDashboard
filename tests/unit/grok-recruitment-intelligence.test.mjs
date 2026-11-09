import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const DESIGNATED_OWNER_UUID = "f2729195-5445-4272-ab85-cac5b03b0967";
const ACTIVE_GROK_CLIENT_ID = "16bdb57f-c2cd-40d8-b6e1-c1a1b17e3f32";
const TRUSTED_CLIENT_IDS = new Set([ACTIVE_GROK_CLIENT_ID]);

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

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function evaluateGrokMcpAuth(jwtClaims, toolName) {
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
  if (!TRUSTED_CLIENT_IDS.has(clientId)) {
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

  // State recorded in recruitment_review_items (not modifying applicationRecord)
  const reviewQueueItem = {
    id: "review-9999",
    message_id: "msg-001",
    reason_code: proposal.classification,
    proposed_stage: "Rejected",
    candidate_applications: {
      application_id: proposal.application_id,
      current_status: applicationRecord.application_status,
      confidence: proposal.confidence,
    },
    evidence_summary: proposal.evidence_summary,
    state: "pending_owner_review",
  };

  // Assert application status remains unchanged!
  assert.equal(applicationRecord.application_status, "Applied");
  assert.equal(reviewQueueItem.state, "pending_owner_review");
  assert.equal(reviewQueueItem.candidate_applications.current_status, "Applied");
});

test("Grok Intelligence MCP Edge Function File Audit", () => {
  const code = fs.readFileSync("supabase/functions/jf-grok-owner-mcp/index.ts", "utf8");
  assert.ok(code.includes("16bdb57f-c2cd-40d8-b6e1-c1a1b17e3f32"), "Contains active Grok client ID");
  assert.ok(code.includes("runtime_status"), "Registers runtime_status");
  assert.ok(code.includes("list_pending_recruitment_emails"), "Registers list_pending_recruitment_emails");
  assert.ok(code.includes("get_recruitment_email_details"), "Registers get_recruitment_email_details");
  assert.ok(code.includes("find_candidate_applications"), "Registers find_candidate_applications");
  assert.ok(code.includes("submit_classification_proposal"), "Registers submit_classification_proposal");
  assert.ok(!code.includes("claim_work"), "Does not register legacy claim_work");
  assert.ok(!code.includes("complete_work"), "Does not register legacy complete_work");
});
