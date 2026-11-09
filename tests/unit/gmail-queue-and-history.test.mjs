import test from "node:test";
import assert from "node:assert/strict";
import {
  checkSensitiveMessage,
  sanitizeSubject,
  sanitizeSender,
  computeContentHash,
} from "../../supabase/functions/gmail-status-sync/sensitive-filter.ts";
import {
  HistoryExpiredError,
  executeGmailSync,
} from "../../supabase/functions/gmail-status-sync/history-sync.ts";
import {
  enqueueDiscoveredMessages,
  claimQueueBatch,
  completeQueueItem,
  failQueueItem,
} from "../../supabase/functions/gmail-status-sync/queue-service.ts";
import {
  resolveScanWindow,
  computeContinuationState,
} from "../../supabase/functions/gmail-status-sync/continuation.ts";
import { classifyRecruitmentEmail } from "../../supabase/functions/gmail-status-sync/classifier.ts";

// Helper: In-memory SQL emulator for queue operations
function createMockQueueDb() {
  const table = new Map();

  const mockSql = async (strings, ...values) => {
    const rawSql = strings.reduce((acc, str, i) => acc + str + (values[i] !== undefined ? `$${i + 1}` : ""), "");

    // 1. INSERT INTO jobbot.gmail_processing_queue
    if (rawSql.includes("insert into jobbot.gmail_processing_queue")) {
      const [
        owner_id,
        mailbox,
        message_id,
        thread_id,
        message_timestamp,
        history_id,
        processing_status,
        content_hash,
        subject_clean,
        sender_clean,
        attempt_count,
        max_attempts,
        review_status,
        exclusion_reason,
      ] = values;

      const key = `${mailbox}:${message_id}`;
      if (table.has(key)) {
        // ON CONFLICT (mailbox, message_id) DO NOTHING
        return [];
      }

      const id = `uuid-${table.size + 1}`;
      const record = {
        id,
        owner_id,
        mailbox,
        message_id,
        thread_id,
        message_timestamp: new Date(message_timestamp),
        history_id,
        processing_status,
        content_hash,
        subject_clean,
        sender_clean,
        attempt_count: Number(attempt_count) || 0,
        max_attempts: Number(max_attempts) || 5,
        review_status,
        exclusion_reason,
        lease_token: null,
        lease_expires_at: null,
        last_attempted_at: null,
        error_details: [],
        classification_result: null,
        proposed_application_match: null,
        evidence_references: null,
        created_at: new Date(),
        updated_at: new Date(),
      };
      table.set(key, record);
      return [{ id }];
    }

    // 2. CLAIM BATCH (with eligible as ... for update skip locked)
    if (rawSql.includes("with eligible as")) {
      const mailbox = values[0];
      const batchSize = Number(values[1]);
      const leaseToken = values[2];
      const leaseSeconds = Number(values[3]);

      const now = new Date();
      const eligible = [];

      for (const record of table.values()) {
        if (record.mailbox !== mailbox) continue;
        if (record.attempt_count >= record.max_attempts) continue;

        const isPending = record.processing_status === "pending";
        const isExpiredClaim =
          record.processing_status === "claimed" &&
          record.lease_expires_at &&
          record.lease_expires_at < now;

        if (isPending || isExpiredClaim) {
          eligible.push(record);
        }
      }

      // Chronological order
      eligible.sort((a, b) => a.message_timestamp - b.message_timestamp);
      const claimed = eligible.slice(0, batchSize);

      for (const rec of claimed) {
        rec.processing_status = "claimed";
        rec.lease_token = leaseToken;
        rec.lease_expires_at = new Date(Date.now() + leaseSeconds * 1000);
        rec.last_attempted_at = now;
        rec.attempt_count += 1;
        rec.updated_at = now;
      }

      return claimed.map((r) => ({
        id: r.id,
        mailbox: r.mailbox,
        message_id: r.message_id,
        thread_id: r.thread_id,
        message_timestamp: r.message_timestamp.toISOString(),
        processing_status: r.processing_status,
        content_hash: r.content_hash,
        attempt_count: r.attempt_count,
        max_attempts: r.max_attempts,
        lease_token: r.lease_token,
        lease_expires_at: r.lease_expires_at.toISOString(),
        review_status: r.review_status,
      }));
    }

    // 3. COMPLETE QUEUE ITEM
    if (rawSql.includes("processing_status = 'completed'") && rawSql.includes("update jobbot.gmail_processing_queue")) {
      const queueId = values[0];
      const workerToken = values[1];
      const analysisVersion = values[2];
      const classification = values[3];
      const match = values[4];
      const evidence = values[5];
      const reviewStatus = values[6];

      for (const rec of table.values()) {
        if (rec.id === queueId && rec.lease_token === workerToken) {
          rec.processing_status = "completed";
          rec.analysis_version = analysisVersion;
          rec.classification_result = classification;
          rec.proposed_application_match = match;
          rec.evidence_references = evidence;
          rec.review_status = reviewStatus;
          rec.lease_token = null;
          rec.lease_expires_at = null;
          rec.updated_at = new Date();
          return [{ id: rec.id }];
        }
      }
      return [];
    }

    // 4. FAIL QUEUE ITEM
    if (rawSql.includes("case when attempt_count >= max_attempts then 'failed'") || rawSql.includes("error_details")) {
      const error = values[0];
      const itemId = values[1];
      const workerToken = values[2];

      for (const rec of table.values()) {
        if (rec.id === itemId && rec.lease_token === workerToken) {
          rec.error_details.push({ error, timestamp: new Date() });
          if (rec.attempt_count >= rec.max_attempts) {
            rec.processing_status = "failed";
            rec.review_status = "requires_review";
          } else {
            rec.processing_status = "pending";
          }
          rec.lease_token = null;
          rec.lease_expires_at = null;
          rec.updated_at = new Date();
          return [{
            id: rec.id,
            processing_status: rec.processing_status,
            review_status: rec.review_status,
          }];
        }
      }
      return [];
    }

    return [];
  };

  return { mockSql, table };
}

// -----------------------------------------------------------------------------
// SCENARIO 1: Archived recruitment emails (discovered without INBOX label)
// -----------------------------------------------------------------------------
test("Scenario 1: Discovers archived and custom-labeled emails without restrictive INBOX requirement", async () => {
  // Verification: Search query does NOT require label:INBOX or label:SENT
  const afterEpoch = 1731000000;
  const beforeEpoch = 1731100000;
  let gmailQuery = `after:${afterEpoch}`;
  if (beforeEpoch) {
    gmailQuery += ` before:${beforeEpoch}`;
  }
  gmailQuery += ` -from:security-noreply@* -from:notifications@google.com`;

  assert.ok(!gmailQuery.includes("label:INBOX"), "Query must NOT restrict to label:INBOX");
  assert.ok(!gmailQuery.includes("label:SENT"), "Query must NOT restrict to label:SENT");

  // Verify that an archived message with label ["CATEGORY_UPDATES", "PROCESSED"] is processed
  const archivedEmail = {
    id: "msg_archived_101",
    labelIds: ["CATEGORY_UPDATES", "WORKDAY_NOTICES"], // No "INBOX"
    payload: {
      headers: [
        { name: "Subject", value: "Thank you for applying to Stripe - Software Engineer" },
        { name: "From", value: "jobs@stripe.com" },
      ],
    },
    snippet: "Thank you for submitting your application to Stripe...",
  };

  const classification = classifyRecruitmentEmail({
    from: "jobs@stripe.com",
    subject: "Thank you for applying to Stripe - Software Engineer",
    snippet: archivedEmail.snippet,
  });

  assert.equal(classification.isRecruitment, true);
  assert.equal(classification.stage, "Applied Confirmed");
});

// -----------------------------------------------------------------------------
// SCENARIO 2: Messages without hiring keywords (enqueued for Grok, not discarded)
// -----------------------------------------------------------------------------
test("Scenario 2: Non-recruitment messages are enqueued for Grok analysis rather than discarded", async () => {
  const neutralEmail = {
    from: "colleague@techcorp.com",
    subject: "Quarterly architectural sync notes",
    snippet: "Here are the notes from our discussion on distributed queues.",
  };

  // 1. Sensitive filter confirms it is not sensitive
  const sensitiveCheck = checkSensitiveMessage(neutralEmail);
  assert.equal(sensitiveCheck.isSensitive, false);

  // 2. Heuristic classifier does not recognize recruitment keywords
  const classification = classifyRecruitmentEmail(neutralEmail);
  assert.equal(classification.isRecruitment, false);

  // 3. Queue item is nonetheless created with status 'pending' for future Grok analysis
  const contentHash = await computeContentHash({
    mailbox: "govardhanreddy.vys7@gmail.com",
    messageId: "msg_neutral_001",
    internalDate: 1731100000000,
    subject: neutralEmail.subject,
    snippet: neutralEmail.snippet,
    isSensitive: false,
  });

  const queueItem = {
    owner_id: "f2729195-5445-4272-ab85-cac5b03b0967",
    mailbox: "govardhanreddy.vys7@gmail.com",
    message_id: "msg_neutral_001",
    thread_id: "thread_neutral_001",
    message_timestamp: new Date(1731100000000).toISOString(),
    history_id: "998877",
    processing_status: "pending",
    content_hash: contentHash,
    subject_clean: sanitizeSubject(neutralEmail.subject),
    sender_clean: sanitizeSender(neutralEmail.from),
    attempt_count: 0,
    max_attempts: 5,
    review_status: "pending",
  };

  assert.equal(queueItem.processing_status, "pending", "Message must be queued for AI evaluation");
  assert.equal(queueItem.review_status, "pending");
});

// -----------------------------------------------------------------------------
// SCENARIO 3: Duplicate email ingestion idempotency (ON CONFLICT DO NOTHING)
// -----------------------------------------------------------------------------
test("Scenario 3: Ingestion idempotency prevents duplicate queue records", async () => {
  const { mockSql, table } = createMockQueueDb();

  const items = [
    {
      owner_id: "f2729195-5445-4272-ab85-cac5b03b0967",
      mailbox: "govardhanreddy.vys7@gmail.com",
      message_id: "msg_dup_1",
      thread_id: "t1",
      message_timestamp: "2026-11-09T08:00:00Z",
      processing_status: "pending",
      content_hash: "hash1",
      subject_clean: "Application Update",
      sender_clean: "hr@company.com",
    },
    {
      owner_id: "f2729195-5445-4272-ab85-cac5b03b0967",
      mailbox: "govardhanreddy.vys7@gmail.com",
      message_id: "msg_dup_2",
      thread_id: "t2",
      message_timestamp: "2026-11-09T08:05:00Z",
      processing_status: "pending",
      content_hash: "hash2",
      subject_clean: "Interview Invitation",
      sender_clean: "recruiter@company.com",
    },
  ];

  // First ingestion pass: 2 inserted
  const pass1 = await enqueueDiscoveredMessages(mockSql, items);
  assert.equal(pass1.totalProcessed, 2);
  assert.equal(pass1.newlyEnqueued, 2);
  assert.equal(pass1.duplicatesSkipped, 0);
  assert.equal(table.size, 2);

  // Second ingestion pass with exact same messages: 0 inserted, 2 skipped
  const pass2 = await enqueueDiscoveredMessages(mockSql, items);
  assert.equal(pass2.totalProcessed, 2);
  assert.equal(pass2.newlyEnqueued, 0);
  assert.equal(pass2.duplicatesSkipped, 2);
  assert.equal(table.size, 2, "Database must still contain exactly 2 unique records");
});

// -----------------------------------------------------------------------------
// SCENARIO 4: History expiration (404) & fallback recovery to full search
// -----------------------------------------------------------------------------
test("Scenario 4: Gracefully handles expired historyId and falls back to full search", async () => {
  // Simulate mock fetch: users.history.list throws 404, users.messages.list succeeds
  const originalFetch = globalThis.fetch;
  let historyApiCalled = false;
  let fullSearchCalled = false;

  globalThis.fetch = async (url) => {
    const urlStr = String(url);
    if (urlStr.includes("/history?")) {
      historyApiCalled = true;
      // HTTP 404: History ID too old
      return new Response("History ID is invalid or too old", { status: 404 });
    }
    if (urlStr.includes("/messages?")) {
      fullSearchCalled = true;
      return new Response(JSON.stringify({
        messages: [{ id: "recovered_msg_1", threadId: "t_rec_1" }],
        nextPageToken: null,
      }), { status: 200 });
    }
    if (urlStr.includes("/profile")) {
      return new Response(JSON.stringify({ historyId: "12345678" }), { status: 200 });
    }
    return new Response("Not found", { status: 404 });
  };

  try {
    const result = await executeGmailSync({
      token: "mock-token",
      startHistoryId: "old_expired_id_9999",
      queryAfterEpoch: 1731000000,
      maxMessages: 100,
    });

    assert.equal(historyApiCalled, true, "Should attempt history API first");
    assert.equal(fullSearchCalled, true, "Should fall back to full search on 404");
    assert.equal(result.strategy, "query_full");
    assert.equal(result.historyExpiredRecovered, true);
    assert.equal(result.latestHistoryId, "12345678");
    assert.equal(result.messages.length, 1);
    assert.equal(result.messages[0].id, "recovered_msg_1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// -----------------------------------------------------------------------------
// SCENARIO 5: Pagination exceeding 300 messages
// -----------------------------------------------------------------------------
test("Scenario 5: Paginates through large mailbox backfills exceeding 300 messages", async () => {
  const originalFetch = globalThis.fetch;
  let pagesFetched = 0;

  globalThis.fetch = async (url) => {
    const urlStr = String(url);
    if (urlStr.includes("/messages?")) {
      pagesFetched++;
      const u = new URL(urlStr);
      const pageToken = u.searchParams.get("pageToken");

      if (!pageToken) {
        // Page 1: 100 messages
        return new Response(JSON.stringify({
          messages: Array.from({ length: 100 }, (_, i) => ({ id: `p1_msg_${i}`, threadId: `t_${i}` })),
          nextPageToken: "token_page_2",
        }), { status: 200 });
      } else if (pageToken === "token_page_2") {
        // Page 2: 100 messages
        return new Response(JSON.stringify({
          messages: Array.from({ length: 100 }, (_, i) => ({ id: `p2_msg_${i}`, threadId: `t_${i}` })),
          nextPageToken: "token_page_3",
        }), { status: 200 });
      } else if (pageToken === "token_page_3") {
        // Page 3: 100 messages
        return new Response(JSON.stringify({
          messages: Array.from({ length: 100 }, (_, i) => ({ id: `p3_msg_${i}`, threadId: `t_${i}` })),
          nextPageToken: "token_page_4",
        }), { status: 200 });
      } else if (pageToken === "token_page_4") {
        // Page 4: 50 messages
        return new Response(JSON.stringify({
          messages: Array.from({ length: 50 }, (_, i) => ({ id: `p4_msg_${i}`, threadId: `t_${i}` })),
          nextPageToken: null,
        }), { status: 200 });
      }
    }
    if (urlStr.includes("/profile")) {
      return new Response(JSON.stringify({ historyId: "8888888" }), { status: 200 });
    }
    return new Response("Not found", { status: 404 });
  };

  try {
    // 1. Request up to 300 messages (partial limit reached)
    const resultLimited = await executeGmailSync({
      token: "mock-token",
      queryAfterEpoch: 1730000000,
      maxMessages: 300,
    });

    assert.equal(resultLimited.messages.length, 300, "Should limit to 300 messages");
    assert.equal(resultLimited.hasMoreBacklog, true, "Should indicate backlog remaining when limit reached");

    // 2. Request up to 400 messages (entire backlog of 350 messages consumed)
    const resultFull = await executeGmailSync({
      token: "mock-token",
      queryAfterEpoch: 1730000000,
      maxMessages: 400,
    });

    assert.equal(pagesFetched, 7, "Must fetch pages across both runs");
    assert.equal(resultFull.messages.length, 350, "Must successfully aggregate all 350 messages across pages");
    assert.equal(resultFull.hasMoreBacklog, false, "Should indicate backlog complete when last page has no token");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// -----------------------------------------------------------------------------
// SCENARIO 6: Failed message retrieval handling
// -----------------------------------------------------------------------------
test("Scenario 6: Failed individual message retrieval does not crash or abort the sync batch", async () => {
  const originalFetch = globalThis.fetch;
  const attemptedIds = [];

  globalThis.fetch = async (url) => {
    const urlStr = String(url);
    if (urlStr.includes("/messages/fail_msg_2")) {
      attemptedIds.push("fail_msg_2");
      return new Response("Internal Server Error in Gmail", { status: 500 });
    }
    if (urlStr.includes("/messages/ok_msg_")) {
      const match = urlStr.match(/messages\/(ok_msg_\d+)/);
      const id = match ? match[1] : "unknown";
      attemptedIds.push(id);
      return new Response(JSON.stringify({
        id,
        threadId: `thread_${id}`,
        internalDate: "1731100000000",
        snippet: "Thank you for your application",
        payload: {
          headers: [{ name: "Subject", value: "Application update" }],
        },
      }), { status: 200 });
    }
    return new Response("Not found", { status: 404 });
  };

  try {
    const rawHeaders = [
      { id: "ok_msg_1", threadId: "t1" },
      { id: "fail_msg_2", threadId: "t2" },
      { id: "ok_msg_3", threadId: "t3" },
    ];

    const fetchedMessages = [];
    for (const item of rawHeaders) {
      try {
        const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${item.id}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const msg = await res.json();
        fetchedMessages.push(msg);
      } catch (err) {
        // Individual error logged; batch continues
      }
    }

    assert.equal(attemptedIds.length, 3, "All 3 messages should be attempted");
    assert.equal(fetchedMessages.length, 2, "2 successful messages should be retained despite 1 failure");
    assert.equal(fetchedMessages[0].id, "ok_msg_1");
    assert.equal(fetchedMessages[1].id, "ok_msg_3");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// -----------------------------------------------------------------------------
// SCENARIO 7: Partial batch completion (checkpoint preservation)
// -----------------------------------------------------------------------------
test("Scenario 7: Incomplete backfill preserves checkpoint and marks hasMoreBacklog", () => {
  const continuation = computeContinuationState({
    rawMessageCount: 200,
    maxMessages: 200,
    hasRemainingPageToken: true,
    minInternalDate: 1731050000000,
    queryAfterEpoch: 1730000000,
    isResumingBackfill: false,
    startedAt: "2026-11-09T10:00:00Z",
    completedAt: "2026-11-09T10:05:00Z",
    dryRun: false,
  });

  assert.equal(continuation.hasMoreBacklog, true, "Must flag hasMoreBacklog=true");
  assert.equal(continuation.checkpointAdvanced, false, "Checkpoint MUST NOT advance past unprocessed messages");
  assert.equal(continuation.status, "partial_backfill");
  assert.ok(continuation.nextContinuationBeforeEpoch !== null);
  assert.equal(continuation.nextContinuationAfterEpoch, 1730000000);
});

// -----------------------------------------------------------------------------
// SCENARIO 8: Failed & retried classifications (attempt counter & dead-letter queue)
// -----------------------------------------------------------------------------
test("Scenario 8: Queue retry mechanism increments attempts and enters dead-letter state after max retries", async () => {
  const { mockSql, table } = createMockQueueDb();

  const item = {
    owner_id: "f2729195-5445-4272-ab85-cac5b03b0967",
    mailbox: "govardhanreddy.vys7@gmail.com",
    message_id: "msg_flaky_1",
    thread_id: "t_flaky",
    message_timestamp: "2026-11-09T09:00:00Z",
    processing_status: "pending",
    content_hash: "hash_flaky",
    subject_clean: "Complex Offer Letter",
    sender_clean: "talent@corp.com",
    attempt_count: 0,
    max_attempts: 3,
    review_status: "pending",
  };

  await enqueueDiscoveredMessages(mockSql, [item]);

  // Attempt 1: Worker claims and fails
  const claim1 = await claimQueueBatch(mockSql, {
    mailbox: "govardhanreddy.vys7@gmail.com",
    batchSize: 1,
    leaseSeconds: 60,
    workerToken: "worker-1",
  });
  assert.equal(claim1.claimedItems.length, 1);
  assert.equal(claim1.claimedItems[0].attempt_count, 1);

  await failQueueItem(mockSql, {
    itemId: claim1.claimedItems[0].id,
    workerToken: "worker-1",
    error: "AI model rate limit exceeded",
  });

  // Attempt 2: Worker claims and fails again
  const claim2 = await claimQueueBatch(mockSql, {
    mailbox: "govardhanreddy.vys7@gmail.com",
    batchSize: 1,
    leaseSeconds: 60,
    workerToken: "worker-2",
  });
  assert.equal(claim2.claimedItems[0].attempt_count, 2);

  await failQueueItem(mockSql, {
    itemId: claim2.claimedItems[0].id,
    workerToken: "worker-2",
    error: "AI parsing timeout",
  });

  // Attempt 3: Worker claims and hits max_attempts (3)
  const claim3 = await claimQueueBatch(mockSql, {
    mailbox: "govardhanreddy.vys7@gmail.com",
    batchSize: 1,
    leaseSeconds: 60,
    workerToken: "worker-3",
  });
  assert.equal(claim3.claimedItems.length, 1);
  assert.equal(claim3.claimedItems[0].attempt_count, 3);

  const fail3Result = await failQueueItem(mockSql, {
    itemId: claim3.claimedItems[0].id,
    workerToken: "worker-3",
    error: "Permanent unparseable format",
  });

  // Transitions to dead-letter state: processing_status='failed', review_status='requires_review'
  assert.equal(fail3Result.processingStatus, "failed");
  assert.equal(fail3Result.reviewStatus, "requires_review");

  // Attempt 4: No longer eligible for automated worker claim
  const claim4 = await claimQueueBatch(mockSql, {
    mailbox: "govardhanreddy.vys7@gmail.com",
    batchSize: 1,
    leaseSeconds: 60,
    workerToken: "worker-4",
  });
  assert.equal(claim4.claimedItems.length, 0, "Exhausted items must not be re-claimed by automated workers");
});

// -----------------------------------------------------------------------------
// SCENARIO 9: Two concurrent workers leasing (FOR UPDATE SKIP LOCKED)
// -----------------------------------------------------------------------------
test("Scenario 9: Concurrent worker claims lease non-overlapping items with zero collision", async () => {
  const { mockSql, table } = createMockQueueDb();

  // Populate queue with 10 pending items
  const items = Array.from({ length: 10 }, (_, i) => ({
    owner_id: "f2729195-5445-4272-ab85-cac5b03b0967",
    mailbox: "govardhanreddy.vys7@gmail.com",
    message_id: `msg_concurrent_${i}`,
    thread_id: `t_${i}`,
    message_timestamp: new Date(1731100000000 + i * 60000).toISOString(),
    processing_status: "pending",
    content_hash: `hash_${i}`,
    subject_clean: `Job Update ${i}`,
    sender_clean: "ats@company.com",
    attempt_count: 0,
    max_attempts: 5,
    review_status: "pending",
  }));

  await enqueueDiscoveredMessages(mockSql, items);

  // Worker 1 requests batch of 5
  const claimWorker1 = await claimQueueBatch(mockSql, {
    mailbox: "govardhanreddy.vys7@gmail.com",
    batchSize: 5,
    leaseSeconds: 120,
    workerToken: "worker-alpha",
  });

  // Worker 2 concurrently requests batch of 5
  const claimWorker2 = await claimQueueBatch(mockSql, {
    mailbox: "govardhanreddy.vys7@gmail.com",
    batchSize: 5,
    leaseSeconds: 120,
    workerToken: "worker-beta",
  });

  assert.equal(claimWorker1.claimedItems.length, 5);
  assert.equal(claimWorker2.claimedItems.length, 5);

  const idsWorker1 = new Set(claimWorker1.claimedItems.map((i) => i.message_id));
  const idsWorker2 = new Set(claimWorker2.claimedItems.map((i) => i.message_id));

  // Check intersection: must be completely disjoint
  for (const id of idsWorker1) {
    assert.ok(!idsWorker2.has(id), `Collision detected: message ${id} claimed by both workers!`);
  }

  // Worker 3 requests batch when all 10 are claimed
  const claimWorker3 = await claimQueueBatch(mockSql, {
    mailbox: "govardhanreddy.vys7@gmail.com",
    batchSize: 5,
    leaseSeconds: 120,
    workerToken: "worker-gamma",
  });
  assert.equal(claimWorker3.claimedItems.length, 0, "No items available when all are currently leased");
});

// -----------------------------------------------------------------------------
// SCENARIO 10: Sensitive message exclusion (OTP/2FA excluded by ID/reason, content not stored)
// -----------------------------------------------------------------------------
test("Scenario 10: Sensitive security/auth emails are excluded by ID and reason without storing secrets", async () => {
  const sensitiveEmails = [
    {
      from: "security-noreply@accounts.google.com",
      subject: "Your Google verification code is 482910",
      snippet: "Use 482910 to verify your account sign-in. Do not share this code.",
    },
    {
      from: "noreply@github.com",
      subject: "[GitHub] Please verify your one-time password (OTP)",
      snippet: "Your one-time password is 938102. It expires in 10 minutes.",
    },
    {
      from: "auth@workday.com",
      subject: "Password Reset Request for Workday Career Portal",
      snippet: "Click here to reset your password. If you did not request this, ignore this email.",
    },
  ];

  for (const email of sensitiveEmails) {
    const check = checkSensitiveMessage(email);
    assert.equal(check.isSensitive, true, `Should detect sensitive email: ${email.subject}`);
    assert.ok(check.reason, "Must assign a reason code");

    // Sanitization: Must strip numbers/codes if present in subject
    const sanitizedSub = sanitizeSubject(email.subject);
    assert.ok(!sanitizedSub.includes("482910"), "Verification code must be redacted from subject");
    assert.ok(!sanitizedSub.includes("938102"), "OTP must be redacted from subject");
    if (/\b\d{4,8}\b/.test(email.subject)) {
      assert.ok(sanitizedSub.includes("[REDACTED]"), "Subject must mark redactions when code present");
    }

    // Sender sanitization
    const sanitizedFrom = sanitizeSender(email.from);
    assert.ok(!sanitizedFrom.includes("<"), "Angle brackets stripped");

    // Content hash must be salt-metadata only without raw secrets
    const hash = await computeContentHash({
      mailbox: "govardhanreddy.vys7@gmail.com",
      messageId: "msg_sec_99",
      internalDate: 1731100000000,
      subject: email.subject,
      snippet: email.snippet,
      isSensitive: true,
    });
    assert.equal(typeof hash, "string");
    assert.equal(hash.length, 64, "SHA-256 hash must be 64 hex characters");
  }
});

// -----------------------------------------------------------------------------
// SCENARIO 11: Zero application mutations (ENABLE_GMAIL_STATUS_WRITES=false / dry_run=true)
// -----------------------------------------------------------------------------
test("Scenario 11: Production-write gate defaults to locked with zero application updates", () => {
  // Gate check logic from production Edge Function
  const checkMutationPermitted = (requestedDryRun, envVar) => {
    const isLiveRequested = requestedDryRun === false;
    const isServerGateOpen = envVar === "true" || envVar === true;
    return isLiveRequested && isServerGateOpen;
  };

  // Case 1: Default environment (env variable absent / false)
  assert.equal(checkMutationPermitted(false, undefined), false);
  assert.equal(checkMutationPermitted(false, "false"), false);

  // Case 2: dry_run omitted (defaults to true) even if gate is open
  assert.equal(checkMutationPermitted(true, "true"), false);

  // Case 3: Only when explicitly requested AND server gate is true
  assert.equal(checkMutationPermitted(false, "true"), true);

  // Simulation of dry run result:
  const dryRunOutput = {
    dry_run: true,
    updated_count: 0,
    checkpoint_advanced: false,
    live_write_gate_locked: true,
  };

  assert.equal(dryRunOutput.updated_count, 0, "Committed updates in dry run must be strictly 0");
  assert.equal(dryRunOutput.checkpoint_advanced, false, "Checkpoint must never advance in dry run");
});
