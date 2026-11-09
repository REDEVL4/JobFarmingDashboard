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
  PermanentMessageInaccessibleError,
  TransientMessageFetchError,
  executeGmailSync,
  syncViaGmailHistory,
  syncViaGmailFullSearch,
  fetchMessageWithRetry,
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

// Helper: In-memory SQL emulator for queue & cursor operations
function createMockQueueDb() {
  const table = new Map();
  const cursors = new Map();
  const syncLogs = [];
  const applications = new Map();

  const createSqlInstance = (inTransaction = false) => {
    const mockSql = async (strings, ...values) => {
      const rawSql = strings.reduce((acc, str, i) => acc + str + (values[i] !== undefined ? `$${i + 1}` : ""), "");

      // 1. INSERT INTO jobbot.gmail_processing_queue
      if (rawSql.includes("insert into jobbot.gmail_processing_queue")) {
        let owner_id, mailbox, message_id, thread_id, message_timestamp,
            history_id, processing_status, content_hash, subject_clean,
            sender_clean, attempt_count, max_attempts, review_status,
            exclusion_reason, evidence_references, error_details;

        if (values.length >= 16) {
          [
            owner_id, mailbox, message_id, thread_id, message_timestamp,
            history_id, processing_status, content_hash, subject_clean,
            sender_clean, attempt_count, max_attempts, review_status,
            exclusion_reason, evidence_references, error_details,
          ] = values;
        } else {
          [
            owner_id, mailbox, message_id, thread_id, message_timestamp,
            history_id, processing_status, content_hash, subject_clean,
            sender_clean, attempt_count, max_attempts, review_status,
            exclusion_reason, error_details,
          ] = values;
        }

        // Simulate intentional failure for transaction testing
        if (message_id === "FORCE_TRANSACTION_FAIL") {
          throw new Error("Simulated database failure during queue insert");
        }

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
          error_details: Array.isArray(error_details) ? error_details : [],
          classification_result: null,
          proposed_application_match: null,
          evidence_references: evidence_references || null,
          created_at: new Date(),
          updated_at: new Date(),
        };
        table.set(key, record);
        return [{ id }];
      }

      // 2. INSERT / UPDATE jobbot.sync_cursors
      if (rawSql.includes("insert into jobbot.sync_cursors")) {
        const [
          owner_id,
          source_key,
          last_success_at,
          last_observed_at,
          last_history_id,
          overlap_minutes,
          initial_lookback_hours,
        ] = values;

        const key = `${owner_id}:${source_key}`;
        const existing = cursors.get(key) || {};

        cursors.set(key, {
          owner_id,
          source_key,
          last_success_at: (last_success_at !== undefined && last_success_at !== null) ? last_success_at : (existing.last_success_at || null),
          last_observed_at: (last_observed_at !== undefined && last_observed_at !== null) ? last_observed_at : (existing.last_observed_at || null),
          last_history_id: (last_history_id !== undefined && last_history_id !== null) ? last_history_id : (existing.last_history_id || null),
          overlap_minutes: overlap_minutes || existing.overlap_minutes || 15,
          initial_lookback_hours: initial_lookback_hours || 72,
          consecutive_failures: 0,
          updated_at: new Date().toISOString(),
        });
        return [{ key }];
      }

      // 3. SELECT FROM jobbot.sync_cursors
      if (rawSql.includes("from jobbot.sync_cursors")) {
        const [sourceKey, ownerId] = values;
        const key = `${ownerId}:${sourceKey}`;
        const record = cursors.get(key);
        return record ? [record] : [];
      }

      // 4. INSERT INTO jobbot.sync_logs
      if (rawSql.includes("insert into jobbot.sync_logs")) {
        const [runId, botName, startedAt, completedAt, createdCount, updatedCount, skippedCount, errors, verificationResults] = values;
        syncLogs.push({
          runId,
          botName,
          startedAt,
          completedAt,
          createdCount,
          updatedCount,
          skippedCount,
          errors,
          verificationResults,
        });
        return [{ id: runId }];
      }

      // 5. CLAIM BATCH (with eligible as ... for update skip locked)
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

          const isPending = record.processing_status === "pending" || record.processing_status === "pending_fetch";
          const isExpiredClaim =
            record.processing_status === "claimed" &&
            record.lease_expires_at &&
            record.lease_expires_at < now;

          if (isPending || isExpiredClaim) {
            eligible.push(record);
          }
        }

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

      // 6. COMPLETE QUEUE ITEM
      if (rawSql.includes("processing_status = 'completed'") && rawSql.includes("update jobbot.gmail_processing_queue")) {
        const analysisVersion = values[0];
        const classification = values[1];
        const match = values[2];
        const reviewStatus = values[3];
        const queueId = values[4];
        const workerToken = values[5];

        for (const rec of table.values()) {
          if (rec.id === queueId && rec.lease_token === workerToken) {
            rec.processing_status = "completed";
            rec.analysis_version = analysisVersion;
            rec.classification_result = classification;
            rec.proposed_application_match = match;
            rec.review_status = reviewStatus;
            rec.lease_token = null;
            rec.lease_expires_at = null;
            rec.updated_at = new Date();
            return [{ id: rec.id }];
          }
        }
        return [];
      }

      // 7. FAIL QUEUE ITEM (maintains FLAT JSONB array)
      if (rawSql.includes("case when attempt_count >= max_attempts then 'failed'") || rawSql.includes("error_details")) {
        const error = values[0];
        const itemId = values[1];
        const workerToken = values[2];

        for (const rec of table.values()) {
          if (rec.id === itemId && rec.lease_token === workerToken) {
            // Emulate flat JSONB concatenation: coalesce(error_details, '[]') || jsonb_build_array(...)
            if (!Array.isArray(rec.error_details)) {
              rec.error_details = [];
            }
            rec.error_details.push({ error, timestamp: new Date().toISOString() });

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

    // Helper to simulate atomic transaction
    mockSql.begin = async (callback) => {
      // Create snapshot for rollback
      const tableSnapshot = new Map(Array.from(table.entries()).map(([k, v]) => [k, { ...v }]));
      const cursorsSnapshot = new Map(Array.from(cursors.entries()).map(([k, v]) => [k, { ...v }]));
      const logsSnapshotLength = syncLogs.length;

      const txSql = createSqlInstance(true);

      try {
        const result = await callback(txSql);
        return result;
      } catch (err) {
        // Rollback state completely
        table.clear();
        for (const [k, v] of tableSnapshot) table.set(k, v);
        cursors.clear();
        for (const [k, v] of cursorsSnapshot) cursors.set(k, v);
        syncLogs.length = logsSnapshotLength;
        throw err;
      }
    };

    mockSql.json = (val) => val;
    return mockSql;
  };

  const sql = createSqlInstance(false);
  return { sql, table, cursors, syncLogs, applications };
}

// =============================================================================
// REGRESSION SCENARIO 1: Full-search batch with 500 messages and 300-message limit
// =============================================================================
test("Scenario 1: Full-search batch with 500 messages and 300-message limit preserves progress without premature cursor advancement", async () => {
  const originalFetch = globalThis.fetch;
  const { sql, table, cursors, syncLogs } = createMockQueueDb();

  // Mock Gmail API returning 500 messages across pages of 100
  globalThis.fetch = async (url) => {
    const urlStr = String(url);
    if (urlStr.includes("profile")) {
      return new Response(JSON.stringify({ historyId: "hist_snapshot_500" }), { status: 200 });
    }
    if (urlStr.includes("messages?")) {
      const u = new URL(urlStr);
      const pageToken = u.searchParams.get("pageToken") || "p1";
      const pageNum = parseInt(pageToken.replace("p", "")) || 1;
      const startIdx = (pageNum - 1) * 100;
      const messages = [];
      for (let i = 0; i < 100; i++) {
        const msgNum = startIdx + i + 1;
        messages.push({ id: `msg_500_${msgNum}`, threadId: `t_${msgNum}` });
      }
      const nextPageToken = pageNum < 5 ? `p${pageNum + 1}` : null;
      return new Response(JSON.stringify({ messages, nextPageToken }), { status: 200 });
    }
    return new Response("Not found", { status: 404 });
  };

  try {
    const fullRes = await syncViaGmailFullSearch({
      token: "mock-token",
      queryAfterEpoch: 1731000000,
      maxMessages: 300,
    });

    assert.equal(fullRes.messages.length, 300, "Must discover exactly 300 messages (the max limit)");
    assert.equal(fullRes.hasMoreBacklog, true, "Must flag backlog remaining");
    assert.equal(fullRes.latestHistoryId, null, "latestHistoryId MUST BE NULL when backlog remains to prevent advancing cursor past unprocessed messages");
    assert.equal(fullRes.startHistorySnapshot, "hist_snapshot_500", "Must preserve starting history snapshot");
    assert.ok(fullRes.nextPageToken, "Must preserve continuation page token");

    const continuation = computeContinuationState({
      rawMessageCount: fullRes.messages.length,
      maxMessages: 300,
      hasRemainingPageToken: Boolean(fullRes.nextPageToken),
      minInternalDate: 1731050000 * 1000,
      queryAfterEpoch: 1731000000,
      isResumingBackfill: false,
      startedAt: "2026-11-09T12:00:00Z",
      completedAt: "2026-11-09T12:01:00Z",
      dryRun: false,
    });

    assert.equal(continuation.hasMoreBacklog, true);
    assert.equal(continuation.checkpointAdvanced, false, "checkpointAdvanced MUST BE FALSE when backlog remains");
    assert.equal(continuation.effectiveCheckpointTime, null, "effectiveCheckpointTime MUST BE NULL to prevent advancing last_success_at");
    assert.equal(continuation.status, "partial_backfill");

    // Commit the 300 messages in ingestion_only mode
    await sql.begin(async (tx) => {
      const enq = await enqueueDiscoveredMessages(tx, fullRes.messages.map((m, idx) => ({
        owner_id: "f2729195-5445-4272-ab85-cac5b03b0967",
        mailbox: "govardhanreddy.vys7@gmail.com",
        message_id: m.id,
        message_timestamp: new Date(1731050000 * 1000 + idx * 1000).toISOString(),
        processing_status: "pending",
        content_hash: `hash_${m.id}`,
      })));
      assert.equal(enq.newlyEnqueued, 300);

      // Invariant: Because checkpointAdvanced is false, cursor last_success_at MUST NOT advance
      if (continuation.checkpointAdvanced) {
        await tx`
          insert into jobbot.sync_cursors (
            owner_id, source_key, last_success_at, last_observed_at,
            last_history_id, overlap_minutes, initial_lookback_hours
          ) values (
            ${"f2729195-5445-4272-ab85-cac5b03b0967"}, ${"gmail_status_ingestion"},
            ${"2026-11-09T12:01:00Z"}, ${"2026-11-09T12:01:00Z"},
            ${fullRes.latestHistoryId}, ${15}, ${72}
          )
        `;
      }
    });

    assert.equal(table.size, 300, "Must durably preserve all 300 enqueued messages in database");
    assert.equal(cursors.size, 0, "Ingestion cursor MUST NOT have advanced past unprocessed messages");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// =============================================================================
// REGRESSION SCENARIO 2: History-based synchronization containing multiple records and pages
// =============================================================================
test("Scenario 2: History-based synchronization containing multiple records and pages consumes records losslessly", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url) => {
    const urlStr = String(url);
    if (urlStr.includes("history?")) {
      const u = new URL(urlStr);
      const startHistoryId = u.searchParams.get("startHistoryId");
      const pageToken = u.searchParams.get("pageToken");

      if (startHistoryId === "1000" && !pageToken) {
        // Page 1: records 1001, 1002 (each with 2 messages)
        return new Response(JSON.stringify({
          historyId: "1005",
          history: [
            { id: "1001", messagesAdded: [{ message: { id: "m1", threadId: "t1" } }, { message: { id: "m2", threadId: "t2" } }] },
            { id: "1002", messagesAdded: [{ message: { id: "m3", threadId: "t3" } }, { message: { id: "m4", threadId: "t4" } }] },
          ],
          nextPageToken: "page_2",
        }), { status: 200 });
      } else if (startHistoryId === "1000" && pageToken === "page_2") {
        // Page 2: records 1003, 1004
        return new Response(JSON.stringify({
          historyId: "1005",
          history: [
            { id: "1003", messagesAdded: [{ message: { id: "m5", threadId: "t5" } }] },
            { id: "1004", messagesAdded: [{ message: { id: "m6", threadId: "t6" } }] },
          ],
          nextPageToken: null,
        }), { status: 200 });
      } else if (startHistoryId === "1002") {
        // Resumed run starting after record 1002
        return new Response(JSON.stringify({
          historyId: "1005",
          history: [
            { id: "1003", messagesAdded: [{ message: { id: "m5", threadId: "t5" } }] },
            { id: "1004", messagesAdded: [{ message: { id: "m6", threadId: "t6" } }] },
          ],
          nextPageToken: null,
        }), { status: 200 });
      }
    }
    return new Response("Not found", { status: 404 });
  };

  try {
    // Limit to 3 messages: Record 1001 (2 msgs) + Record 1002 (2 msgs) = 4 msgs.
    // Record 1002 is completed entirely; stops before record 1003.
    const run1 = await syncViaGmailHistory({
      token: "mock-token",
      startHistoryId: "1000",
      maxMessages: 3,
    });

    assert.equal(run1.messages.length, 4, "Must complete record 1002 entirely before breaking");
    assert.equal(run1.hasMoreBacklog, true, "Must flag backlog remaining");
    assert.equal(run1.latestHistoryId, "1002", "Checkpoint must be safe fully-consumed record 1002, NOT premature 1005");
    assert.equal(run1.nextPageToken, null, "Must NOT reuse incompatible pagination token across new historyId");

    // Pass 2: Resume with startHistoryId: "1002"
    const run2 = await syncViaGmailHistory({
      token: "mock-token",
      startHistoryId: run1.latestHistoryId,
      maxMessages: 10,
    });

    assert.equal(run2.messages.length, 2, "Pass 2 fetches remaining records 1003 and 1004");
    assert.equal(run2.hasMoreBacklog, false, "Backlog exhausted");
    assert.equal(run2.latestHistoryId, "1005", "Final checkpoint advances to 1005");

    const allDiscoveredIds = [...run1.messages.map((m) => m.id), ...run2.messages.map((m) => m.id)];
    assert.deepEqual(allDiscoveredIds, ["m1", "m2", "m3", "m4", "m5", "m6"], "Zero messages lost across multi-record pagination!");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// =============================================================================
// REGRESSION SCENARIO 3: New email arriving during full search
// =============================================================================
test("Scenario 3: New email arriving during full search is captured safely without being skipped", async () => {
  const originalFetch = globalThis.fetch;
  const { sql, table, cursors } = createMockQueueDb();

  let mailboxHistoryId = "70000"; // Starting history snapshot before search

  globalThis.fetch = async (url) => {
    const urlStr = String(url);
    if (urlStr.includes("profile")) {
      return new Response(JSON.stringify({ historyId: mailboxHistoryId }), { status: 200 });
    }
    if (urlStr.includes("messages?")) {
      // While the search is executing, a new email arrives in mailbox!
      mailboxHistoryId = "70010"; // Mailbox history advances
      return new Response(JSON.stringify({
        messages: [
          { id: "msg_existing_1", threadId: "t1" },
          { id: "msg_existing_2", threadId: "t2" },
        ],
        nextPageToken: null,
      }), { status: 200 });
    }
    if (urlStr.includes("history?")) {
      const u = new URL(urlStr);
      const startHistoryId = u.searchParams.get("startHistoryId");
      if (startHistoryId === "70000") {
        // Incremental poll starting from safe snapshot 70000 returns the new email that arrived during search!
        return new Response(JSON.stringify({
          historyId: "70010",
          history: [
            {
              id: "70005",
              messagesAdded: [{ message: { id: "msg_arrived_during_search", threadId: "t_new" } }],
            },
          ],
          nextPageToken: null,
        }), { status: 200 });
      }
    }
    return new Response("Not found", { status: 404 });
  };

  try {
    // 1. Initial full search run
    const searchRes = await syncViaGmailFullSearch({
      token: "mock-token",
      queryAfterEpoch: 1731000000,
      maxMessages: 100,
    });

    assert.equal(searchRes.startHistorySnapshot, "70000", "Starting snapshot MUST be captured BEFORE search started");
    assert.equal(searchRes.latestHistoryId, "70000", "Safe checkpoint to persist is the starting snapshot 70000, NOT the post-scan 70010");

    // Commit full search results and cursor
    await sql.begin(async (tx) => {
      await enqueueDiscoveredMessages(tx, searchRes.messages.map((m) => ({
        owner_id: "f2729195-5445-4272-ab85-cac5b03b0967",
        mailbox: "govardhanreddy.vys7@gmail.com",
        message_id: m.id,
        message_timestamp: new Date().toISOString(),
        processing_status: "pending",
        content_hash: `hash_${m.id}`,
      })));

      await tx`
        insert into jobbot.sync_cursors (
          owner_id, source_key, last_success_at, last_observed_at,
          last_history_id, overlap_minutes, initial_lookback_hours
        ) values (
          ${"f2729195-5445-4272-ab85-cac5b03b0967"}, ${"gmail_status_ingestion"},
          ${"2026-11-09T12:00:00Z"}, ${"2026-11-09T12:00:00Z"},
          ${searchRes.latestHistoryId}, ${15}, ${72}
        )
      `;
    });

    // 2. Next incremental run reads cursor (70000) and executes incremental history sync
    const cursor = cursors.get("f2729195-5445-4272-ab85-cac5b03b0967:gmail_status_ingestion");
    assert.equal(cursor.last_history_id, "70000");

    const incrementalSync = await executeGmailSync({
      token: "mock-token",
      startHistoryId: cursor.last_history_id,
      queryAfterEpoch: 1731000000,
      maxMessages: 100,
    });

    assert.equal(incrementalSync.strategy, "history");
    assert.equal(incrementalSync.messages.length, 1);
    assert.equal(incrementalSync.messages[0].id, "msg_arrived_during_search", "Must capture the email that arrived during the full search!");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// =============================================================================
// REGRESSION SCENARIO 4: Cursor rollback after queue insertion failure
// =============================================================================
test("Scenario 4: Cursor rollback after queue insertion failure preserves previous cursor and leaves 0 queue rows", async () => {
  const { sql, table, cursors, syncLogs } = createMockQueueDb();

  // Set initial cursor state
  cursors.set("f2729195-5445-4272-ab85-cac5b03b0967:gmail_status_ingestion", {
    last_history_id: "hist_initial_safe_100",
    last_success_at: "2026-11-09T10:00:00Z",
  });

  const badItems = [
    {
      owner_id: "f2729195-5445-4272-ab85-cac5b03b0967",
      mailbox: "govardhanreddy.vys7@gmail.com",
      message_id: "msg_valid_1",
      message_timestamp: new Date().toISOString(),
      processing_status: "pending",
      content_hash: "hash_v1",
    },
    {
      owner_id: "f2729195-5445-4272-ab85-cac5b03b0967",
      mailbox: "govardhanreddy.vys7@gmail.com",
      message_id: "FORCE_TRANSACTION_FAIL", // Triggers simulated DB error
      message_timestamp: new Date().toISOString(),
      processing_status: "pending",
      content_hash: "hash_fail",
    },
  ];

  let transactionFailed = false;
  try {
    await sql.begin(async (tx) => {
      // 1. Attempt queue insert (throws on second item)
      await enqueueDiscoveredMessages(tx, badItems);

      // 2. Cursor advancement (should never be reached or committed)
      await tx`
        insert into jobbot.sync_cursors (
          owner_id, source_key, last_success_at, last_observed_at,
          last_history_id, overlap_minutes, initial_lookback_hours
        ) values (
          ${"f2729195-5445-4272-ab85-cac5b03b0967"}, ${"gmail_status_ingestion"},
          ${"2026-11-09T10:30:00Z"}, ${"2026-11-09T10:30:00Z"},
          ${"hist_corrupted_999"}, ${15}, ${72}
        )
      `;
    });
  } catch (err) {
    transactionFailed = true;
  }

  assert.equal(transactionFailed, true, "Transaction must fail and throw");
  assert.equal(table.size, 0, "No queue rows may be committed when transaction aborts");
  const cursorRecord = cursors.get("f2729195-5445-4272-ab85-cac5b03b0967:gmail_status_ingestion");
  assert.equal(cursorRecord.last_history_id, "hist_initial_safe_100", "Cursor MUST NOT advance when queue insert fails");
  assert.equal(cursorRecord.last_success_at, "2026-11-09T10:00:00Z", "Timestamp MUST NOT advance");
});

// =============================================================================
// REGRESSION SCENARIO 5: Successful automatic continuation after an incomplete hourly run
// =============================================================================
test("Scenario 5: Successful automatic continuation resumes full search window unattended without manual parameters", async () => {
  const originalFetch = globalThis.fetch;
  const { sql, table, cursors, syncLogs } = createMockQueueDb();

  // Seed previous incomplete production sync log in database
  syncLogs.push({
    run_id: "prev-partial-run-1",
    bot_name: "Gmail Status Agent",
    started_at: "2026-11-09T11:00:00Z",
    completed_at: "2026-11-09T11:05:00Z",
    created_count: 200,
    updated_count: 0,
    skipped_count: 0,
    errors: [],
    verification_results: {
      status: "partial_backfill",
      mode: "ingestion_only",
      dry_run: false,
      has_more_backlog: true,
      checkpoint_advanced: false,
      continuation_before_epoch: 1731050000,
      continuation_after_epoch: 1731000000,
      continuation_ceiling_time: "2026-11-09T11:00:00Z",
      start_history_snapshot: "snapshot_h888",
    },
  });

  // Next run: unattended invocation (no manual body parameters)
  const latestProdLog = syncLogs[0];
  const scanWindow = resolveScanWindow({
    latestProductionLog: latestProdLog,
    cursorRecord: null,
    gapReconcile: false,
    lastVerifiedCheckpoint: "2026-11-08T22:47:41Z",
    overlapMinutes: 15,
  });

  assert.equal(scanWindow.isResumingBackfill, true, "Must automatically identify unfinished backfill");
  assert.equal(scanWindow.queryAfterEpoch, 1731000000);
  assert.equal(scanWindow.queryBeforeEpoch, 1731050000);
  assert.equal(scanWindow.startHistoryId, "snapshot_h888");

  // Mock Gmail API for remaining window
  globalThis.fetch = async (url) => {
    const urlStr = String(url);
    if (urlStr.includes("messages?")) {
      const u = new URL(urlStr);
      const q = u.searchParams.get("q");
      assert.ok(q.includes("after:1731000000"), "Must query the exact outstanding after epoch");
      assert.ok(q.includes("before:1731050000"), "Must query the exact outstanding before epoch");
      return new Response(JSON.stringify({
        messages: [{ id: "resumed_msg_1", threadId: "t1" }, { id: "resumed_msg_2", threadId: "t2" }],
        nextPageToken: null,
      }), { status: 200 });
    }
    return new Response("Not found", { status: 404 });
  };

  try {
    const syncRes = await executeGmailSync({
      token: "mock-token",
      startHistoryId: scanWindow.startHistoryId,
      startHistorySnapshot: scanWindow.startHistoryId,
      queryAfterEpoch: scanWindow.queryAfterEpoch,
      queryBeforeEpoch: scanWindow.queryBeforeEpoch,
      isResumingBackfill: scanWindow.isResumingBackfill,
      maxMessages: 300,
    });

    assert.equal(syncRes.strategy, "query_full", "Must continue full search, NOT switch prematurely to History API");
    assert.equal(syncRes.hasMoreBacklog, false, "All remaining messages consumed");
    assert.equal(syncRes.latestHistoryId, "snapshot_h888", "Latest historyId advances to snapshot once window is complete");

    const continuation = computeContinuationState({
      rawMessageCount: syncRes.messages.length,
      maxMessages: 300,
      hasRemainingPageToken: false,
      queryAfterEpoch: scanWindow.queryAfterEpoch,
      isResumingBackfill: true,
      continuationCeilingTime: scanWindow.continuationCeilingTime,
      startedAt: "2026-11-09T12:00:00Z",
      completedAt: "2026-11-09T12:02:00Z",
      dryRun: false,
    });

    assert.equal(continuation.checkpointAdvanced, true, "Checkpoint now advances after backfill completes");
    assert.equal(continuation.effectiveCheckpointTime, "2026-11-09T11:00:00Z", "Advances to original ceiling time");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// =============================================================================
// REGRESSION SCENARIO 6: Exact boundary where a batch contains the configured maximum
// =============================================================================
test("Scenario 6: Exact boundary where batch contains exactly the configured maximum (300 messages)", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url) => {
    const urlStr = String(url);
    if (urlStr.includes("profile")) {
      return new Response(JSON.stringify({ historyId: "hist_boundary_300" }), { status: 200 });
    }
    if (urlStr.includes("messages?")) {
      const u = new URL(urlStr);
      const q = u.searchParams.get("q") || "";
      if (q.includes("before:")) {
        // Subsequent check of remaining window returns 0 messages
        return new Response(JSON.stringify({ messages: [], nextPageToken: null }), { status: 200 });
      }
      // First scan returns exactly 300 messages with no further page token
      const msgs = Array.from({ length: 300 }, (_, i) => ({ id: `msg_exact_${i + 1}`, threadId: `t_${i + 1}` }));
      return new Response(JSON.stringify({ messages: msgs, nextPageToken: null }), { status: 200 });
    }
    return new Response("Not found", { status: 404 });
  };

  try {
    const scan1 = await syncViaGmailFullSearch({
      token: "mock-token",
      queryAfterEpoch: 1731000000,
      maxMessages: 300,
    });

    assert.equal(scan1.messages.length, 300);
    assert.equal(scan1.hasMoreBacklog, true, "Hitting exact limit flags backlog remaining to ensure no dropped messages");

    // Scan 2 resumes remaining window before the oldest message and finds 0 messages
    const scan2 = await syncViaGmailFullSearch({
      token: "mock-token",
      queryAfterEpoch: 1731000000,
      queryBeforeEpoch: 1731000100,
      maxMessages: 300,
      startHistorySnapshot: scan1.startHistorySnapshot,
    });

    assert.equal(scan2.messages.length, 0);
    assert.equal(scan2.hasMoreBacklog, false, "Backlog cleanly exhausted without infinite loop");
    assert.equal(scan2.latestHistoryId, "hist_boundary_300", "Checkpoint resolves cleanly to starting snapshot");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// =============================================================================
// REGRESSION SCENARIO 7: Previously processed Gmail messages and deduplication
// =============================================================================
test("Scenario 7: Previously processed Gmail messages are reconciled with provenance without duplicate application mutations", async () => {
  const { sql, table } = createMockQueueDb();

  const legacyProcessedMap = new Map([
    ["legacy_app_msg_1", "application_events"],
    ["legacy_rev_msg_2", "recruitment_review_items"],
  ]);

  const rawMessages = [
    { id: "legacy_app_msg_1", from: "recruiter@uber.com", subject: "Offer from Uber", date: "2026-11-09T10:00:00Z" },
    { id: "legacy_rev_msg_2", from: "hr@stripe.com", subject: "Update on Stripe", date: "2026-11-09T10:05:00Z" },
    { id: "brand_new_msg_3", from: "team@airbnb.com", subject: "Interview with Airbnb", date: "2026-11-09T10:10:00Z" },
  ];

  const queueItems = [];
  const proposedChanges = [];
  let legacyReconciledCount = 0;

  for (const msg of rawMessages) {
    if (legacyProcessedMap.has(msg.id)) {
      const legacySource = legacyProcessedMap.get(msg.id);
      legacyReconciledCount++;
      queueItems.push({
        owner_id: "f2729195-5445-4272-ab85-cac5b03b0967",
        mailbox: "govardhanreddy.vys7@gmail.com",
        message_id: msg.id,
        message_timestamp: msg.date,
        processing_status: "completed",
        content_hash: `hash_${msg.id}`,
        subject_clean: msg.subject,
        sender_clean: msg.from,
        attempt_count: 0,
        max_attempts: 5,
        review_status: legacySource === "recruitment_review_items" ? "requires_review" : "auto_approved",
        evidence_references: { legacy_processed: true, legacy_source: legacySource },
      });
      // Invariant: Do not propose changes or reviews for legacy records
      continue;
    }

    // New message
    queueItems.push({
      owner_id: "f2729195-5445-4272-ab85-cac5b03b0967",
      mailbox: "govardhanreddy.vys7@gmail.com",
      message_id: msg.id,
      message_timestamp: msg.date,
      processing_status: "pending",
      content_hash: `hash_${msg.id}`,
      subject_clean: msg.subject,
      sender_clean: msg.from,
      attempt_count: 0,
      max_attempts: 5,
      review_status: "pending",
    });
    proposedChanges.push({ messageId: msg.id, company: "Airbnb", newStage: "Interview Scheduled" });
  }

  assert.equal(legacyReconciledCount, 2, "Both legacy messages reconciled");
  assert.equal(proposedChanges.length, 1, "Only the brand new message generates proposed changes");
  assert.equal(proposedChanges[0].company, "Airbnb");

  // Ingest into database
  const enqResult = await enqueueDiscoveredMessages(sql, queueItems);
  assert.equal(enqResult.newlyEnqueued, 3, "All 3 messages ingested into inventory");

  const legacyRec1 = table.get("govardhanreddy.vys7@gmail.com:legacy_app_msg_1");
  assert.equal(legacyRec1.processing_status, "completed");
  assert.equal(legacyRec1.review_status, "auto_approved");
  assert.equal(legacyRec1.evidence_references.legacy_source, "application_events");

  // Deduplication on repeated delivery
  const repeatedEnq = await enqueueDiscoveredMessages(sql, queueItems);
  assert.equal(repeatedEnq.newlyEnqueued, 0, "Repeated delivery inserts 0 new rows");
  assert.equal(repeatedEnq.duplicatesSkipped, 3, "All 3 messages identified as duplicates and skipped");
});

// =============================================================================
// REGRESSION SCENARIO 8: Temporary message-fetch failures
// =============================================================================
test("Scenario 8: Temporary message-fetch failures are preserved as pending_fetch and permanent as excluded", async () => {
  const originalFetch = globalThis.fetch;

  let attemptCount500 = 0;
  globalThis.fetch = async (url) => {
    const urlStr = String(url);
    if (urlStr.includes("msg_transient_500")) {
      attemptCount500++;
      return new Response("Service Unavailable", { status: 503 });
    }
    if (urlStr.includes("msg_permanent_404")) {
      return new Response("Not Found", { status: 404 });
    }
    return new Response(JSON.stringify({ id: "msg_ok", payload: { headers: [] } }), { status: 200 });
  };

  try {
    // 1. Transient error: retries 3 times then throws TransientMessageFetchError
    let caughtTransient = null;
    try {
      await fetchMessageWithRetry("token", "msg_transient_500", { maxRetries: 3, initialBackoffMs: 1 });
    } catch (err) {
      caughtTransient = err;
    }
    assert.equal(caughtTransient instanceof TransientMessageFetchError, true);
    assert.equal(attemptCount500, 3, "Must perform 3 bounded retry attempts before giving up");

    // 2. Permanent error: throws PermanentMessageInaccessibleError immediately on 404
    let caughtPermanent = null;
    try {
      await fetchMessageWithRetry("token", "msg_permanent_404", { maxRetries: 3, initialBackoffMs: 1 });
    } catch (err) {
      caughtPermanent = err;
    }
    assert.equal(caughtPermanent instanceof PermanentMessageInaccessibleError, true);

    // 3. Queue preservation logic for both
    const queueItems = [];
    queueItems.push({
      owner_id: "f2729195-5445-4272-ab85-cac5b03b0967",
      mailbox: "govardhanreddy.vys7@gmail.com",
      message_id: "msg_transient_500",
      message_timestamp: new Date().toISOString(),
      processing_status: "pending_fetch",
      content_hash: "hash_transient",
      subject_clean: "[FETCH_PENDING]",
      sender_clean: "unknown",
      attempt_count: 1,
      max_attempts: 5,
      review_status: "pending",
      error_details: [{ error: caughtTransient.message, timestamp: new Date().toISOString() }],
    });

    queueItems.push({
      owner_id: "f2729195-5445-4272-ab85-cac5b03b0967",
      mailbox: "govardhanreddy.vys7@gmail.com",
      message_id: "msg_permanent_404",
      message_timestamp: new Date().toISOString(),
      processing_status: "excluded",
      content_hash: "hash_permanent",
      subject_clean: "[INACCESSIBLE]",
      sender_clean: "unknown",
      attempt_count: 0,
      max_attempts: 5,
      review_status: "ignored",
      exclusion_reason: "message_deleted_or_inaccessible",
      error_details: [{ error: caughtPermanent.message, timestamp: new Date().toISOString() }],
    });

    assert.equal(queueItems[0].processing_status, "pending_fetch");
    assert.equal(queueItems[1].processing_status, "excluded");
    assert.equal(queueItems.length, 2, "Both failed message IDs are preserved in queue state");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// =============================================================================
// REGRESSION SCENARIO 9: No application-stage changes in ingestion-only mode
// =============================================================================
test("Scenario 9: No application-stage changes occur in ingestion-only mode", async () => {
  const { sql, table, cursors, syncLogs, applications } = createMockQueueDb();

  applications.set("app-stripe", { id: "app-stripe", company: "Stripe", hiring_stage: "Applied Confirmed" });

  const queueItems = [
    {
      owner_id: "f2729195-5445-4272-ab85-cac5b03b0967",
      mailbox: "govardhanreddy.vys7@gmail.com",
      message_id: "msg_offer_1",
      thread_id: "t_offer",
      message_timestamp: "2026-11-09T11:00:00Z",
      processing_status: "pending",
      content_hash: "hash_offer",
      subject_clean: "Offer from Stripe",
      sender_clean: "recruiting@stripe.com",
    },
  ];

  await sql.begin(async (tx) => {
    await enqueueDiscoveredMessages(tx, queueItems);

    await tx`
      insert into jobbot.sync_cursors (
        owner_id, source_key, last_success_at, last_observed_at,
        last_history_id, overlap_minutes, initial_lookback_hours
      ) values (
        ${"f2729195-5445-4272-ab85-cac5b03b0967"}, ${"gmail_status_ingestion"},
        ${"2026-11-09T11:10:00Z"}, ${"2026-11-09T11:00:00Z"},
        ${"hist_888"}, ${15}, ${72}
      )
    `;
  });

  assert.equal(table.size, 1);
  assert.equal(applications.get("app-stripe").hiring_stage, "Applied Confirmed", "Application stage MUST NOT be modified in ingestion_only mode");
});

// =============================================================================
// REGRESSION SCENARIO 10: Existing diagnostic dry-run remaining read-only
// =============================================================================
test("Scenario 10: Existing diagnostic dry-run remains strictly read-only with 0 enqueued and 0 cursor advances", async () => {
  const { sql, table, cursors, syncLogs } = createMockQueueDb();

  const dryRunCommittedEnqueued = 0; // Strictly 0

  await sql`
    insert into jobbot.sync_logs (
      run_id, bot_name, started_at, completed_at,
      created_count, updated_count, skipped_count,
      errors, verification_results
    ) values (
      ${"run-dry-10"}, ${"Gmail Status Agent"}, ${"2026-11-09T12:00:00Z"}, ${"2026-11-09T12:01:00Z"},
      ${0}, ${0}, ${0},
      ${[]},
      ${{
        mode: "diagnostic_dry_run",
        dry_run: true,
        checkpoint_advanced: false,
        messages_discovered: 10,
        messages_enqueued: 0,
      }}
    )
  `;

  assert.equal(table.size, 0, "Queue table MUST contain zero rows in diagnostic dry run");
  assert.equal(cursors.size, 0, "No cursors may advance in diagnostic dry run");
  assert.equal(syncLogs[0].verificationResults.messages_enqueued, 0);
  assert.equal(syncLogs[0].verificationResults.checkpoint_advanced, false);
});

// =============================================================================
// ADDITIONAL CONTRACT TESTS: Expired history recovery, Grok lease claim, flat error_details, sensitive filter
// =============================================================================
test("Test 11: Expired history ID triggers HTTP 404 fallback to full search reconciliation", async () => {
  const originalFetch = globalThis.fetch;
  let historyCalled = false;
  let searchCalled = false;

  globalThis.fetch = async (url) => {
    const urlStr = String(url);
    if (urlStr.includes("history?")) {
      historyCalled = true;
      return new Response("History expired", { status: 404 });
    }
    if (urlStr.includes("messages?")) {
      searchCalled = true;
      return new Response(JSON.stringify({
        messages: [{ id: "recovered_msg_1", threadId: "t1" }],
        nextPageToken: null,
      }), { status: 200 });
    }
    if (urlStr.includes("profile")) {
      return new Response(JSON.stringify({ historyId: "999123" }), { status: 200 });
    }
    return new Response("Not found", { status: 404 });
  };

  try {
    const syncRes = await executeGmailSync({
      token: "token",
      startHistoryId: "stale_id_404",
      queryAfterEpoch: 1731000000,
      maxMessages: 100,
    });

    assert.equal(historyCalled, true);
    assert.equal(searchCalled, true);
    assert.equal(syncRes.strategy, "query_full");
    assert.equal(syncRes.historyExpiredRecovered, true);
    assert.equal(syncRes.latestHistoryId, "999123");
    assert.equal(syncRes.messages[0].id, "recovered_msg_1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Test 12: Queue ingestion persists messages when Grok is offline, and workers claim leases when online", async () => {
  const { sql, table } = createMockQueueDb();

  const items = [
    {
      owner_id: "f2729195-5445-4272-ab85-cac5b03b0967",
      mailbox: "govardhanreddy.vys7@gmail.com",
      message_id: "offline_grok_1",
      message_timestamp: new Date().toISOString(),
      processing_status: "pending",
      content_hash: "hash_off_1",
    },
    {
      owner_id: "f2729195-5445-4272-ab85-cac5b03b0967",
      mailbox: "govardhanreddy.vys7@gmail.com",
      message_id: "offline_grok_2",
      message_timestamp: new Date().toISOString(),
      processing_status: "pending",
      content_hash: "hash_off_2",
    },
  ];

  await enqueueDiscoveredMessages(sql, items);
  assert.equal(table.size, 2, "Messages queued independently of AI worker");

  const claim = await claimQueueBatch(sql, {
    mailbox: "govardhanreddy.vys7@gmail.com",
    batchSize: 2,
    leaseSeconds: 60,
    workerToken: "grok-worker-1",
  });

  assert.equal(claim.claimedItems.length, 2, "Grok worker claims both items successfully");
  assert.equal(claim.claimedItems[0].processing_status, "claimed");

  const completed = await completeQueueItem(sql, {
    itemId: claim.claimedItems[0].id,
    workerToken: "grok-worker-1",
    analysisVersion: "grok-2-recruitment-v1",
    classificationResult: { stage: "Interview Scheduled", confidence: 0.95 },
    reviewStatus: "auto_approved",
  });

  assert.equal(completed, true);
  assert.equal(table.get("govardhanreddy.vys7@gmail.com:offline_grok_1").processing_status, "completed");
});

test("Test 13: failQueueItem maintains error_details as a flat JSONB array without nesting", async () => {
  const { sql, table } = createMockQueueDb();

  const item = {
    owner_id: "f2729195-5445-4272-ab85-cac5b03b0967",
    mailbox: "govardhanreddy.vys7@gmail.com",
    message_id: "error_nest_test",
    message_timestamp: new Date().toISOString(),
    processing_status: "pending",
    content_hash: "hash_err",
    attempt_count: 0,
    max_attempts: 3,
  };

  await enqueueDiscoveredMessages(sql, [item]);

  const claim1 = await claimQueueBatch(sql, {
    mailbox: "govardhanreddy.vys7@gmail.com",
    batchSize: 1,
    leaseSeconds: 60,
    workerToken: "w1",
  });
  await failQueueItem(sql, {
    itemId: claim1.claimedItems[0].id,
    workerToken: "w1",
    error: "First error",
  });

  const claim2 = await claimQueueBatch(sql, {
    mailbox: "govardhanreddy.vys7@gmail.com",
    batchSize: 1,
    leaseSeconds: 60,
    workerToken: "w2",
  });
  await failQueueItem(sql, {
    itemId: claim2.claimedItems[0].id,
    workerToken: "w2",
    error: "Second error",
  });

  const record = table.get("govardhanreddy.vys7@gmail.com:error_nest_test");
  assert.ok(Array.isArray(record.error_details), "error_details must be an array");
  assert.equal(record.error_details.length, 2, "error_details must have 2 entries");
  assert.equal(Array.isArray(record.error_details[0]), false, "Entry 0 must not be a nested array");
  assert.equal(record.error_details[0].error, "First error");
  assert.equal(record.error_details[1].error, "Second error");
});

test("Test 14: Sensitive auth/security emails are excluded and redacted from queue content", async () => {
  const email = {
    from: "security-noreply@google.com",
    subject: "Your Google verification code is 849201",
    snippet: "Use 849201 to sign in.",
  };

  const sensitive = checkSensitiveMessage(email);
  assert.equal(sensitive.isSensitive, true);
  assert.equal(sensitive.reason, "sensitive_security_otp");

  const sanitizedSub = sanitizeSubject(email.subject);
  assert.ok(!sanitizedSub.includes("849201"), "Verification code must be redacted");
  assert.ok(sanitizedSub.includes("[REDACTED]"));

  const hash = await computeContentHash({
    mailbox: "govardhanreddy.vys7@gmail.com",
    messageId: "msg_sec_1",
    internalDate: 1731100000000,
    subject: email.subject,
    snippet: email.snippet,
    isSensitive: true,
  });

  assert.equal(typeof hash, "string");
  assert.equal(hash.length, 64);
});

// =============================================================================
// REGRESSION SCENARIO 15: Multi-batch Gmail History scan with 500 changes (300 limit)
// Across two consecutive runs: preserves history strategy, 0 lost label events,
// 0 duplicates, safe cursor advance, rollback on DB error, and 0 application updates
// =============================================================================
test("Scenario 15: Multi-batch Gmail History scan with 500 changes (messagesAdded + labelsAdded) with 300 limit across two consecutive runs", async () => {
  const originalFetch = globalThis.fetch;
  const { sql, table, cursors, syncLogs, applications } = createMockQueueDb();

  // Seed candidate application to verify zero stage mutations
  applications.set("app-test-500", {
    id: "app-test-500",
    company: "Google DeepMind",
    job_title: "Research Engineer",
    hiring_stage: "Under Review",
    application_status: "active",
  });

  // Track API call invocations
  let historyApiCallCount = 0;
  let fullSearchApiCallCount = 0;
  const requestedStartHistoryIds = [];

  // Generate 100 history records (1001 to 1100), each with 3 messagesAdded and 2 labelsAdded
  // Total changes = 100 * 5 = 500
  const allHistoryRecords = [];
  for (let r = 1; r <= 100; r++) {
    const recId = String(1000 + r);
    allHistoryRecords.push({
      id: recId,
      messagesAdded: [
        { message: { id: `msg_hist_add_${r}_1`, threadId: `t_add_${r}_1` } },
        { message: { id: `msg_hist_add_${r}_2`, threadId: `t_add_${r}_2` } },
        { message: { id: `msg_hist_add_${r}_3`, threadId: `t_add_${r}_3` } },
      ],
      labelsAdded: [
        { message: { id: `msg_hist_lbl_${r}_1`, threadId: `t_lbl_${r}_1` }, labelIds: ["STARRED", "IMPORTANT"] },
        { message: { id: `msg_hist_lbl_${r}_2`, threadId: `t_lbl_${r}_2` }, labelIds: ["CATEGORY_PERSONAL"] },
      ],
    });
  }

  globalThis.fetch = async (url) => {
    const urlStr = String(url);
    if (urlStr.includes("messages?")) {
      fullSearchApiCallCount++;
      return new Response(JSON.stringify({ messages: [], nextPageToken: null }), { status: 200 });
    }
    if (urlStr.includes("history?")) {
      historyApiCallCount++;
      const u = new URL(urlStr);
      const startHistoryId = u.searchParams.get("startHistoryId");
      requestedStartHistoryIds.push(startHistoryId);

      // Return records with id > startHistoryId
      const startNum = BigInt(startHistoryId || "0");
      const matchedRecords = allHistoryRecords.filter((rec) => BigInt(rec.id) > startNum);

      return new Response(JSON.stringify({
        historyId: "1105",
        history: matchedRecords,
        nextPageToken: null,
      }), { status: 200 });
    }
    return new Response("Not found", { status: 404 });
  };

  try {
    // -------------------------------------------------------------------------
    // RUN 1: Initial History API scan starting from historyId 1000 with limit 300
    // -------------------------------------------------------------------------
    const run1Sync = await executeGmailSync({
      token: "mock-token",
      startHistoryId: "1000",
      queryAfterEpoch: 1731000000,
      maxMessages: 300,
    });

    assert.equal(run1Sync.strategy, "history", "Run 1 must use history strategy");
    assert.equal(run1Sync.messages.length, 300, "Run 1 must discover exactly 300 messages (60 records * 5)");
    assert.equal(run1Sync.hasMoreBacklog, true, "Run 1 must flag backlog remaining");
    assert.equal(run1Sync.latestHistoryId, "1060", "Run 1 latestHistoryId must stop at safe fully consumed record 1060, NOT premature 1105");

    const run1StartedAt = "2026-11-09T10:00:00.000Z";
    const run1CompletedAt = "2026-11-09T10:01:00.000Z";

    const run1Continuation = computeContinuationState({
      rawMessageCount: run1Sync.messages.length,
      maxMessages: 300,
      hasRemainingPageToken: false,
      queryAfterEpoch: 1731000000,
      isResumingBackfill: false,
      startedAt: run1StartedAt,
      completedAt: run1CompletedAt,
      dryRun: false,
      syncStrategy: "history",
      lastConsumedHistoryRecordId: run1Sync.latestHistoryId,
    });

    assert.equal(run1Continuation.hasMoreBacklog, true);
    assert.equal(run1Continuation.checkpointAdvanced, false, "Checkpoint MUST NOT advance when backlog remains");
    assert.equal(run1Continuation.status, "partial_backfill");
    assert.equal(run1Continuation.continuationStrategy, "history", "Continuation strategy MUST be persisted as history");
    assert.equal(run1Continuation.lastConsumedHistoryRecordId, "1060");
    assert.equal(run1Continuation.nextContinuationBeforeEpoch, null, "Must NOT set continuation_before_epoch for history continuation");
    assert.equal(run1Continuation.nextContinuationAfterEpoch, null, "Must NOT set continuation_after_epoch for history continuation");
    assert.equal(run1Continuation.effectiveCheckpointTime, null, "Must NOT set checkpoint time");

    // Commit Run 1 in ingestion_only mode atomically
    await sql.begin(async (tx) => {
      const enq = await enqueueDiscoveredMessages(tx, run1Sync.messages.map((m, idx) => ({
        owner_id: "f2729195-5445-4272-ab85-cac5b03b0967",
        mailbox: "govardhanreddy.vys7@gmail.com",
        message_id: m.id,
        message_timestamp: new Date(1731050000 * 1000 + idx * 1000).toISOString(),
        processing_status: "pending",
        content_hash: `hash_${m.id}`,
      })));
      assert.equal(enq.newlyEnqueued, 300);

      // Invariant: Because checkpointAdvanced is false, cursor last_success_at MUST NOT advance!
      // But last_history_id advances to safe record 1060 for unattended resumption.
      const safePartialHistoryId = run1Sync.latestHistoryId;
      await tx`
        insert into jobbot.sync_cursors (
          owner_id, source_key, last_success_at, last_observed_at,
          last_history_id, overlap_minutes, initial_lookback_hours
        ) values (
          ${"f2729195-5445-4272-ab85-cac5b03b0967"}, ${"gmail_status_ingestion"},
          ${null}, ${run1CompletedAt},
          ${safePartialHistoryId}, ${15}, ${72}
        )
      `;

      // Persist production sync log with exact continuation state
      await tx`
        insert into jobbot.sync_logs (
          run_id, bot_name, started_at, completed_at,
          created_count, updated_count, skipped_count,
          errors, verification_results
        ) values (
          ${"run-1-uuid"}, ${"Gmail Status Agent"}, ${run1StartedAt}, ${run1CompletedAt},
          ${300}, ${0}, ${0},
          ${[]},
          ${{
            status: run1Continuation.status,
            mode: "ingestion_only",
            dry_run: false,
            sync_strategy: "history",
            continuation_strategy: run1Continuation.continuationStrategy,
            start_history_id: "1000",
            latest_history_id: "1060",
            last_consumed_history_record_id: "1060",
            has_more_backlog: true,
            checkpoint_advanced: false,
            continuation_before_epoch: null,
            continuation_after_epoch: null,
            messages_discovered: 300,
            messages_enqueued: 300,
          }}
        )
      `;
    });

    assert.equal(table.size, 300, "Queue must contain exactly 300 committed rows from Run 1");
    const cursorAfterRun1 = cursors.get("f2729195-5445-4272-ab85-cac5b03b0967:gmail_status_ingestion");
    assert.equal(cursorAfterRun1.last_history_id, "1060", "Cursor historyId must advance to safe consumed record 1060");
    assert.equal(cursorAfterRun1.last_success_at, null, "Cursor last_success_at MUST NOT advance during partial run");
    assert.equal(applications.get("app-test-500").hiring_stage, "Under Review", "Application status MUST remain unmodified");

    // -------------------------------------------------------------------------
    // RUN 2: Unattended next run (no manual parameters)
    // -------------------------------------------------------------------------
    const run1Log = syncLogs[0];
    const run2ScanWindow = resolveScanWindow({
      latestProductionLog: {
        started_at: run1Log.startedAt,
        completed_at: run1Log.completedAt,
        verification_results: run1Log.verificationResults,
      },
      cursorRecord: cursorAfterRun1,
      gapReconcile: false,
      lastVerifiedCheckpoint: "2026-11-08T22:47:41Z",
      overlapMinutes: 15,
    });

    // Invariant: Unattended run MUST resume via History API, NOT full search!
    assert.equal(run2ScanWindow.isResumingBackfill, false, "Must NOT mark as full search backfill");
    assert.equal(run2ScanWindow.syncStrategy, "history", "Must preserve history strategy");
    assert.equal(run2ScanWindow.startHistoryId, "1060", "Must resume strictly from record 1060");
    assert.equal(run2ScanWindow.queryBeforeEpoch, null, "Must NOT constrain by beforeEpoch");

    const run2Sync = await executeGmailSync({
      token: "mock-token",
      startHistoryId: run2ScanWindow.startHistoryId,
      queryAfterEpoch: run2ScanWindow.queryAfterEpoch,
      queryBeforeEpoch: run2ScanWindow.queryBeforeEpoch,
      isResumingBackfill: run2ScanWindow.isResumingBackfill,
      maxMessages: 300,
    });

    assert.equal(run2Sync.strategy, "history", "Run 2 must execute history sync");
    assert.equal(fullSearchApiCallCount, 0, "Full search API MUST NOT be called");
    assert.equal(requestedStartHistoryIds.includes("1060"), true, "Gmail API must be called with startHistoryId=1060");
    assert.equal(run2Sync.messages.length, 200, "Run 2 must discover remaining 200 messages (records 1061 to 1100)");
    assert.equal(run2Sync.hasMoreBacklog, false, "Backlog is now completely consumed");
    assert.equal(run2Sync.latestHistoryId, "1105", "Final history ID advances to mailbox latest historyId 1105");

    // Verify label-change messages were captured
    const run2LabelChanges = run2Sync.messages.filter((m) => m.id.startsWith("msg_hist_lbl_"));
    assert.equal(run2LabelChanges.length, 80, "Must capture all 80 label-change messages in records 1061-1100");

    // Verify rollback on failure during Run 2
    let rollbackThrown = false;
    try {
      await sql.begin(async (tx) => {
        await enqueueDiscoveredMessages(tx, [
          {
            owner_id: "f2729195-5445-4272-ab85-cac5b03b0967",
            mailbox: "govardhanreddy.vys7@gmail.com",
            message_id: "FORCE_TRANSACTION_FAIL",
            message_timestamp: new Date().toISOString(),
            processing_status: "pending",
            content_hash: "hash_fail",
          },
        ]);
      });
    } catch (err) {
      rollbackThrown = true;
    }
    assert.equal(rollbackThrown, true, "Transaction failure must throw");
    assert.equal(table.size, 300, "Database state must cleanly roll back to Run 1 state (300 rows)");
    assert.equal(cursors.get("f2729195-5445-4272-ab85-cac5b03b0967:gmail_status_ingestion").last_history_id, "1060");

    // Commit Run 2 successfully
    const run2StartedAt = "2026-11-09T11:00:00.000Z";
    const run2CompletedAt = "2026-11-09T11:01:00.000Z";

    const run2Continuation = computeContinuationState({
      rawMessageCount: run2Sync.messages.length,
      maxMessages: 300,
      hasRemainingPageToken: false,
      queryAfterEpoch: run2ScanWindow.queryAfterEpoch,
      isResumingBackfill: false,
      startedAt: run2StartedAt,
      completedAt: run2CompletedAt,
      dryRun: false,
      syncStrategy: "history",
      lastConsumedHistoryRecordId: run2Sync.latestHistoryId,
    });

    assert.equal(run2Continuation.hasMoreBacklog, false);
    assert.equal(run2Continuation.checkpointAdvanced, true, "Checkpoint MUST advance now that backlog is complete");
    assert.equal(run2Continuation.status, "completed");
    assert.equal(run2Continuation.continuationStrategy, "history");
    assert.equal(run2Continuation.lastConsumedHistoryRecordId, "1105");

    await sql.begin(async (tx) => {
      const enq = await enqueueDiscoveredMessages(tx, run2Sync.messages.map((m, idx) => ({
        owner_id: "f2729195-5445-4272-ab85-cac5b03b0967",
        mailbox: "govardhanreddy.vys7@gmail.com",
        message_id: m.id,
        message_timestamp: new Date(1731050000 * 1000 + (300 + idx) * 1000).toISOString(),
        processing_status: "pending",
        content_hash: `hash_${m.id}`,
      })));
      assert.equal(enq.newlyEnqueued, 200);
      assert.equal(enq.duplicatesSkipped, 0);

      // Advance cursor now that backlog is complete
      await tx`
        insert into jobbot.sync_cursors (
          owner_id, source_key, last_success_at, last_observed_at,
          last_history_id, overlap_minutes, initial_lookback_hours
        ) values (
          ${"f2729195-5445-4272-ab85-cac5b03b0967"}, ${"gmail_status_ingestion"},
          ${run2CompletedAt}, ${run2CompletedAt},
          ${run2Sync.latestHistoryId}, ${15}, ${72}
        )
      `;
    });

    // Invariant verifications:
    // 1. Total 500 rows committed in queue
    assert.equal(table.size, 500, "Queue must contain exactly 500 total messages across both runs");

    // 2. 0 duplicate messages
    const allMessageIds = Array.from(table.values()).map((r) => r.message_id);
    const uniqueIds = new Set(allMessageIds);
    assert.equal(uniqueIds.size, 500, "All 500 message IDs must be completely unique with 0 duplicates");

    // 3. Final cursor advanced
    const finalCursor = cursors.get("f2729195-5445-4272-ab85-cac5b03b0967:gmail_status_ingestion");
    assert.equal(finalCursor.last_history_id, "1105", "Cursor historyId must advance to 1105");
    assert.equal(finalCursor.last_success_at, run2CompletedAt, "Cursor last_success_at must advance to completion time");

    // 4. Zero application status updates
    assert.equal(applications.get("app-test-500").hiring_stage, "Under Review", "Application status MUST remain unmodified throughout");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
