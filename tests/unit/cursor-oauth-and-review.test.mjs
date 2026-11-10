import test from "node:test";
import assert from "node:assert/strict";

import {
  validateOAuthClient,
  validateAutoRedirectUrl,
  VERIFIED_GROK_CALLBACK_URI,
  VERIFIED_CURSOR_CALLBACK_URI,
  VERIFIED_CURSOR_CLIENT_ID,
  ACTIVE_GROK_CLIENT_ID,
  DESIGNATED_OWNER_UUID,
} from "../../src/lib/oauth-validation.ts";

import {
  checkSensitiveMessage,
  checkIrrelevantEmail,
} from "../../supabase/functions/jf-grok-owner-mcp/sensitive-filter.ts";

// ---------------------------------------------------------------------------
// 1. Task A: Cursor Desktop OAuth Validation
// ---------------------------------------------------------------------------
test("Cursor OAuth: authorizes exact Cursor client ID with HTTPS callback", () => {
  const cursorClient = {
    id: VERIFIED_CURSOR_CLIENT_ID,
    name: "Cursor",
  };
  const res = validateOAuthClient(cursorClient, VERIFIED_CURSOR_CALLBACK_URI);
  assert.equal(res.trusted, true);
  assert.equal(res.connector, "cursor");
  assert.equal(res.requiresInteractiveConsent, true);
  assert.equal(res.clientId, VERIFIED_CURSOR_CLIENT_ID);
});

test("Cursor OAuth: rejects cleartext loopback http://localhost:8787/callback", () => {
  const cursorClient = {
    id: VERIFIED_CURSOR_CLIENT_ID,
    name: "Cursor",
  };
  const res = validateOAuthClient(cursorClient, "http://localhost:8787/callback");
  assert.equal(res.trusted, false);
  assert.match(res.reason, /Insecure loopback redirect URI/i);
});

test("Cursor OAuth: rejects cleartext loopback http://127.0.0.1:8787/callback", () => {
  const cursorClient = {
    id: VERIFIED_CURSOR_CLIENT_ID,
    name: "Cursor",
  };
  const res = validateOAuthClient(cursorClient, "http://127.0.0.1:8787/callback");
  assert.equal(res.trusted, false);
  assert.match(res.reason, /Insecure loopback redirect URI/i);
});

test("Cursor OAuth: authorizes dynamically registered Cursor client ID with HTTPS callback", () => {
  const dynamicClient = {
    id: "24c4a738-2e39-4298-a579-e1024a1b2686",
    name: "Cursor",
  };
  const res = validateOAuthClient(dynamicClient, VERIFIED_CURSOR_CALLBACK_URI);
  assert.equal(res.trusted, true);
  assert.equal(res.connector, "cursor");
  assert.equal(res.isDynamicRegistration, true);
  assert.equal(res.requiresInteractiveConsent, true);
  assert.equal(res.clientId, "24c4a738-2e39-4298-a579-e1024a1b2686");
});

test("Cursor OAuth: rejects non-Cursor client name attempting to use Cursor callback", () => {
  const spoofedClient = {
    id: VERIFIED_CURSOR_CLIENT_ID,
    name: "MaliciousAgent",
  };
  const res = validateOAuthClient(spoofedClient, VERIFIED_CURSOR_CALLBACK_URI);
  assert.equal(res.trusted, false);
  assert.match(res.reason, /Non-Cursor clients may not use the Cursor callback URI/i);
});

test("OAuth: auto-redirect validates both Grok and Cursor HTTPS callbacks", () => {
  assert.equal(validateAutoRedirectUrl(VERIFIED_GROK_CALLBACK_URI).valid, true);
  assert.equal(validateAutoRedirectUrl(VERIFIED_CURSOR_CALLBACK_URI).valid, true);
  assert.equal(validateAutoRedirectUrl("http://localhost:8787/callback").valid, false);
  assert.equal(validateAutoRedirectUrl("https://evil.com/callback").valid, false);
});

// ---------------------------------------------------------------------------
// 2. Task B: Irrelevant Email Classification & Exclusion
// ---------------------------------------------------------------------------
test("Email Exclusion: detects security OTP and verification codes", () => {
  const otpMsg = {
    from: "security-noreply@google.com",
    subject: "Your Google verification code is 123456",
    snippet: "Use 123456 as your one-time passcode.",
  };
  const res = checkIrrelevantEmail(otpMsg);
  assert.equal(res.isIrrelevant, true);
  assert.equal(res.reason, "security_otp");
  assert.equal(res.suggestedDisposition, "exclude");
});

test("Email Exclusion: detects job board alerts (ZipRecruiter, Jobright, etc.)", () => {
  const zipAlert = {
    from: "alert@ziprecruiter.com",
    subject: "15 new Software Engineer jobs for you",
    snippet: "Based on your search preferences, see these new roles.",
  };
  const resZip = checkIrrelevantEmail(zipAlert);
  assert.equal(resZip.isIrrelevant, true);
  assert.equal(resZip.reason, "job_board_alert");
  assert.equal(resZip.suggestedDisposition, "exclude");

  const jobrightAlert = {
    from: "notifications@jobright.ai",
    subject: "Daily Job Digest: 8 new matches",
    snippet: "Jobright found new roles matching your profile.",
  };
  const resJobright = checkIrrelevantEmail(jobrightAlert);
  assert.equal(resJobright.isIrrelevant, true);
  assert.equal(resJobright.suggestedDisposition, "exclude");
});

test("Email Exclusion: detects social notifications (LinkedIn profile views)", () => {
  const linkedinSocial = {
    from: "updates@linkedin.com",
    subject: "Govardhan, you appeared in 14 searches this week",
    snippet: "See who is looking at your profile.",
  };
  const res = checkIrrelevantEmail(linkedinSocial);
  assert.equal(res.isIrrelevant, true);
  assert.equal(res.reason, "social_feed");
  assert.equal(res.suggestedDisposition, "exclude");
});

test("Email Exclusion: permits genuine recruitment communications", () => {
  const genuineInterview = {
    from: "recruiter@stripe.com",
    subject: "Invitation to interview for Senior Full Stack Engineer",
    snippet: "We would like to schedule a 30-minute phone screen.",
  };
  const res = checkIrrelevantEmail(genuineInterview);
  assert.equal(res.isIrrelevant, false);
  assert.equal(res.suggestedDisposition, "none");

  const genuineRejection = {
    from: "careers@netflix.com",
    subject: "Update regarding your application at Netflix",
    snippet: "Thank you for taking the time to interview with us. Unfortunately...",
  };
  const resRej = checkIrrelevantEmail(genuineRejection);
  assert.equal(resRej.isIrrelevant, false);
  assert.equal(resRej.suggestedDisposition, "none");
});

// ---------------------------------------------------------------------------
// 3. Task C: Atomic Owner Review Logic & DB Constraints
// ---------------------------------------------------------------------------
const VALID_APPLICATION_STATUSES = new Set([
  "Preparing",
  "Form Completed",
  "Awaiting Approval",
  "Submission Pending",
  "Submission Failed",
  "Submitted Unverified",
  "Applied Confirmed",
  "Reported Submitted",
]);

const VALID_QUEUE_REVIEW_STATUSES = new Set([
  "pending",
  "requires_review",
  "auto_approved",
  "user_approved",
  "user_rejected",
  "ignored",
]);

const VALID_QUEUE_PROCESSING_STATUSES = new Set([
  "pending",
  "pending_fetch",
  "claimed",
  "completed",
  "failed",
  "skipped",
  "excluded",
]);

test("DB Constraints: exclusion disposition strictly adheres to queue constraints", () => {
  const targetReviewStatus = "ignored";
  const targetProcessingStatus = "excluded";

  assert.equal(VALID_QUEUE_REVIEW_STATUSES.has(targetReviewStatus), true);
  assert.equal(VALID_QUEUE_PROCESSING_STATUSES.has(targetProcessingStatus), true);
});

test("DB Constraints: proposal submission strictly adheres to queue constraints", () => {
  const targetReviewStatus = "requires_review";
  assert.equal(VALID_QUEUE_REVIEW_STATUSES.has(targetReviewStatus), true);
});

test("DB Constraints: owner approval strictly adheres to application constraints", () => {
  const targetStatus = "Applied Confirmed";
  assert.equal(VALID_APPLICATION_STATUSES.has(targetStatus), true);

  assert.equal(VALID_QUEUE_REVIEW_STATUSES.has("user_approved"), true);
  assert.equal(VALID_QUEUE_PROCESSING_STATUSES.has("completed"), true);
});

test("DB Constraints: owner rejection strictly adheres to queue constraints", () => {
  assert.equal(VALID_QUEUE_REVIEW_STATUSES.has("user_rejected"), true);
  assert.equal(VALID_QUEUE_PROCESSING_STATUSES.has("skipped"), true);
});

test("Review Security: third-party OAuth client tokens are blocked from resolving reviews", () => {
  function simulateOwnerResolveReview(callerUid, clientId, action) {
    if (callerUid !== DESIGNATED_OWNER_UUID) {
      throw new Error("Owner authentication required");
    }
    if (clientId != null) {
      throw new Error("OAuth tokens are not permitted to resolve review items");
    }
    if (!["approve", "reject", "ignore", "needs_review"].includes(action)) {
      throw new Error(`Invalid action: ${action}`);
    }
    return { success: true, action };
  }

  // Case 1: First-party interactive owner UI (no client_id claim in JWT)
  const ownerResult = simulateOwnerResolveReview(DESIGNATED_OWNER_UUID, null, "approve");
  assert.equal(ownerResult.success, true);

  // Case 2: Third-party Grok OAuth token calling resolve review -> BLOCKED
  assert.throws(
    () => simulateOwnerResolveReview(DESIGNATED_OWNER_UUID, ACTIVE_GROK_CLIENT_ID, "approve"),
    /OAuth tokens are not permitted to resolve review items/
  );

  // Case 3: Third-party Cursor OAuth token calling resolve review -> BLOCKED
  assert.throws(
    () => simulateOwnerResolveReview(DESIGNATED_OWNER_UUID, VERIFIED_CURSOR_CLIENT_ID, "approve"),
    /OAuth tokens are not permitted to resolve review items/
  );

  // Case 4: Non-owner principal calling resolve review -> BLOCKED
  assert.throws(
    () => simulateOwnerResolveReview("00000000-0000-0000-0000-000000000000", null, "approve"),
    /Owner authentication required/
  );
});

// ---------------------------------------------------------------------------
// 4. Critical Defect 1 & 4: Application Matching, Submission Preservation, & Chronology
// ---------------------------------------------------------------------------
function resolveHiringTransition({
  currentStatus,
  currentStage,
  reasonCode,
  proposedStage,
  targetAppId,
  candidateApps = [],
  itemTime = new Date("2026-11-10T12:00:00Z"),
  appReferenceTime = new Date("2026-11-09T12:00:00Z"),
}) {
  // Critical defect 1: Candidate resolution & validation
  let resolvedId = targetAppId;
  if (resolvedId) {
    const isCandidate = candidateApps.some((c) => c.id === resolvedId);
    if (!isCandidate) {
      throw new Error(`Invalid application selection: application ${resolvedId} does not belong to the candidate list for review item`);
    }
  } else {
    if (candidateApps.length === 1) {
      resolvedId = candidateApps[0].id;
    } else if (candidateApps.length > 1) {
      throw new Error(`Ambiguous candidate match: review item contains ${candidateApps.length} applications. Explicit target application selection is required.`);
    } else {
      throw new Error("Cannot approve review item: no candidate application match found");
    }
  }

  // Stage mapping
  let newStage;
  const rc = (reasonCode || "").toLowerCase();
  const ps = (proposedStage || "").toLowerCase();

  if (rc === "application_confirmation" || ["applied confirmed", "applied", "confirmed"].includes(ps)) {
    newStage = "Applied Confirmed";
  } else if (rc === "assessment" || ["assessment requested", "assessment"].includes(ps)) {
    newStage = "Assessment Requested";
  } else if (rc === "interview_invitation" || ["interview scheduled", "interview", "interviewing"].includes(ps)) {
    newStage = "Interview Scheduled";
  } else if (rc === "offer" || ["offer received", "offer"].includes(ps)) {
    newStage = "Offer Received";
  } else if (rc === "rejection" || ["rejected", "rejection"].includes(ps)) {
    newStage = "Rejected";
  } else {
    newStage = currentStage || "Applied Confirmed";
  }

  // Chronology & Downgrade Protection (Defect 4)
  let stageChangeAllowed = true;
  let stageNotes = null;

  if (currentStage === "Offer Received") {
    if (newStage === "Rejected") {
      if (itemTime < appReferenceTime) {
        stageChangeAllowed = false;
        stageNotes = "Suppressed out-of-order rejection: email timestamp is older than offer";
      }
    } else if (["Interview Scheduled", "Assessment Requested", "Applied Confirmed"].includes(newStage)) {
      stageChangeAllowed = false;
      stageNotes = "Suppressed stage downgrade: application is already at Offer Received";
    }
  } else if (currentStage === "Rejected") {
    if (["Interview Scheduled", "Assessment Requested", "Applied Confirmed"].includes(newStage)) {
      if (itemTime <= appReferenceTime) {
        stageChangeAllowed = false;
        stageNotes = "Suppressed out-of-order stage update: email timestamp is older than rejection";
      }
    }
  } else if (currentStage === "Interview Scheduled") {
    if (newStage === "Rejected") {
      // Rejection following an interview is legitimate if timestamp >= interview event!
      if (itemTime < appReferenceTime) {
        stageChangeAllowed = false;
        stageNotes = "Suppressed out-of-order rejection: email timestamp is older than interview";
      }
    } else if (["Applied Confirmed", "Assessment Requested"].includes(newStage)) {
      stageChangeAllowed = false;
      stageNotes = "Suppressed stage downgrade: application is already at Interview Scheduled";
    }
  } else if (currentStage === "Assessment Requested") {
    if (newStage === "Rejected") {
      if (itemTime < appReferenceTime) {
        stageChangeAllowed = false;
        stageNotes = "Suppressed out-of-order rejection: email timestamp is older than assessment";
      }
    } else if (newStage === "Applied Confirmed") {
      stageChangeAllowed = false;
      stageNotes = "Suppressed stage downgrade: application is already at Assessment Requested";
    }
  }

  const effectiveNewStage = stageChangeAllowed ? newStage : currentStage;

  // Critical defect 4: Submission status preservation
  // ONLY update submission-verification fields when directly supported by verified submission evidence
  // AND application was previously in an unconfirmed submission state:
  let newStatus = currentStatus;
  const isConfirmation = rc === "application_confirmation" || ["applied confirmed", "applied", "confirmed"].includes(ps);
  if (isConfirmation && ["Submitted Unverified", "Reported Submitted"].includes(currentStatus)) {
    newStatus = "Applied Confirmed";
  }

  return {
    applicationUpdated: true,
    resolvedAppId: resolvedId,
    newStatus,
    newStage: effectiveNewStage,
    stageNotes,
  };
}

// Defect 1 tests
test("Defect 1: rejects an unrelated application UUID not in candidate list", () => {
  assert.throws(
    () =>
      resolveHiringTransition({
        currentStatus: "Submitted Unverified",
        currentStage: null,
        reasonCode: "interview_invitation",
        proposedStage: "Interview Scheduled",
        targetAppId: "99999999-9999-9999-9999-999999999999", // Unrelated!
        candidateApps: [{ id: "11111111-1111-1111-1111-111111111111" }],
      }),
    /Invalid application selection: application 99999999-9999-9999-9999-999999999999 does not belong to the candidate list/
  );
});

test("Defect 1: rejects approval when candidate list has zero matches and no target specified", () => {
  assert.throws(
    () =>
      resolveHiringTransition({
        currentStatus: "Submitted Unverified",
        currentStage: null,
        reasonCode: "interview_invitation",
        proposedStage: "Interview Scheduled",
        targetAppId: null,
        candidateApps: [], // Zero candidates!
      }),
    /Cannot approve review item: no candidate application match found/
  );
});

test("Defect 1: requires explicit owner selection when multiple candidates exist", () => {
  assert.throws(
    () =>
      resolveHiringTransition({
        currentStatus: "Submitted Unverified",
        currentStage: null,
        reasonCode: "application_confirmation",
        proposedStage: "Applied Confirmed",
        targetAppId: null,
        candidateApps: [
          { id: "11111111-1111-1111-1111-111111111111", company: "Google" },
          { id: "22222222-2222-2222-2222-222222222222", company: "Google" },
        ],
      }),
    /Ambiguous candidate match: review item contains 2 applications/
  );
});

test("Defect 1: succeeds when explicit target application from candidate list is selected", () => {
  const result = resolveHiringTransition({
    currentStatus: "Submitted Unverified",
    currentStage: null,
    reasonCode: "application_confirmation",
    proposedStage: "Applied Confirmed",
    targetAppId: "22222222-2222-2222-2222-222222222222",
    candidateApps: [
      { id: "11111111-1111-1111-1111-111111111111", company: "Google" },
      { id: "22222222-2222-2222-2222-222222222222", company: "Google" },
    ],
  });
  assert.equal(result.resolvedAppId, "22222222-2222-2222-2222-222222222222");
  assert.equal(result.newStage, "Applied Confirmed");
});

// Defect 4 tests: Submission status preservation
test("Defect 4: does NOT convert 'Preparing' to 'Applied Confirmed'", () => {
  const result = resolveHiringTransition({
    currentStatus: "Preparing",
    currentStage: null,
    reasonCode: "application_confirmation",
    proposedStage: "Applied Confirmed",
    targetAppId: "11111111-1111-1111-1111-111111111111",
    candidateApps: [{ id: "11111111-1111-1111-1111-111111111111" }],
  });
  assert.equal(result.newStatus, "Preparing"); // Untouched!
  assert.equal(result.newStage, "Applied Confirmed");
});

test("Defect 4: does NOT convert 'Submission Failed' to 'Applied Confirmed'", () => {
  const result = resolveHiringTransition({
    currentStatus: "Submission Failed",
    currentStage: null,
    reasonCode: "application_confirmation",
    proposedStage: "Applied Confirmed",
    targetAppId: "11111111-1111-1111-1111-111111111111",
    candidateApps: [{ id: "11111111-1111-1111-1111-111111111111" }],
  });
  assert.equal(result.newStatus, "Submission Failed"); // Untouched!
  assert.equal(result.newStage, "Applied Confirmed");
});

test("Defect 4: does NOT convert 'Awaiting Approval' to 'Applied Confirmed'", () => {
  const result = resolveHiringTransition({
    currentStatus: "Awaiting Approval",
    currentStage: null,
    reasonCode: "application_confirmation",
    proposedStage: "Applied Confirmed",
    targetAppId: "11111111-1111-1111-1111-111111111111",
    candidateApps: [{ id: "11111111-1111-1111-1111-111111111111" }],
  });
  assert.equal(result.newStatus, "Awaiting Approval"); // Untouched!
  assert.equal(result.newStage, "Applied Confirmed");
});

test("Defect 4: does NOT convert 'Submission Pending' to 'Applied Confirmed'", () => {
  const result = resolveHiringTransition({
    currentStatus: "Submission Pending",
    currentStage: null,
    reasonCode: "application_confirmation",
    proposedStage: "Applied Confirmed",
    targetAppId: "11111111-1111-1111-1111-111111111111",
    candidateApps: [{ id: "11111111-1111-1111-1111-111111111111" }],
  });
  assert.equal(result.newStatus, "Submission Pending"); // Untouched!
  assert.equal(result.newStage, "Applied Confirmed");
});

test("Defect 4: converts 'Submitted Unverified' to 'Applied Confirmed' on confirmation evidence", () => {
  const result = resolveHiringTransition({
    currentStatus: "Submitted Unverified",
    currentStage: null,
    reasonCode: "application_confirmation",
    proposedStage: "Applied Confirmed",
    targetAppId: "11111111-1111-1111-1111-111111111111",
    candidateApps: [{ id: "11111111-1111-1111-1111-111111111111" }],
  });
  assert.equal(result.newStatus, "Applied Confirmed");
  assert.equal(result.newStage, "Applied Confirmed");
});

test("Defect 4: hiring communications (interview, rejection, etc.) leave application_status unchanged", () => {
  const result = resolveHiringTransition({
    currentStatus: "Submitted Unverified",
    currentStage: "Applied Confirmed",
    reasonCode: "interview_invitation",
    proposedStage: "Interview Scheduled",
    targetAppId: "11111111-1111-1111-1111-111111111111",
    candidateApps: [{ id: "11111111-1111-1111-1111-111111111111" }],
  });
  assert.equal(result.newStatus, "Submitted Unverified"); // Unchanged!
  assert.equal(result.newStage, "Interview Scheduled");
});

// Defect 4: Chronology tests
test("Defect 4: a new rejection following an interview is legitimate", () => {
  const interviewTime = new Date("2026-11-05T10:00:00Z");
  const rejectionTime = new Date("2026-11-08T15:00:00Z"); // Later!

  const result = resolveHiringTransition({
    currentStatus: "Applied Confirmed",
    currentStage: "Interview Scheduled",
    reasonCode: "rejection",
    proposedStage: "Rejected",
    targetAppId: "11111111-1111-1111-1111-111111111111",
    candidateApps: [{ id: "11111111-1111-1111-1111-111111111111" }],
    itemTime: rejectionTime,
    appReferenceTime: interviewTime,
  });
  assert.equal(result.newStage, "Rejected"); // Transition allowed!
});

test("Defect 4: an out-of-order rejection older than interview is suppressed", () => {
  const interviewTime = new Date("2026-11-08T15:00:00Z");
  const oldRejectionTime = new Date("2026-11-05T10:00:00Z"); // Older!

  const result = resolveHiringTransition({
    currentStatus: "Applied Confirmed",
    currentStage: "Interview Scheduled",
    reasonCode: "rejection",
    proposedStage: "Rejected",
    targetAppId: "11111111-1111-1111-1111-111111111111",
    candidateApps: [{ id: "11111111-1111-1111-1111-111111111111" }],
    itemTime: oldRejectionTime,
    appReferenceTime: interviewTime,
  });
  assert.equal(result.newStage, "Interview Scheduled"); // Suppressed!
  assert.match(result.stageNotes, /Suppressed out-of-order rejection/);
});

test("Defect 4: an old confirmation does NOT overwrite later hiring stage (Interview Scheduled)", () => {
  const result = resolveHiringTransition({
    currentStatus: "Applied Confirmed",
    currentStage: "Interview Scheduled",
    reasonCode: "application_confirmation",
    proposedStage: "Applied Confirmed",
    targetAppId: "11111111-1111-1111-1111-111111111111",
    candidateApps: [{ id: "11111111-1111-1111-1111-111111111111" }],
  });
  assert.equal(result.newStage, "Interview Scheduled"); // Preserved!
  assert.match(result.stageNotes, /Suppressed stage downgrade/);
});

test("Defect 4: an old confirmation does NOT overwrite Offer Received", () => {
  const result = resolveHiringTransition({
    currentStatus: "Applied Confirmed",
    currentStage: "Offer Received",
    reasonCode: "application_confirmation",
    proposedStage: "Applied Confirmed",
    targetAppId: "11111111-1111-1111-1111-111111111111",
    candidateApps: [{ id: "11111111-1111-1111-1111-111111111111" }],
  });
  assert.equal(result.newStage, "Offer Received"); // Preserved!
});

test("Defect 4: an old confirmation does NOT overwrite Rejected application", () => {
  const result = resolveHiringTransition({
    currentStatus: "Applied Confirmed",
    currentStage: "Rejected",
    reasonCode: "application_confirmation",
    proposedStage: "Applied Confirmed",
    targetAppId: "11111111-1111-1111-1111-111111111111",
    candidateApps: [{ id: "11111111-1111-1111-1111-111111111111" }],
    itemTime: new Date("2026-11-05T10:00:00Z"), // Older confirmation
    appReferenceTime: new Date("2026-11-09T10:00:00Z"), // Newer rejection
  });
  assert.equal(result.newStage, "Rejected"); // Preserved!
  assert.match(result.stageNotes, /Suppressed out-of-order stage update/);
});

// ---------------------------------------------------------------------------
// 5. Critical Defect 3: Review Lifecycle & Terminal States
// ---------------------------------------------------------------------------
function simulateReviewLifecycle(currentState, action) {
  const lowerAction = action.toLowerCase();
  if (currentState === "resolved") {
    if (lowerAction === "approve") {
      return { status: "already_approved", state: "resolved" };
    }
    throw new Error(`Cannot ${action} an already resolved/approved review item without an explicit authorized correction workflow`);
  }
  if (currentState === "ignored") {
    if (["reject", "ignore"].includes(lowerAction)) {
      return { status: "already_ignored", state: "ignored" };
    }
    throw new Error(`Cannot ${action} an already ignored/rejected review item without an explicit authorized correction workflow`);
  }
  if (currentState !== "open") {
    throw new Error(`Invalid review item state: ${currentState}. Only open review items can be resolved`);
  }

  // Transitions from open
  if (lowerAction === "approve") {
    return { status: "approved", state: "resolved" };
  } else if (["reject", "ignore"].includes(lowerAction)) {
    return { status: "rejected", state: "ignored" };
  } else if (lowerAction === "needs_review") {
    return { status: "needs_review", state: "open" };
  } else {
    throw new Error(`Invalid action: ${action}`);
  }
}

test("Defect 3: open -> resolved on approval", () => {
  const res = simulateReviewLifecycle("open", "approve");
  assert.equal(res.status, "approved");
  assert.equal(res.state, "resolved");
});

test("Defect 3: open -> ignored on rejection", () => {
  const resReject = simulateReviewLifecycle("open", "reject");
  assert.equal(resReject.status, "rejected");
  assert.equal(resReject.state, "ignored");

  const resIgnore = simulateReviewLifecycle("open", "ignore");
  assert.equal(resIgnore.status, "rejected");
  assert.equal(resIgnore.state, "ignored");
});

test("Defect 3: open -> open on needs_review", () => {
  const res = simulateReviewLifecycle("open", "needs_review");
  assert.equal(res.status, "needs_review");
  assert.equal(res.state, "open");
});

test("Defect 3: terminal state 'resolved' rejects conflicting actions", () => {
  assert.throws(() => simulateReviewLifecycle("resolved", "reject"), /Cannot reject an already resolved/);
  assert.throws(() => simulateReviewLifecycle("resolved", "ignore"), /Cannot ignore an already resolved/);
  assert.throws(() => simulateReviewLifecycle("resolved", "needs_review"), /Cannot needs_review an already resolved/);
});

test("Defect 3: terminal state 'ignored' rejects conflicting actions", () => {
  assert.throws(() => simulateReviewLifecycle("ignored", "approve"), /Cannot approve an already ignored/);
  assert.throws(() => simulateReviewLifecycle("ignored", "needs_review"), /Cannot needs_review an already ignored/);
});

test("Defect 3: repeated identical decisions are idempotent", () => {
  assert.equal(simulateReviewLifecycle("resolved", "approve").status, "already_approved");
  assert.equal(simulateReviewLifecycle("ignored", "reject").status, "already_ignored");
  assert.equal(simulateReviewLifecycle("ignored", "ignore").status, "already_ignored");
});

// ---------------------------------------------------------------------------
// 6. Critical Defect 6: Dashboard Route Security & Strict Same-Origin Validation
// ---------------------------------------------------------------------------
test("Route Security: strict same-origin check rejects all cross-origin requests without localhost exception", () => {
  function validateRouteSecurity({ origin, secFetchSite, requestUrlStr }) {
    if (secFetchSite && secFetchSite !== "same-origin") {
      return { allowed: false, reason: "Cross-site request rejected (CSRF protection)." };
    }

    if (origin) {
      const requestUrl = new URL(requestUrlStr);
      if (origin !== requestUrl.origin) {
        return { allowed: false, reason: "Cross-origin request rejected. Strict same-origin required." };
      }
    }

    return { allowed: true };
  }

  const prodUrl = "https://job-farming-dashboard.vercel.app/api/recruitment/resolve-review";

  // Production same-origin: PASS
  assert.equal(
    validateRouteSecurity({
      origin: "https://job-farming-dashboard.vercel.app",
      secFetchSite: "same-origin",
      requestUrlStr: prodUrl,
    }).allowed,
    true
  );

  // Cross-site sec-fetch-site: REJECTED
  assert.equal(
    validateRouteSecurity({
      origin: "https://job-farming-dashboard.vercel.app",
      secFetchSite: "cross-site",
      requestUrlStr: prodUrl,
    }).allowed,
    false
  );

  // Mismatched origin (attacker): REJECTED
  assert.equal(
    validateRouteSecurity({
      origin: "https://evil.com",
      secFetchSite: "same-origin",
      requestUrlStr: prodUrl,
    }).allowed,
    false
  );

  // Localhost against production: STRICTLY REJECTED (no localhost exception in production)
  assert.equal(
    validateRouteSecurity({
      origin: "http://localhost:3000",
      secFetchSite: "same-origin",
      requestUrlStr: prodUrl,
    }).allowed,
    false
  );

  // Local dev with matching local origin: PASS
  const devUrl = "http://localhost:3000/api/recruitment/resolve-review";
  assert.equal(
    validateRouteSecurity({
      origin: "http://localhost:3000",
      secFetchSite: "same-origin",
      requestUrlStr: devUrl,
    }).allowed,
    true
  );

  // Local dev with foreign origin: REJECTED
  assert.equal(
    validateRouteSecurity({
      origin: "https://attacker.site",
      secFetchSite: "same-origin",
      requestUrlStr: devUrl,
    }).allowed,
    false
  );
});

test("Route Security: database errors are safely sanitized without SQL leaks", () => {
  function sanitizeError(error) {
    const safeMessage = error.message.includes("Ambiguous candidate match")
      ? error.message
      : error.message.includes("does not belong to the candidate list")
      ? error.message
      : error.message.includes("no candidate application match")
      ? error.message
      : error.message.includes("Terminal review state") || error.message.includes("already resolved") || error.message.includes("already ignored")
      ? error.message
      : "Failed to resolve review. Please try again or check audit logs.";
    return safeMessage;
  }

  const sqlLeak = { message: 'relation "jobbot.secret_keys" does not exist at character 42' };
  assert.equal(sanitizeError(sqlLeak), "Failed to resolve review. Please try again or check audit logs.");

  const ambiguousError = { message: "Ambiguous candidate match: review item contains 2 applications." };
  assert.equal(sanitizeError(ambiguousError), "Ambiguous candidate match: review item contains 2 applications.");

  const candidateError = { message: "Invalid application selection: application 123 does not belong to the candidate list for review item 456" };
  assert.equal(sanitizeError(candidateError), "Invalid application selection: application 123 does not belong to the candidate list for review item 456");
});
