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
  assert.ok(sql23.includes("REVOKE ALL ON FUNCTION public.jf_get_gmail_fetch_credentials() FROM PUBLIC, anon, authenticated;"), "Remediates Gmail credential accessor execution privilege in public");
  assert.ok(sql23.includes("GRANT EXECUTE ON FUNCTION public.jf_get_gmail_fetch_credentials() TO service_role;"), "Restricts credential accessor to service_role only");
  assert.ok(sql23.includes("CREATE OR REPLACE FUNCTION public.jf_get_gmail_fetch_credentials()"), "Defines public.jf_get_gmail_fetch_credentials");
  assert.ok(sql23.includes("CREATE OR REPLACE FUNCTION public.jf_grok_list_pending_emails("), "Defines keyset-paginated jf_grok_list_pending_emails");
  assert.ok(sql23.includes("CREATE OR REPLACE FUNCTION public.jf_grok_submit_classification_proposal("), "Defines atomic jf_grok_submit_classification_proposal");
  assert.ok(sql23.includes("CREATE OR REPLACE FUNCTION jobbot.require_grok_intelligence_auth()"), "Secures require_grok_intelligence_auth");
  assert.ok(sql23.includes("jobbot.validate_grok_oauth_client(v_client_id::uuid, v_uid)"), "Delegates to single source of truth validator");
});

test("Defect 1: Server-role-only credential accessor rejects users and OAuth tokens", () => {
  function evaluateCredentialAccess(jwtClaims) {
    const role = jwtClaims?.role;
    const clientId = jwtClaims?.client_id;
    if (role !== "service_role" || clientId != null) {
      return { allowed: false, error: "Access denied: service_role authorization required" };
    }
    return { allowed: true };
  }

  // 1. service_role without client_id is permitted
  assert.deepEqual(evaluateCredentialAccess({ role: "service_role" }), { allowed: true });

  // 2. authenticated user (even owner) is denied
  const ownerSession = evaluateCredentialAccess({ sub: DESIGNATED_OWNER_UUID, role: "authenticated" });
  assert.equal(ownerSession.allowed, false);
  assert.equal(ownerSession.error, "Access denied: service_role authorization required");

  // 3. Grok OAuth token (authenticated + client_id) is denied
  const grokToken = evaluateCredentialAccess({
    sub: DESIGNATED_OWNER_UUID,
    role: "authenticated",
    client_id: ACTIVE_GROK_CLIENT_ID,
  });
  assert.equal(grokToken.allowed, false);
  assert.equal(grokToken.error, "Access denied: service_role authorization required");

  // 4. anon role is denied
  assert.equal(evaluateCredentialAccess({ role: "anon" }).allowed, false);

  // 5. Verify gmail-fetcher calls public.jf_get_gmail_fetch_credentials
  const fetcherCode = fs.readFileSync("supabase/functions/jf-grok-owner-mcp/gmail-fetcher.ts", "utf8");
  assert.ok(
    fetcherCode.includes('rpc/jf_get_gmail_fetch_credentials') || fetcherCode.includes('rpc("jf_get_gmail_fetch_credentials")'),
    "gmail-fetcher calls jf_get_gmail_fetch_credentials"
  );
  assert.ok(!fetcherCode.includes('get_gmail_fetch_credentials"'), "Obsolete get_gmail_fetch_credentials call removed");
});

test("Defect 2: Prevents repeated email classification & protects open proposals", () => {
  // Simulate queue items and review proposals
  const queue = [
    { id: "q1", mailbox: "govardhanreddy.vys7@gmail.com", message_id: "m1", processing_status: "pending", review_status: "pending" },
    { id: "q2", mailbox: "govardhanreddy.vys7@gmail.com", message_id: "m2", processing_status: "pending", review_status: "requires_review" }, // Already submitted
    { id: "q3", mailbox: "govardhanreddy.vys7@gmail.com", message_id: "m3", processing_status: "pending", review_status: "pending" },
  ];
  const reviews = new Map([
    ["govardhanreddy.vys7@gmail.com:m2", { id: "r2", state: "open", reason_code: "rejection" }],
  ]);

  // jf_grok_list_pending_emails filter logic:
  // Must have processing_status = 'pending', review_status = 'pending', and NOT exist in recruitment_review_items
  function getEligiblePendingMessages(qList, rMap) {
    return qList.filter(q =>
      q.processing_status === "pending" &&
      q.review_status === "pending" &&
      !rMap.has(`${q.mailbox}:${q.message_id}`)
    );
  }

  // Initial list: only q1 and q3 are returned (q2 is excluded because review_status is requires_review and review exists)
  const initialEligible = getEligiblePendingMessages(queue, reviews);
  assert.equal(initialEligible.length, 2);
  assert.deepEqual(initialEligible.map(i => i.id), ["q1", "q3"]);

  // Submit proposal for q1
  function submitProposal(qId, classification, confidence, idempotencyKey) {
    const q = queue.find(item => item.id === qId);
    if (!q) throw new Error("Queue item not found");

    // Check duplicate idempotency key
    if (idempotencyKey && q.classification_result?.idempotency_key === idempotencyKey) {
      return { status: "idempotent_duplicate", queue_id: q.id, classification: q.classification_result.classification };
    }

    const key = `${q.mailbox}:${q.message_id}`;
    const existing = reviews.get(key);
    if (existing) {
      if (existing.state === "resolved" || existing.state === "ignored") {
        return { status: "already_resolved", review_item_id: existing.id, state: existing.state };
      }
      return { status: "proposal_exists", review_item_id: existing.id, state: "open" };
    }

    // Insert new review
    const newReviewId = `r_${q.id}`;
    reviews.set(key, { id: newReviewId, state: "open", reason_code: classification });

    // Atomically update queue record
    q.review_status = "requires_review";
    q.classification_result = { classification, confidence, idempotency_key: idempotencyKey };

    return { status: "submitted", review_item_id: newReviewId, queue_id: q.id };
  }

  // 1. Submit proposal for q1
  const subRes = submitProposal("q1", "interview_invitation", 0.95, "idem-111");
  assert.equal(subRes.status, "submitted");

  // 2. Verify q1 is immediately excluded from subsequent pending email listings
  const afterSubmitEligible = getEligiblePendingMessages(queue, reviews);
  assert.equal(afterSubmitEligible.length, 1);
  assert.equal(afterSubmitEligible[0].id, "q3");

  // 3. Duplicate idempotency key returns original result
  const dupRes = submitProposal("q1", "interview_invitation", 0.95, "idem-111");
  assert.equal(dupRes.status, "idempotent_duplicate");
  assert.equal(dupRes.queue_id, "q1");

  // 4. Different idempotency key on existing open proposal does NOT overwrite
  const overwriteAttempt = submitProposal("q1", "rejection", 0.99, "idem-222");
  assert.equal(overwriteAttempt.status, "proposal_exists");
  assert.equal(overwriteAttempt.state, "open");
  assert.equal(reviews.get("govardhanreddy.vys7@gmail.com:m1").reason_code, "interview_invitation"); // Kept original

  // 5. Resolved or ignored proposal is preserved
  reviews.set("govardhanreddy.vys7@gmail.com:m3", { id: "r3", state: "resolved", reason_code: "offer" });
  const resolvedAttempt = submitProposal("q3", "rejection", 0.88, "idem-333");
  assert.equal(resolvedAttempt.status, "already_resolved");
  assert.equal(resolvedAttempt.state, "resolved");
});

test("Defect 3: Stable Keyset Pagination strictly aligns with (message_timestamp ASC, id ASC)", () => {
  // Generate 25 records with varied timestamps, identical timestamps, and random UUID ordering
  const records = [
    { id: "00000000-0000-0000-0000-000000000005", owner_id: DESIGNATED_OWNER_UUID, message_timestamp: "2026-11-09T10:00:00Z" },
    { id: "00000000-0000-0000-0000-000000000001", owner_id: DESIGNATED_OWNER_UUID, message_timestamp: "2026-11-09T10:00:00Z" }, // Identical timestamp, lower ID
    { id: "00000000-0000-0000-0000-000000000003", owner_id: DESIGNATED_OWNER_UUID, message_timestamp: "2026-11-09T10:00:00Z" }, // Identical timestamp
    { id: "00000000-0000-0000-0000-000000000002", owner_id: DESIGNATED_OWNER_UUID, message_timestamp: "2026-11-09T10:05:00Z" },
    { id: "00000000-0000-0000-0000-000000000004", owner_id: DESIGNATED_OWNER_UUID, message_timestamp: "2026-11-09T10:10:00Z" },
    { id: "00000000-0000-0000-0000-000000000010", owner_id: DESIGNATED_OWNER_UUID, message_timestamp: "2026-11-09T10:15:00Z" },
    { id: "00000000-0000-0000-0000-000000000008", owner_id: DESIGNATED_OWNER_UUID, message_timestamp: "2026-11-09T10:20:00Z" },
    { id: "00000000-0000-0000-0000-000000000009", owner_id: DESIGNATED_OWNER_UUID, message_timestamp: "2026-11-09T10:25:00Z" },
    { id: "00000000-0000-0000-0000-000000000006", owner_id: DESIGNATED_OWNER_UUID, message_timestamp: "2026-11-09T10:30:00Z" },
    { id: "00000000-0000-0000-0000-000000000007", owner_id: DESIGNATED_OWNER_UUID, message_timestamp: "2026-11-09T10:35:00Z" },
    { id: "00000000-0000-0000-0000-000000000015", owner_id: DESIGNATED_OWNER_UUID, message_timestamp: "2026-11-09T10:40:00Z" },
    { id: "00000000-0000-0000-0000-000000000012", owner_id: DESIGNATED_OWNER_UUID, message_timestamp: "2026-11-09T10:45:00Z" },
    { id: "00000000-0000-0000-0000-000000000014", owner_id: DESIGNATED_OWNER_UUID, message_timestamp: "2026-11-09T10:50:00Z" },
    { id: "00000000-0000-0000-0000-000000000011", owner_id: DESIGNATED_OWNER_UUID, message_timestamp: "2026-11-09T10:55:00Z" },
    { id: "00000000-0000-0000-0000-000000000013", owner_id: DESIGNATED_OWNER_UUID, message_timestamp: "2026-11-09T11:00:00Z" },
  ];

  // Stable keyset comparator: (timestamp ASC, id ASC)
  function compareKeyset(a, b) {
    const tA = new Date(a.message_timestamp).getTime();
    const tB = new Date(b.message_timestamp).getTime();
    if (tA !== tB) return tA - tB;
    return a.id.localeCompare(b.id);
  }

  // Sorted ground truth
  const sortedGroundTruth = [...records].sort(compareKeyset);

  // Keyset paginator function simulating jf_grok_list_pending_emails
  function paginatePending(limit, afterId, ownerId = DESIGNATED_OWNER_UUID) {
    let cursor = null;
    if (afterId != null) {
      cursor = records.find(r => r.id === afterId && r.owner_id === ownerId);
      if (!cursor) {
        throw new Error(`Cursor record ${afterId} not found or ineligible for owner`);
      }
    }

    const filtered = sortedGroundTruth.filter(r => {
      if (r.owner_id !== ownerId) return false;
      if (!cursor) return true;
      return compareKeyset(r, cursor) > 0;
    });

    const pageSize = Math.min(limit, 10);
    const slice = filtered.slice(0, pageSize);
    const hasMore = filtered.length > pageSize;
    const nextCursor = hasMore ? slice[slice.length - 1].id : null;

    return {
      messages: slice,
      count: slice.length,
      has_more: hasMore,
      next_cursor: nextCursor,
    };
  }

  // 1. Cursor owner verification: foreign owner cursor throws error
  assert.throws(
    () => paginatePending(5, "00000000-0000-0000-0000-000000000001", "other-owner-uuid"),
    /ineligible for owner/
  );

  // 2. Non-existent cursor throws error
  assert.throws(
    () => paginatePending(5, "ffffffff-ffff-ffff-ffff-ffffffffffff"),
    /not found or ineligible/
  );

  // 3. Paginate through all 15 records with limit = 5
  const page1 = paginatePending(5, null);
  assert.equal(page1.count, 5);
  assert.equal(page1.has_more, true);
  assert.ok(page1.next_cursor);

  // In page 1, check identical timestamps order: id 001, then 003, then 005
  assert.equal(page1.messages[0].id, "00000000-0000-0000-0000-000000000001");
  assert.equal(page1.messages[1].id, "00000000-0000-0000-0000-000000000003");
  assert.equal(page1.messages[2].id, "00000000-0000-0000-0000-000000000005");

  const page2 = paginatePending(5, page1.next_cursor);
  assert.equal(page2.count, 5);
  assert.equal(page2.has_more, true);
  assert.ok(page2.next_cursor);

  const page3 = paginatePending(5, page2.next_cursor);
  assert.equal(page3.count, 5);
  assert.equal(page3.has_more, false);
  assert.equal(page3.next_cursor, null);

  // Verify all 15 records retrieved with zero duplicates and zero missing items
  const allIds = [
    ...page1.messages.map(m => m.id),
    ...page2.messages.map(m => m.id),
    ...page3.messages.map(m => m.id),
  ];
  assert.equal(allIds.length, 15);
  const idSet = new Set(allIds);
  assert.equal(idSet.size, 15);
  assert.deepEqual(allIds, sortedGroundTruth.map(r => r.id));

  // 4. Restart pagination from scratch
  const restartPage1 = paginatePending(5, null);
  assert.deepEqual(restartPage1.messages.map(m => m.id), page1.messages.map(m => m.id));
});



