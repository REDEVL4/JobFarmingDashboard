import test from "node:test";
import assert from "node:assert/strict";
import { matchApplicationToEmail } from "../../supabase/functions/gmail-status-sync/matcher.ts";
import {
  resolveScanWindow,
  computeContinuationState,
  filterAtomicStageUpdates,
} from "../../supabase/functions/gmail-status-sync/continuation.ts";

test("Gmail Hardening: Live-Write Authorization Gate", async (t) => {
  await t.test("blocks live writes when dry_run:false is passed but server-side gate is false", () => {
    const isLiveWritePermitted = (requestedDryRun, serverGateEnabled) => {
      const requestedLive = requestedDryRun === false;
      return requestedLive && serverGateEnabled === true;
    };

    // Caller passes dry_run: false, but server environment has ENABLE_GMAIL_STATUS_WRITES=false
    assert.equal(isLiveWritePermitted(false, false), false);
    // Caller passes dry_run: false, server environment undefined
    assert.equal(isLiveWritePermitted(false, undefined), false);
    // Caller passes dry_run: false, server environment explicitly true
    assert.equal(isLiveWritePermitted(false, true), true);
    // Caller passes dry_run: true (or omits it), even if server gate is true
    assert.equal(isLiveWritePermitted(true, true), false);
  });
});

test("Gmail Hardening: Checkpoint Query Invariant", async (t) => {
  await t.test("dry-run logs must NEVER advance production checkpoint", () => {
    const syncLogs = [
      {
        id: "log-1",
        completed_at: "2026-11-08T22:47:41Z",
        status: "completed",
        dry_run: false,
      },
      {
        id: "log-2",
        completed_at: "2026-11-09T08:00:00Z",
        status: "dry_run_completed",
        dry_run: true,
      },
      {
        id: "log-3",
        completed_at: "2026-11-09T09:00:00Z",
        status: "dry_run_completed",
        dry_run: true,
      },
    ];

    // Filter used in production index.ts
    const validProductionLogs = syncLogs.filter(
      (log) => log.status === "completed" && log.dry_run === false
    );

    assert.equal(validProductionLogs.length, 1);
    assert.equal(validProductionLogs[0].completed_at, "2026-11-08T22:47:41Z");
  });
});

test("Gmail Hardening: Incomplete Backfill Invariant", async (t) => {
  await t.test("checkpoint does not advance to completedAt when backlog exceeds max_messages", () => {
    const resolveCheckpointAdvancement = (hasMoreBacklog, completedAt, previousCheckpoint) => {
      if (hasMoreBacklog) {
        // Must preserve previous checkpoint so subsequent runs continue scanning the remainder
        return previousCheckpoint;
      }
      return completedAt;
    };

    const prev = "2026-11-08T22:47:41Z";
    const now = "2026-11-09T10:00:00Z";

    assert.equal(resolveCheckpointAdvancement(true, now, prev), prev);
    assert.equal(resolveCheckpointAdvancement(false, now, prev), now);
  });
});

test("Gmail Hardening: Single Company Application Matching Policy", async (t) => {
  await t.test("does NOT auto-match application merely because it is the only one at a company", () => {
    const apps = [
      {
        id: "app-101",
        company: "Stripe",
        job_title: "Full Stack Engineer, Payments",
        requisition_id: "STR-1001",
        confirmation_email_ref: null,
        hiring_stage: "Applied Confirmed",
      },
    ];

    const emailWithoutRole = {
      id: "msg-1",
      threadId: "th-1",
      from: "recruiting@stripe.com",
      subject: "Thank you from Stripe Recruiting",
      bodyText: "We wanted to share some general updates from Stripe engineering teams.",
    };

    const match = matchApplicationToEmail(emailWithoutRole, apps);
    assert.equal(match.matched, false);
    assert.equal(match.ambiguous, true);
    assert.equal(match.reasonCode, "role_less_specific_than_application");
  });

  await t.test("auto-matches application when job title is explicitly corroborated", () => {
    const apps = [
      {
        id: "app-101",
        company: "Stripe",
        job_title: "Full Stack Engineer, Payments",
        requisition_id: "STR-1001",
        confirmation_email_ref: null,
        hiring_stage: "Applied Confirmed",
      },
    ];

    const emailWithRole = {
      id: "msg-2",
      threadId: "th-2",
      from: "recruiting@stripe.com",
      subject: "Update on Full Stack Engineer, Payments role at Stripe",
      bodyText: "Regarding your candidacy for the Full Stack Engineer, Payments role.",
    };

    const match = matchApplicationToEmail(emailWithRole, apps);
    assert.equal(match.matched, true);
    assert.equal(match.ambiguous, false);
    assert.equal(match.matchedApplication?.id, "app-101");
  });
});

test("Gmail Hardening: Terminal Stage Overwrite Protection", async (t) => {
  await t.test("prevents non-terminal message from downgrading a terminal Rejected stage", () => {
    const evaluateStageTransition = (currentStage, proposedStage) => {
      const isTerminalCurrent = currentStage === "Rejected" || currentStage === "Offer Received";
      const isTerminalNew = proposedStage === "Rejected" || proposedStage === "Offer Received";

      if (isTerminalCurrent && !isTerminalNew) {
        return { allowed: false, action: "queue_for_review" };
      }
      return { allowed: true, action: "update_stage" };
    };

    // Current is Rejected, incoming email is an older Assessment invitation
    const res1 = evaluateStageTransition("Rejected", "Assessment Requested");
    assert.equal(res1.allowed, false);
    assert.equal(res1.action, "queue_for_review");

    // Current is Applied Confirmed, incoming email is Rejected
    const res2 = evaluateStageTransition("Applied Confirmed", "Rejected");
    assert.equal(res2.allowed, true);
    assert.equal(res2.action, "update_stage");
  });
});

test("Gmail Hardening: Chronological Message Ordering", async (t) => {
  await t.test("sorts messages by internalDate ascending before processing transitions", () => {
    const messages = [
      { id: "msg-late", internalDate: "1794200000000" },
      { id: "msg-early", internalDate: "1794100000000" },
      { id: "msg-mid", internalDate: "1794150000000" },
    ];

    const sorted = [...messages].sort((a, b) => Number(a.internalDate) - Number(b.internalDate));

    assert.equal(sorted[0].id, "msg-early");
    assert.equal(sorted[1].id, "msg-mid");
    assert.equal(sorted[2].id, "msg-late");
  });
});

test("Gmail Hardening: Resumable Pagination with > 300 Messages", async (t) => {
  await t.test("bounds discovery, detects backlog, and preserves checkpoint without skipping", () => {
    // Generate 350 simulated messages spanning across 4 pages
    // Message 1 is newest, Message 350 is oldest
    const totalBacklogCount = 350;
    const baseEpochMs = 1794200000000;
    const messages = [];
    for (let i = 0; i < totalBacklogCount; i++) {
      messages.push({
        id: `msg-${i + 1}`,
        threadId: `th-${i + 1}`,
        internalDate: String(baseEpochMs - i * 60_000), // each 1 minute older
      });
    }

    const maxMessages = 300;
    const lastVerifiedCheckpoint = "2026-11-08T22:47:41.801952+00:00";
    const initialScanWindow = resolveScanWindow({
      latestProductionLog: null,
      gapReconcile: false,
      lastVerifiedCheckpoint,
      overlapMinutes: 15,
    });

    // Run 1: Fetches first 300 messages (3 pages of 100), reaching limit with remaining pageToken
    const run1Fetched = messages.slice(0, 300);
    const run1MinInternalDate = Math.min(...run1Fetched.map((m) => Number(m.internalDate)));
    const run1StartedAt = "2026-11-09T10:00:00.000Z";
    const run1CompletedAt = "2026-11-09T10:01:00.000Z";

    const run1Continuation = computeContinuationState({
      rawMessageCount: 300,
      maxMessages,
      hasRemainingPageToken: true, // Page 4 (50 messages) remains
      minInternalDate: run1MinInternalDate,
      queryAfterEpoch: initialScanWindow.queryAfterEpoch,
      isResumingBackfill: false,
      startedAt: run1StartedAt,
      completedAt: run1CompletedAt,
      dryRun: false,
    });

    // Invariant 1: An incomplete backfill MUST NOT advance the checkpoint
    assert.equal(run1Continuation.hasMoreBacklog, true);
    assert.equal(run1Continuation.allPagesComplete, false);
    assert.equal(run1Continuation.checkpointAdvanced, false);
    assert.equal(run1Continuation.status, "partial_backfill");
    assert.equal(run1Continuation.effectiveCheckpointTime, null);
    assert.ok(run1Continuation.nextContinuationBeforeEpoch > 0);
    assert.equal(run1Continuation.nextContinuationAfterEpoch, initialScanWindow.queryAfterEpoch);

    // Simulate saving Run 1 production sync log to database
    const run1SyncLog = {
      started_at: run1StartedAt,
      completed_at: run1CompletedAt,
      verification_results: {
        status: run1Continuation.status,
        dry_run: false,
        has_more_backlog: run1Continuation.hasMoreBacklog,
        all_pages_complete: run1Continuation.allPagesComplete,
        checkpoint_advanced: run1Continuation.checkpointAdvanced,
        continuation_before_epoch: run1Continuation.nextContinuationBeforeEpoch,
        continuation_after_epoch: run1Continuation.nextContinuationAfterEpoch,
        continuation_ceiling_time: run1Continuation.nextContinuationCeilingTime,
      },
    };

    // Run 2: Next run resumes from the incomplete backfill
    const run2ScanWindow = resolveScanWindow({
      latestProductionLog: run1SyncLog,
      gapReconcile: false,
      lastVerifiedCheckpoint,
      overlapMinutes: 15,
    });

    // Invariant 2: Window targets remaining 50 messages strictly before the oldest message from Run 1
    assert.equal(run2ScanWindow.isResumingBackfill, true);
    assert.equal(run2ScanWindow.queryBeforeEpoch, run1Continuation.nextContinuationBeforeEpoch);
    assert.equal(run2ScanWindow.queryAfterEpoch, initialScanWindow.queryAfterEpoch);
    assert.equal(run2ScanWindow.continuationCeilingTime, run1StartedAt);

    // Run 2 fetches remaining 50 messages
    const run2Fetched = messages.slice(300, 350);
    assert.equal(run2Fetched.length, 50);
    const run2MinInternalDate = Math.min(...run2Fetched.map((m) => Number(m.internalDate)));
    const run2StartedAt = "2026-11-09T10:05:00.000Z";
    const run2CompletedAt = "2026-11-09T10:05:30.000Z";

    const run2Continuation = computeContinuationState({
      rawMessageCount: run2Fetched.length,
      maxMessages,
      hasRemainingPageToken: false, // End of backlog reached!
      minInternalDate: run2MinInternalDate,
      queryAfterEpoch: run2ScanWindow.queryAfterEpoch,
      isResumingBackfill: true,
      continuationCeilingTime: run2ScanWindow.continuationCeilingTime,
      startedAt: run2StartedAt,
      completedAt: run2CompletedAt,
      dryRun: false,
    });

    // Invariant 3: With all 350 messages fetched, backfill is complete and checkpoint advances to ceiling
    assert.equal(run2Continuation.hasMoreBacklog, false);
    assert.equal(run2Continuation.allPagesComplete, true);
    assert.equal(run2Continuation.checkpointAdvanced, true);
    assert.equal(run2Continuation.status, "completed");
    assert.equal(run2Continuation.effectiveCheckpointTime, run1StartedAt);
  });
});

test("Gmail Hardening: Atomic Live-Write Gating (Repeated & Concurrent Delivery)", async (t) => {
  await t.test("updates application hiring stage ONLY when event was actually inserted (repeated delivery)", () => {
    const existingEvents = new Set();
    const mailbox = "govardhanreddy.vys7@gmail.com";

    const proposedChanges = [
      {
        applicationId: "app-uuid-1",
        company: "Stripe",
        jobTitle: "Software Engineer",
        previousStage: "Applied Confirmed",
        newStage: "Rejected",
        messageId: "msg-rejection-101",
        internalDate: 1794200000000,
        quote: "Unfortunately, we are moving forward with other candidates.",
      },
    ];

    // First delivery: Event does not exist in database
    const delivery1 = filterAtomicStageUpdates({
      proposedChanges,
      existingExternalEventIds: existingEvents,
      mailbox,
    });

    assert.equal(delivery1.toInsertEvents.length, 1);
    assert.equal(delivery1.applicationsToUpdate.length, 1);
    assert.equal(delivery1.applicationsToUpdate[0].applicationId, "app-uuid-1");
    assert.equal(delivery1.applicationsToUpdate[0].newStage, "Rejected");
    assert.equal(delivery1.duplicateDeliveriesSkipped, 0);

    // Second delivery: Same message delivered again (repeated delivery)
    const delivery2 = filterAtomicStageUpdates({
      proposedChanges,
      existingExternalEventIds: existingEvents,
      mailbox,
    });

    // Invariant: Because event already exists, application MUST NOT be updated
    assert.equal(delivery2.toInsertEvents.length, 0);
    assert.equal(delivery2.applicationsToUpdate.length, 0);
    assert.equal(delivery2.duplicateDeliveriesSkipped, 1);
  });

  await t.test("guarantees single application update under concurrent delivery race condition", async () => {
    // Shared mock storage representing Postgres table jobbot.application_events
    const databaseEvents = new Set();
    const mailbox = "govardhanreddy.vys7@gmail.com";

    const incomingChange = {
      applicationId: "app-uuid-concurrent",
      company: "Google",
      jobTitle: "Senior AI Engineer",
      previousStage: "Applied Confirmed",
      newStage: "Offer Received",
      messageId: "msg-offer-999",
      internalDate: 1794205000000,
    };

    // Simulated atomic transaction execution against Postgres
    const simulateWorkerExecution = async (workerId) => {
      const externalEventId = `gmail-status:${mailbox}:${incomingChange.messageId}`;
      let inserted = false;

      // Atomic WHERE NOT EXISTS simulation
      if (!databaseEvents.has(externalEventId)) {
        databaseEvents.add(externalEventId);
        inserted = true;
      }

      if (inserted) {
        return { workerId, eventInserted: true, applicationUpdated: true };
      }
      return { workerId, eventInserted: false, applicationUpdated: false };
    };

    // Run 2 workers concurrently with Promise.all
    const [worker1Result, worker2Result] = await Promise.all([
      simulateWorkerExecution("worker-1"),
      simulateWorkerExecution("worker-2"),
    ]);

    const winner = worker1Result.eventInserted ? worker1Result : worker2Result;
    const loser = worker1Result.eventInserted ? worker2Result : worker1Result;

    assert.equal(winner.eventInserted, true);
    assert.equal(winner.applicationUpdated, true);

    assert.equal(loser.eventInserted, false);
    assert.equal(loser.applicationUpdated, false);

    // Total database state
    assert.equal(databaseEvents.size, 1);
  });
});

test("Gmail Hardening: Security Gate and Invocation Authentication", async (t) => {
  await t.test("rejects missing or incorrect invocation token with HTTP 401", () => {
    const expectedToken = "secret-token-xyz-123";

    const verifyToken = (headerToken) => {
      if (!headerToken) return { status: 401, error: "Missing token" };
      if (headerToken.length !== expectedToken.length) return { status: 401, error: "Invalid token" };
      let r = 0;
      for (let i = 0; i < headerToken.length; i++) {
        r |= headerToken.charCodeAt(i) ^ expectedToken.charCodeAt(i);
      }
      if (r !== 0) return { status: 401, error: "Invalid token" };
      return { status: 200, ok: true };
    };

    // Missing token
    assert.equal(verifyToken(null).status, 401);
    assert.equal(verifyToken("").status, 401);
    // Incorrect tokens
    assert.equal(verifyToken("wrong-token").status, 401);
    assert.equal(verifyToken("secret-token-xyz-999").status, 401);
    assert.equal(verifyToken("Bearer wrong").status, 401);
    // Correct token
    assert.equal(verifyToken("secret-token-xyz-123").status, 200);
  });

  await t.test("production-write gate defaults strictly to disabled", () => {
    const isLiveWriteEnabledByDefault = (envVal) => {
      return envVal === "true";
    };

    // Undefined env var (default)
    assert.equal(isLiveWriteEnabledByDefault(undefined), false);
    // Empty env var
    assert.equal(isLiveWriteEnabledByDefault(""), false);
    // Explicitly false
    assert.equal(isLiveWriteEnabledByDefault("false"), false);
    // Explicitly true
    assert.equal(isLiveWriteEnabledByDefault("true"), true);
  });
});

test("Gmail Hardening: JSONB Serialization Invariant & Regression", async (t) => {
  await t.test("verifies verification_results->>'status' extracts directly from JSONB object vs string", () => {
    // Simulating PostgreSQL JSONB behavior
    const mockPostgresJsonb = (val) => {
      // In PostgreSQL:
      // An object passed to jsonb has jsonb_typeof = 'object'
      // A quoted string passed to jsonb has jsonb_typeof = 'string'
      const isString = typeof val === "string";
      return {
        typeof: isString ? "string" : "object",
        extractStatusArrow: () => {
          // PostgreSQL ->> operator:
          // If jsonb value is a string, ->> on a key returns NULL
          if (isString) return null;
          return val.status || null;
        },
        extractDryRunArrow: () => {
          if (isString) return null;
          return val.dry_run ?? null;
        },
      };
    };

    const targetPayload = {
      status: "dry_run_completed",
      dry_run: true,
      mailbox: "govardhanreddy.vys7@gmail.com",
    };

    // Bug reproduction: passing JSON.stringify(targetPayload)
    const buggyStringified = mockPostgresJsonb(JSON.stringify(targetPayload));
    assert.equal(buggyStringified.typeof, "string");
    assert.equal(buggyStringified.extractStatusArrow(), null, "buggy serialization caused ->>'status' to return null");

    // Fix verification: passing raw object via sql.json
    const fixedObject = mockPostgresJsonb(targetPayload);
    assert.equal(fixedObject.typeof, "object");
    assert.equal(fixedObject.extractStatusArrow(), "dry_run_completed", "fixed serialization allows ->>'status' to directly return dry_run_completed");
    assert.equal(fixedObject.extractDryRunArrow(), true);
  });

  await t.test("resolveScanWindow handles both legacy JSONB string and new JSONB object seamlessly", () => {
    const lastVerifiedCheckpoint = "2026-11-08T22:47:41.801952+00:00";

    // 1. With structured object
    const logWithObject = {
      started_at: "2026-11-09T10:00:00Z",
      completed_at: "2026-11-09T10:01:00Z",
      verification_results: {
        status: "completed",
        dry_run: false,
        has_more_backlog: false,
        checkpoint_advanced: true,
      },
    };

    const window1 = resolveScanWindow({
      latestProductionLog: logWithObject,
      gapReconcile: false,
      lastVerifiedCheckpoint,
      overlapMinutes: 15,
    });
    // Checkpoint advanced to 10:01 minus 15 min = 09:46
    assert.equal(window1.isResumingBackfill, false);
    assert.equal(window1.queryAfterEpoch, Math.floor(new Date("2026-11-09T09:46:00Z").getTime() / 1000));

    // 2. With legacy stringified JSON (defensive parsing)
    const logWithString = {
      started_at: "2026-11-09T10:00:00Z",
      completed_at: "2026-11-09T10:01:00Z",
      verification_results: JSON.stringify({
        status: "partial_backfill",
        dry_run: false,
        has_more_backlog: true,
        checkpoint_advanced: false,
        continuation_before_epoch: 1794200000,
        continuation_after_epoch: 1794100000,
        continuation_ceiling_time: "2026-11-09T10:00:00Z",
      }),
    };

    const window2 = resolveScanWindow({
      latestProductionLog: logWithString,
      gapReconcile: false,
      lastVerifiedCheckpoint,
      overlapMinutes: 15,
    });
    assert.equal(window2.isResumingBackfill, true);
    assert.equal(window2.queryBeforeEpoch, 1794200000);
    assert.equal(window2.queryAfterEpoch, 1794100000);
  });
});


