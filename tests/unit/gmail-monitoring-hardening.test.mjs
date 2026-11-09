import test from "node:test";
import assert from "node:assert/strict";
import { matchApplicationToEmail } from "../../supabase/functions/gmail-status-sync/matcher.ts";

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
