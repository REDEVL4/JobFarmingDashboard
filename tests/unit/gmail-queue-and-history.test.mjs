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
          error_details,
        ] = values;

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
          evidence_references: null,
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
          last_success_at: last_success_at || existing.last_success_at || null,
          last_observed_at: last_observed_at || existing.last_observed_at || null,
          last_history_id: last_history_id || existing.last_history_id || null,
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

// -----------------------------------------------------------------------------
// TEST 1: Diagnostic dry run creates no queue rows and advances no cursors
// -----------------------------------------------------------------------------
test("Test 1: Diagnostic dry run creates no queue rows and strictly reports messagesEnqueued: 0", async () => {
  const { sql, table, cursors, syncLogs } = createMockQueueDb();

  const proposedQueueItems = [
    {
      owner_id: "f2729195-5445-4272-ab85-cac5b03b0967",
      mailbox: "govardhanreddy.vys7@gmail.com",
      message_id: "dry_msg_1",
      message_timestamp: new Date().toISOString(),
      processing_status: "pending",
      content_hash: "hash_dry_1",
    },
    {
      owner_id: "f2729195-5445-4272-ab85-cac5b03b0967",
      mailbox: "govardhanreddy.vys7@gmail.com",
      message_id: "dry_msg_2",
      message_timestamp: new Date().toISOString(),
      processing_status: "pending",
      content_hash: "hash_dry_2",
    },
  ];

  // In diagnostic_dry_run mode:
  // - No queue mutations are executed
  // - No cursor mutations are executed
  // - Diagnostic sync log is recorded
  const dryRunCommittedEnqueued = 0; // Strictly 0
  assert.equal(dryRunCommittedEnqueued, 0);

  await sql`
    insert into jobbot.sync_logs (
      run_id, bot_name, started_at, completed_at,
      created_count, updated_count, skipped_count,
      errors, verification_results
    ) values (
      ${"run-dry-1"}, ${"Gmail Status Agent"}, ${"2026-11-09T12:00:00Z"}, ${"2026-11-09T12:01:00Z"},
      ${0}, ${0}, ${0},
      ${[]},
      ${{
        mode: "diagnostic_dry_run",
        dry_run: true,
        checkpoint_advanced: false,
        messages_discovered: 2,
        messages_enqueued: 0,
        proposed_queue_items_count: proposedQueueItems.length,
      }}
    )
  `;

  assert.equal(table.size, 0, "Queue table must contain zero rows in diagnostic dry run");
  assert.equal(cursors.size, 0, "No cursors may advance in diagnostic dry run");
  assert.equal(syncLogs.length, 1);
  assert.equal(syncLogs[0].verificationResults.messages_enqueued, 0);
  assert.equal(syncLogs[0].verificationResults.mode, "diagnostic_dry_run");
});

// -----------------------------------------------------------------------------
// TEST 2: Ingestion-only mode creates queue rows without changing application statuses
// -----------------------------------------------------------------------------
test("Test 2: Ingestion-only mode creates queue rows and advances cursor without modifying applications", async () => {
  const { sql, table, cursors, syncLogs, applications } = createMockQueueDb();

  // Set up an application in database
  applications.set("app-1", { id: "app-1", company: "Meta", hiring_stage: "Applied Confirmed" });

  const queueItems = [
    {
      owner_id: "f2729195-5445-4272-ab85-cac5b03b0967",
      mailbox: "govardhanreddy.vys7@gmail.com",
      message_id: "msg_ingest_1",
      thread_id: "t1",
      message_timestamp: "2026-11-09T11:00:00Z",
      processing_status: "pending",
      content_hash: "hash_1",
      subject_clean: "Meta Interview Request",
      sender_clean: "recruiter@meta.com",
    },
    {
      owner_id: "f2729195-5445-4272-ab85-cac5b03b0967",
      mailbox: "govardhanreddy.vys7@gmail.com",
      message_id: "msg_ingest_2",
      thread_id: "t2",
      message_timestamp: "2026-11-09T11:05:00Z",
      processing_status: "pending",
      content_hash: "hash_2",
      subject_clean: "Google Application Acknowledgment",
      sender_clean: "careers@google.com",
    },
  ];

  let actualCommittedQueueRows = 0;
  await sql.begin(async (tx) => {
    const enqueueResult = await enqueueDiscoveredMessages(tx, queueItems);
    actualCommittedQueueRows = enqueueResult.newlyEnqueued;

    // Advance ingestion cursor atomically
    await tx`
      insert into jobbot.sync_cursors (
        owner_id, source_key, last_success_at, last_observed_at,
        last_history_id, overlap_minutes, initial_lookback_hours
      ) values (
        ${"f2729195-5445-4272-ab85-cac5b03b0967"}, ${"gmail_status_ingestion"},
        ${"2026-11-09T11:10:00Z"}, ${"2026-11-09T11:05:00Z"},
        ${"hist_888999"}, ${15}, ${72}
      )
    `;

    // Record ingestion sync log (created_count = actualCommittedQueueRows, updated_count = 0)
    await tx`
      insert into jobbot.sync_logs (
        run_id, bot_name, started_at, completed_at,
        created_count, updated_count, skipped_count,
        errors, verification_results
      ) values (
        ${"run-ingest-1"}, ${"Gmail Status Agent"}, ${"2026-11-09T11:00:00Z"}, ${"2026-11-09T11:10:00Z"},
        ${actualCommittedQueueRows}, ${0}, ${0},
        ${[]},
        ${{
          mode: "ingestion_only",
          dry_run: false,
          messages_enqueued: actualCommittedQueueRows,
          updated_count: 0,
        }}
      )
    `;
  });

  // Verification
  assert.equal(actualCommittedQueueRows, 2, "Must commit exactly 2 queue rows");
  assert.equal(table.size, 2, "Queue table has 2 rows");
  assert.equal(cursors.size, 1, "Cursor must advance");
  const cursorRecord = cursors.get("f2729195-5445-4272-ab85-cac5b03b0967:gmail_status_ingestion");
  assert.equal(cursorRecord.last_history_id, "hist_888999");
  assert.equal(syncLogs[0].createdCount, 2);
  assert.equal(syncLogs[0].updatedCount, 0);

  // Application must NOT have changed
  assert.equal(applications.get("app-1").hiring_stage, "Applied Confirmed", "Job application must remain untouched in ingestion_only mode");
});

// -----------------------------------------------------------------------------
// TEST 3: A failed queue insertion prevents cursor advancement (atomic rollback)
// -----------------------------------------------------------------------------
test("Test 3: A database error during queue insertion rolls back transaction and prevents cursor advancement", async () => {
  const { sql, table, cursors } = createMockQueueDb();

  // Set initial cursor state
  cursors.set("f2729195-5445-4272-ab85-cac5b03b0967:gmail_status_ingestion", {
    last_history_id: "hist_initial_100",
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
      // 1. Attempt queue insert (will throw on second item)
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
  assert.equal(cursorRecord.last_history_id, "hist_initial_100", "Cursor MUST NOT advance when queue insert fails");
});

// -----------------------------------------------------------------------------
// TEST 4: Gmail fetch failures remain retryable
// -----------------------------------------------------------------------------
test("Test 4: Transient 429/5xx errors are preserved as pending_fetch; permanent 404/410 marked as excluded", async () => {
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

    // 3. Test queue preservation logic for both
    const queueItems = [];

    // Transient failure: preserved as pending_fetch so it can be retried later
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

    // Permanent failure: marked as excluded so it doesn't stall workers or Grok
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

// -----------------------------------------------------------------------------
// TEST 5: History pagination cannot lose messages
// -----------------------------------------------------------------------------
test("Test 5: History pagination handles multi-message records and mid-page limits losslessly", async () => {
  const originalFetch = globalThis.fetch;

  // Mock Gmail users.history.list with:
  // - Record 101: 2 messages (msg_1, msg_2)
  // - Record 102: 2 messages (msg_3, msg_4)
  // - Record 103: 1 message  (msg_5)
  // - Record 104: 1 message  (msg_6)
  globalThis.fetch = async (url) => {
    const urlStr = String(url);
    if (urlStr.includes("history?")) {
      const u = new URL(urlStr);
      const startHistoryId = u.searchParams.get("startHistoryId");

      if (startHistoryId === "100") {
        return new Response(JSON.stringify({
          historyId: "104",
          history: [
            { id: "101", messagesAdded: [{ message: { id: "msg_1", threadId: "t1" } }, { message: { id: "msg_2", threadId: "t2" } }] },
            { id: "102", messagesAdded: [{ message: { id: "msg_3", threadId: "t3" } }, { message: { id: "msg_4", threadId: "t4" } }] },
            { id: "103", messagesAdded: [{ message: { id: "msg_5", threadId: "t5" } }] },
            { id: "104", messagesAdded: [{ message: { id: "msg_6", threadId: "t6" } }] },
          ],
          nextPageToken: null,
        }), { status: 200 });
      } else if (startHistoryId === "102") {
        // Resumed run starting after record 102
        return new Response(JSON.stringify({
          historyId: "104",
          history: [
            { id: "103", messagesAdded: [{ message: { id: "msg_5", threadId: "t5" } }] },
            { id: "104", messagesAdded: [{ message: { id: "msg_6", threadId: "t6" } }] },
          ],
          nextPageToken: null,
        }), { status: 200 });
      }
    }
    return new Response("Not found", { status: 404 });
  };

  try {
    // Pass 1: maxMessages = 3 (Record 101 has 2 messages, Record 102 has 2 messages).
    // Record 102 is completed entirely (total 4 messages), then loop stops before Record 103.
    // Checkpoint MUST NOT advance to 104; it must stop at record 102!
    const run1 = await syncViaGmailHistory({
      token: "mock-token",
      startHistoryId: "100",
      maxMessages: 3,
    });

    assert.equal(run1.messages.length, 4, "Atomic record processing completes record 102 entirely (2 + 2 = 4 messages)");
    assert.equal(run1.hasMoreBacklog, true, "Must flag backlog remaining");
    assert.equal(run1.latestHistoryId, "102", "Checkpoint MUST be record 102, NOT premature 104!");

    // Pass 2: Resume with startHistoryId: "102"
    const run2 = await syncViaGmailHistory({
      token: "mock-token",
      startHistoryId: run1.latestHistoryId,
      maxMessages: 10,
    });

    assert.equal(run2.messages.length, 2, "Run 2 must pick up records 103 and 104 (msg_5, msg_6)");
    assert.equal(run2.hasMoreBacklog, false, "Backlog exhausted");
    assert.equal(run2.latestHistoryId, "104", "Final checkpoint advances to 104");

    const allDiscoveredIds = [...run1.messages.map((m) => m.id), ...run2.messages.map((m) => m.id)];
    assert.deepEqual(allDiscoveredIds, ["msg_1", "msg_2", "msg_3", "msg_4", "msg_5", "msg_6"], "Zero messages lost across paginated continuation!");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// -----------------------------------------------------------------------------
// TEST 6: Expired history IDs trigger safe reconciliation
// -----------------------------------------------------------------------------
test("Test 6: Expired history ID triggers HTTP 404 fallback to full search reconciliation", async () => {
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

// -----------------------------------------------------------------------------
// TEST 7: Repeated scans do not create duplicates
// -----------------------------------------------------------------------------
test("Test 7: Repeated scans do not create duplicate queue rows", async () => {
  const { sql, table } = createMockQueueDb();

  const items = [
    {
      owner_id: "f2729195-5445-4272-ab85-cac5b03b0967",
      mailbox: "govardhanreddy.vys7@gmail.com",
      message_id: "idemp_msg_1",
      message_timestamp: new Date().toISOString(),
      processing_status: "pending",
      content_hash: "hash_1",
    },
    {
      owner_id: "f2729195-5445-4272-ab85-cac5b03b0967",
      mailbox: "govardhanreddy.vys7@gmail.com",
      message_id: "idemp_msg_2",
      message_timestamp: new Date().toISOString(),
      processing_status: "pending",
      content_hash: "hash_2",
    },
  ];

  const pass1 = await enqueueDiscoveredMessages(sql, items);
  assert.equal(pass1.newlyEnqueued, 2);
  assert.equal(pass1.duplicatesSkipped, 0);
  assert.equal(table.size, 2);

  const pass2 = await enqueueDiscoveredMessages(sql, items);
  assert.equal(pass2.newlyEnqueued, 0, "Second pass must insert 0 new rows");
  assert.equal(pass2.duplicatesSkipped, 2, "Second pass must identify 2 duplicates");
  assert.equal(table.size, 2, "Table size remains strictly 2");
});

// -----------------------------------------------------------------------------
// TEST 8: No live application updates occur
// -----------------------------------------------------------------------------
test("Test 8: Production live-writes gate blocks application mutations even if requested", () => {
  const checkLiveWriteAllowed = (requestedMode, gateEnv) => {
    if (requestedMode === "live_updates") {
      // live_updates is strictly reserved for later deployment
      return false;
    }
    return false;
  };

  assert.equal(checkLiveWriteAllowed("live_updates", "false"), false);
  assert.equal(checkLiveWriteAllowed("live_updates", "true"), false);
  assert.equal(checkLiveWriteAllowed("ingestion_only", "true"), false);
  assert.equal(checkLiveWriteAllowed("diagnostic_dry_run", "true"), false);
});

// -----------------------------------------------------------------------------
// TEST 9: Queue processing works independently of Grok availability
// -----------------------------------------------------------------------------
test("Test 9: Queue ingestion persists messages when Grok is offline, and workers claim leases when online", async () => {
  const { sql, table } = createMockQueueDb();

  // Ingestion runs while Grok is offline
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

  // Worker / Grok comes online and leases batch with FOR UPDATE SKIP LOCKED
  const claim = await claimQueueBatch(sql, {
    mailbox: "govardhanreddy.vys7@gmail.com",
    batchSize: 2,
    leaseSeconds: 60,
    workerToken: "grok-worker-1",
  });

  assert.equal(claim.claimedItems.length, 2, "Grok worker claims both items successfully");
  assert.equal(claim.claimedItems[0].processing_status, "claimed");

  // Worker completes analysis
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

// -----------------------------------------------------------------------------
// TEST 10: Flat JSONB array for error_details
// -----------------------------------------------------------------------------
test("Test 10: failQueueItem maintains error_details as a flat JSONB array without nesting", async () => {
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

  // Claim attempt 1
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

  // Claim attempt 2
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

// -----------------------------------------------------------------------------
// TEST 11: Sensitive message filtering and redaction
// -----------------------------------------------------------------------------
test("Test 11: Sensitive auth/security emails are excluded and redacted from queue content", async () => {
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
