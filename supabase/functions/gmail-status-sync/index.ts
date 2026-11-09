import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.5";
import { classifyRecruitmentEmail } from "./classifier.ts";
import { matchApplicationToEmail } from "./matcher.ts";
import {
  resolveScanWindow,
  computeContinuationState,
} from "./continuation.ts";
import {
  executeGmailSync,
  HistoryExpiredError,
  fetchMessageWithRetry,
  PermanentMessageInaccessibleError,
  TransientMessageFetchError,
} from "./history-sync.ts";
import {
  checkSensitiveMessage,
  sanitizeSubject,
  sanitizeSender,
  computeContentHash,
} from "./sensitive-filter.ts";
import {
  enqueueDiscoveredMessages,
} from "./queue-service.ts";
import type {
  CandidateApplication,
  CanonicalHiringStage,
  ReviewReasonCode,
  SyncRunResult,
  GmailQueueItem,
  ExecutionMode,
} from "./types.ts";

const OWNER_EMAIL = "govardhanreddy.vys7@gmail.com";
const OWNER_UUID = "f2729195-5445-4272-ab85-cac5b03b0967";
const BOT_NAME = "Gmail Status Agent";
const OVERLAP_MINUTES = 15;
const MAX_MESSAGES_PER_RUN = 200;
const LAST_VERIFIED_CHECKPOINT = "2026-11-08T22:47:41.801952+00:00";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, {
  prepare: false,
  max: 2,
  idle_timeout: 5,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function getSecret(name: string): Promise<string | null> {
  try {
    const [row] = await sql`select jobbot.monitor_get_secret(${name}) as v`;
    if (row?.v) return row.v;
  } catch {
    // Fall back to environment variable
  }
  return Deno.env.get(name) || Deno.env.get(name.toUpperCase()) || null;
}

/**
 * Exchanges Google OAuth refresh token for an access token.
 */
async function getGoogleAccessToken(): Promise<{
  token?: string;
  error?: { code: string; detail?: string };
}> {
  const [clientId, clientSecret, refreshToken] = await Promise.all([
    getSecret("jf_gmail_client_id"),
    getSecret("jf_gmail_client_secret"),
    getSecret("jf_gmail_refresh_token"),
  ]);

  if (!clientId || !clientSecret || !refreshToken) {
    return {
      error: {
        code: "gmail_oauth_not_configured",
        detail: "Missing one or more required Gmail OAuth credentials in Supabase Vault",
      },
    };
  }

  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
      signal: AbortSignal.timeout(15_000),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) {
      const code = data?.error === "invalid_grant" ? "gmail_oauth_invalid_grant" : "gmail_token_exchange_failed";
      return {
        error: {
          code,
          detail: String(data?.error_description || data?.error || res.status),
        },
      };
    }

    return { token: data.access_token };
  } catch (err: any) {
    return {
      error: {
        code: "gmail_oauth_network_error",
        detail: err?.message || String(err),
      },
    };
  }
}

/**
 * Validates that the token connects to the designated owner mailbox.
 */
async function verifyMailboxOwner(token: string): Promise<{ valid: boolean; email?: string }> {
  try {
    const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { valid: false };
    const data = await res.json();
    const email = (data.emailAddress || "").toLowerCase();
    return {
      valid: email === OWNER_EMAIL.toLowerCase(),
      email,
    };
  } catch {
    return { valid: false };
  }
}

/**
 * Helper to call Gmail REST API.
 */
async function callGmailApi(token: string, path: string): Promise<any> {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`Gmail API HTTP ${res.status} on ${path.split("?")[0]}`);
  }
  return await res.json();
}

/**
 * Extracts header value case-insensitively.
 */
function getHeader(headers: any[], name: string): string {
  const h = headers?.find((item) => item.name?.toLowerCase() === name.toLowerCase());
  return h?.value || "";
}

/**
 * Extracts plain text from MIME parts safely.
 */
function extractBodyText(payload: any): string {
  if (!payload) return "";

  if (payload.body?.data) {
    try {
      const binary = atob(payload.body.data.replace(/-/g, "+").replace(/_/g, "/"));
      return binary;
    } catch {
      // Ignore base64 decode failure
    }
  }

  if (Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        try {
          return atob(part.body.data.replace(/-/g, "+").replace(/_/g, "/"));
        } catch {
          // Continue
        }
      }
    }
    for (const part of payload.parts) {
      if (part.mimeType === "text/html" && part.body?.data) {
        try {
          return atob(part.body.data.replace(/-/g, "+").replace(/_/g, "/"));
        } catch {
          // Continue
        }
      }
    }
  }

  return "";
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed. Use POST." }, 405);
  }

  // 1. Authenticate invocation via dedicated shared secret
  const expectedToken = await getSecret("jf_monitor_invoke_token");
  const authHeader = req.headers.get("x-jf-monitor-token") || req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") || "";
  
  if (!expectedToken || !safeEqual(authHeader, expectedToken)) {
    return json({ error: "Unauthorized: invalid or missing invocation token" }, 401);
  }

  // 2. Parse request parameters
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  // 3. EXECUTION MODE & SERVER GATES ENFORCEMENT:
  // Three distinct execution modes:
  // - diagnostic_dry_run: inspect & report only; zero queue or application mutations (default).
  // - ingestion_only: persist Gmail metadata & advance ingestion cursor; zero application/review updates.
  // - live_updates: reserved for a later, separately authorized deployment (do not enable).
  const serverIngestionEnabled =
    Deno.env.get("ENABLE_GMAIL_QUEUE_INGESTION") === "true" ||
    (await getSecret("jf_enable_gmail_queue_ingestion")) === "true";

  const serverLiveWritesEnabled =
    Deno.env.get("ENABLE_GMAIL_STATUS_WRITES") === "true" ||
    (await getSecret("jf_enable_gmail_status_writes")) === "true";

  let requestedMode: ExecutionMode;
  if (body.mode === "live_updates") {
    requestedMode = "live_updates";
  } else if (body.mode === "ingestion_only" || (body.dry_run === false && body.mode === undefined)) {
    requestedMode = "ingestion_only";
  } else {
    requestedMode = "diagnostic_dry_run";
  }

  let effectiveMode: ExecutionMode = "diagnostic_dry_run";
  let gateLockedReason: string | null = null;

  if (requestedMode === "live_updates") {
    effectiveMode = "diagnostic_dry_run";
    gateLockedReason = "live_updates is reserved for later deployment and strictly gated.";
  } else if (requestedMode === "ingestion_only") {
    if (serverIngestionEnabled) {
      effectiveMode = "ingestion_only";
    } else {
      effectiveMode = "diagnostic_dry_run";
      gateLockedReason = "ENABLE_GMAIL_QUEUE_INGESTION is disabled. Live queue mutations blocked; running diagnostic_dry_run.";
    }
  } else {
    effectiveMode = "diagnostic_dry_run";
  }

  const dryRun = effectiveMode === "diagnostic_dry_run";
  const liveWriteGateLocked = Boolean(gateLockedReason);

  const gapReconcile: boolean = Boolean(body.gap_reconciliation);
  const maxMessages = Math.min(Number(body.max_messages) || MAX_MESSAGES_PER_RUN, 300);

  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();

  try {
    // 4. Obtain Google OAuth token
    const tokenResult = await getGoogleAccessToken();
    if (tokenResult.error || !tokenResult.token) {
      return json({
        runId,
        status: "source_unavailable",
        error: tokenResult.error,
        dryRun,
        liveWriteGateLocked,
      }, 503);
    }
    const token = tokenResult.token;

    // 5. Validate mailbox owner
    const profile = await verifyMailboxOwner(token);
    if (!profile.valid) {
      return json({
        runId,
        status: "failed",
        error: {
          code: "mailbox_owner_mismatch",
          detail: `Expected mailbox ${OWNER_EMAIL}, but OAuth token belongs to ${profile.email || "unknown"}`,
        },
      }, 403);
    }

    // 6. HARDENED CHECKPOINT & RESUMABLE BACKFILL RESOLUTION:
    // Read the dedicated ingestion cursor from jobbot.sync_cursors first.
    // An incomplete backfill or dry-run log must NEVER advance the production checkpoint past unprocessed messages.
    const [cursorRow] = await sql`
      select last_history_id, last_success_at, last_observed_at, overlap_minutes
        from jobbot.sync_cursors
       where source_key = 'gmail_status_ingestion'
         and owner_id = ${OWNER_UUID}::uuid
    `.catch(() => []);

    const [latestProductionLog] = await sql`
      select started_at, completed_at,
             case 
               when jsonb_typeof(verification_results) = 'string' 
               then (verification_results #>> '{}')::jsonb 
               else verification_results 
             end as verification_results
        from jobbot.sync_logs
       where bot_name = ${BOT_NAME}
         and coalesce(
           case 
             when jsonb_typeof(verification_results) = 'string' 
             then ((verification_results #>> '{}')::jsonb->>'dry_run')::boolean
             else (verification_results->>'dry_run')::boolean
           end, 
           false
         ) = false
       order by started_at desc limit 1
    `;

    const scanWindow = resolveScanWindow({
      latestProductionLog,
      cursorRecord: cursorRow || null,
      gapReconcile,
      lastVerifiedCheckpoint: LAST_VERIFIED_CHECKPOINT,
      overlapMinutes: OVERLAP_MINUTES,
      bodyBeforeEpoch: body.continuation_before_epoch ? Number(body.continuation_before_epoch) : null,
      bodyAfterEpoch: body.continuation_after_epoch ? Number(body.continuation_after_epoch) : null,
      bodyStartHistoryId: body.start_history_id || null,
    });

    // 7. Loss-Resistant Gmail Synchronization (History API + Full Query Fallback)
    // Removes restrictive (label:INBOX OR label:SENT) to capture archived and custom-labeled emails
    const syncResult = await executeGmailSync({
      token,
      startHistoryId: scanWindow.startHistoryId || body.start_history_id || null,
      startHistorySnapshot: scanWindow.startHistoryId || null,
      queryAfterEpoch: scanWindow.queryAfterEpoch,
      queryBeforeEpoch: scanWindow.queryBeforeEpoch,
      isResumingBackfill: scanWindow.isResumingBackfill,
      maxMessages,
      pageToken: body.continuation_page_token || undefined,
      gapReconciliation: gapReconcile,
    });

    const rawMessageHeaders = syncResult.messages;
    const pageToken = syncResult.nextPageToken || "";
    const hasMoreBacklog = syncResult.hasMoreBacklog;
    const latestHistoryId = syncResult.latestHistoryId;

    // 8. Load known applications and deduplication sets
    const [appsRows, reviewRows, eventRows] = await Promise.all([
      sql`select id, company, job_title, requisition_id, confirmation_email_ref, hiring_stage, application_status, applied_at from jobbot.job_applications`,
      sql`select message_id from jobbot.recruitment_review_items`,
      sql`select external_event_id from jobbot.application_events where evidence_source = 'gmail' and external_event_id is not null`,
    ]);

    const applications: CandidateApplication[] = appsRows.map((r: any) => ({
      id: r.id,
      company: r.company,
      job_title: r.job_title,
      requisition_id: r.requisition_id,
      confirmation_email_ref: r.confirmation_email_ref,
      hiring_stage: r.hiring_stage,
      application_status: r.application_status,
      applied_at: r.applied_at,
    }));

    const processedMessageMap = new Map<string, "recruitment_review_items" | "application_events">();
    for (const r of reviewRows) {
      if (r.message_id) processedMessageMap.set(r.message_id, "recruitment_review_items");
    }
    for (const r of eventRows) {
      if (r.external_event_id) {
        const parts = r.external_event_id.split(":");
        const id = parts[parts.length - 1];
        if (id) processedMessageMap.set(id, "application_events");
      }
    }

    // 9. Fetch full messages with bounded retry and preserve failed retrievals
    // Invariant (Issue 4): Never silently drop previously processed messages from ingestion inventory.
    // Reconcile legacy processed messages into the queue with explicit provenance.
    const fetchedMessages: any[] = [];
    let duplicateCount = 0;
    let legacyReconciledCount = 0;
    const queueItems: GmailQueueItem[] = [];
    const excludedSensitiveItems: Array<{ messageId: string; reason: string }> = [];

    for (const item of rawMessageHeaders) {
      try {
        const msg = await fetchMessageWithRetry(token, item.id);
        fetchedMessages.push(msg);
      } catch (err: any) {
        if (err instanceof PermanentMessageInaccessibleError) {
          // Permanent 404/410: message deleted or inaccessible
          const contentHash = await computeContentHash({
            mailbox: OWNER_EMAIL,
            messageId: item.id,
            internalDate: 0,
            isSensitive: true,
          });
          queueItems.push({
            owner_id: OWNER_UUID,
            mailbox: OWNER_EMAIL,
            message_id: item.id,
            thread_id: item.threadId || item.id,
            message_timestamp: new Date().toISOString(),
            history_id: latestHistoryId || null,
            processing_status: "excluded",
            content_hash: contentHash,
            subject_clean: "[INACCESSIBLE]",
            sender_clean: "unknown",
            attempt_count: 0,
            max_attempts: 5,
            review_status: "ignored",
            exclusion_reason: "message_deleted_or_inaccessible",
            error_details: [{ error: err.message, timestamp: new Date().toISOString() }],
          });
        } else {
          // Transient failure (429/5xx/timeout): retain in queue as pending_fetch so it can be retried
          const contentHash = await computeContentHash({
            mailbox: OWNER_EMAIL,
            messageId: item.id,
            internalDate: 0,
            isSensitive: true,
          });
          queueItems.push({
            owner_id: OWNER_UUID,
            mailbox: OWNER_EMAIL,
            message_id: item.id,
            thread_id: item.threadId || item.id,
            message_timestamp: new Date().toISOString(),
            history_id: latestHistoryId || null,
            processing_status: "pending_fetch",
            content_hash: contentHash,
            subject_clean: "[FETCH_PENDING]",
            sender_clean: "unknown",
            attempt_count: 1,
            max_attempts: 5,
            review_status: "pending",
            error_details: [{ error: err?.message || String(err), timestamp: new Date().toISOString() }],
          });
        }
      }
    }

    // Process events chronologically so status updates follow true historical order
    fetchedMessages.sort((a, b) => Number(a.internalDate || 0) - Number(b.internalDate || 0));

    // 10. Process messages through classifier and hardened matcher
    const proposedChanges: Array<{
      applicationId: string;
      company: string;
      jobTitle: string;
      previousStage: string | null;
      newStage: string;
      messageId: string;
      internalDate: number;
      quote?: string;
    }> = [];

    const proposedReviews: Array<{
      mailbox: string;
      messageId: string;
      threadId: string;
      reasonCode: ReviewReasonCode;
      proposedStage: string | null;
      evidenceSummary: string;
      candidateApplications: any[];
      eventAt: string;
    }> = [];

    const ignoredMessageIds: string[] = [];

    let maxInternalDate = 0;
    let minInternalDate = Infinity;

    for (const msg of fetchedMessages) {
      const msgId = msg.id;
      const internalDate = Number(msg.internalDate || 0);
      if (internalDate > 0) {
        if (internalDate > maxInternalDate) {
          maxInternalDate = internalDate;
        }
        if (internalDate < minInternalDate) {
          minInternalDate = internalDate;
        }
      }

      const headers = msg.payload?.headers || [];
      const subject = getHeader(headers, "Subject") || "";
      const from = getHeader(headers, "From") || "";
      const snippet = msg.snippet || "";

      // Sensitive check & content hashing
      const sensitiveCheck = checkSensitiveMessage({ from, subject, snippet });
      const isSensitive = sensitiveCheck.isSensitive;

      const contentHash = await computeContentHash({
        mailbox: OWNER_EMAIL,
        messageId: msgId,
        internalDate,
        subject,
        snippet,
        isSensitive,
      });

      if (isSensitive) {
        excludedSensitiveItems.push({
          messageId: msgId,
          reason: sensitiveCheck.reason || "sensitive_security_otp",
        });
        queueItems.push({
          owner_id: OWNER_UUID,
          mailbox: OWNER_EMAIL,
          message_id: msgId,
          thread_id: msg.threadId || msgId,
          message_timestamp: internalDate > 0 ? new Date(internalDate).toISOString() : new Date().toISOString(),
          history_id: msg.historyId ? String(msg.historyId) : (latestHistoryId || null),
          processing_status: "excluded",
          content_hash: contentHash,
          subject_clean: "[REDACTED]",
          sender_clean: sanitizeSender(from),
          attempt_count: 0,
          max_attempts: 5,
          review_status: "ignored",
          exclusion_reason: sensitiveCheck.reason,
        });
        // Never process sensitive security emails for recruitment updates
        continue;
      }

      // Invariant (Issue 4): Preserve existing application history and idempotency!
      // Reconcile legacy processed messages into the queue with explicit provenance
      // rather than silently dropping email IDs from ingestion.
      if (processedMessageMap.has(msgId)) {
        const legacySource = processedMessageMap.get(msgId)!;
        legacyReconciledCount++;
        queueItems.push({
          owner_id: OWNER_UUID,
          mailbox: OWNER_EMAIL,
          message_id: msgId,
          thread_id: msg.threadId || msgId,
          message_timestamp: internalDate > 0 ? new Date(internalDate).toISOString() : new Date().toISOString(),
          history_id: msg.historyId ? String(msg.historyId) : (latestHistoryId || null),
          processing_status: "completed",
          content_hash: contentHash,
          subject_clean: sanitizeSubject(subject),
          sender_clean: sanitizeSender(from),
          attempt_count: 0,
          max_attempts: 5,
          review_status: legacySource === "recruitment_review_items" ? "requires_review" : "auto_approved",
          evidence_references: {
            legacy_processed: true,
            legacy_source: legacySource,
            reconciled_at: new Date().toISOString(),
          },
        });
        // Legacy message already processed into recruitment_review_items or application_events.
        // Do not generate duplicate proposedChanges or proposedReviews.
        continue;
      }

      // Non-sensitive: Always queue for future Grok analysis
      queueItems.push({
        owner_id: OWNER_UUID,
        mailbox: OWNER_EMAIL,
        message_id: msgId,
        thread_id: msg.threadId || msgId,
        message_timestamp: internalDate > 0 ? new Date(internalDate).toISOString() : new Date().toISOString(),
        history_id: msg.historyId ? String(msg.historyId) : (latestHistoryId || null),
        processing_status: "pending",
        content_hash: contentHash,
        subject_clean: sanitizeSubject(subject),
        sender_clean: sanitizeSender(from),
        attempt_count: 0,
        max_attempts: 5,
        review_status: "pending",
      });

      const bodyText = extractBodyText(msg.payload);

      const classification = classifyRecruitmentEmail({
        from,
        subject,
        snippet,
        bodyText,
      });

      if (!classification.isRecruitment) {
        ignoredMessageIds.push(msgId);
        continue;
      }

      const match = matchApplicationToEmail(
        {
          id: msgId,
          threadId: msg.threadId,
          from,
          subject,
          bodyText,
        },
        applications
      );

      if (match.matched && match.matchedApplication && classification.stage) {
        const targetApp = match.matchedApplication;
        const currentStage = targetApp.hiring_stage;

        // HARDENING: Prevent older messages from overwriting terminal or newer stages
        const isTerminalCurrent = currentStage === "Rejected" || currentStage === "Offer Received";
        const isTerminalNew = classification.stage === "Rejected" || classification.stage === "Offer Received";

        if (isTerminalCurrent && !isTerminalNew) {
          // If candidate is already rejected or offered, a non-terminal message cannot downgrade status.
          // Queue for review instead of overwriting.
          proposedReviews.push({
            mailbox: OWNER_EMAIL,
            messageId: msgId,
            threadId: msg.threadId || msgId,
            reasonCode: "ambiguous_outcome",
            proposedStage: classification.stage,
            evidenceSummary: `Message proposes stage "${classification.stage}", but application is already in terminal stage "${currentStage}". Preserving verified outcome.`,
            candidateApplications: [{ id: targetApp.id, company: targetApp.company, job_title: targetApp.job_title }],
            eventAt: internalDate ? new Date(internalDate).toISOString() : new Date().toISOString(),
          });
          continue;
        }

        if (currentStage !== classification.stage) {
          proposedChanges.push({
            applicationId: targetApp.id,
            company: targetApp.company,
            jobTitle: targetApp.job_title,
            previousStage: currentStage || null,
            newStage: classification.stage,
            messageId: msgId,
            internalDate,
            quote: classification.quote,
          });
        }
      } else if (match.ambiguous || classification.requiresReview || !classification.stage) {
        const reasonCode: ReviewReasonCode =
          match.reasonCode ||
          classification.reasonCode ||
          "ambiguous_outcome";

        proposedReviews.push({
          mailbox: OWNER_EMAIL,
          messageId: msgId,
          threadId: msg.threadId || msgId,
          reasonCode,
          proposedStage: classification.stage,
          evidenceSummary: `${classification.evidenceSummary}. Match note: ${match.matchBasis || "Ambiguous candidate mapping"}.`,
          candidateApplications: (match.candidateApplications || []).map((a) => ({
            id: a.id,
            company: a.company,
            job_title: a.job_title,
          })),
          eventAt: internalDate ? new Date(internalDate).toISOString() : new Date().toISOString(),
        });
      }
    }

    const completedAt = new Date().toISOString();

    const continuation = computeContinuationState({
      rawMessageCount: rawMessageHeaders.length,
      maxMessages,
      hasRemainingPageToken: Boolean(pageToken),
      minInternalDate: minInternalDate !== Infinity ? minInternalDate : undefined,
      queryAfterEpoch: scanWindow.queryAfterEpoch,
      isResumingBackfill: scanWindow.isResumingBackfill,
      continuationCeilingTime: scanWindow.continuationCeilingTime,
      startedAt,
      completedAt,
      dryRun,
      syncStrategy: syncResult.strategy,
      lastConsumedHistoryRecordId: syncResult.strategy === "history" ? syncResult.latestHistoryId : null,
    });

    // 11. DIAGNOSTIC DRY-RUN EXECUTION BRANCH
    if (effectiveMode === "diagnostic_dry_run") {
      // In DIAGNOSTIC DRY RUN mode:
      // - Zero queue writes
      // - Zero cursor advancement
      // - Zero application updates
      // - messages_enqueued is strictly 0
      // - Diagnostic sync log entry recorded
      const dryRunVerificationResults = {
        status: continuation.status,
        mode: "diagnostic_dry_run",
        dry_run: true,
        mailbox: OWNER_EMAIL,
        sync_strategy: syncResult.strategy,
        continuation_strategy: continuation.continuationStrategy,
        start_history_id: scanWindow.startHistoryId || null,
        latest_history_id: latestHistoryId || null,
        last_consumed_history_record_id: continuation.lastConsumedHistoryRecordId,
        history_expired_recovered: syncResult.historyExpiredRecovered || false,
        run_kind: scanWindow.isResumingBackfill
          ? "backfill_continuation_dry_run"
          : (gapReconcile ? "gap_reconciliation_dry_run" : "scheduled_incremental_poll_dry_run"),
        scan_start_at: new Date(scanWindow.queryAfterEpoch * 1000).toISOString(),
        last_gmail_scan_at: completedAt,
        has_more_backlog: continuation.hasMoreBacklog,
        all_pages_complete: continuation.allPagesComplete,
        checkpoint_advanced: false,
        continuation_before_epoch: continuation.nextContinuationBeforeEpoch,
        continuation_after_epoch: continuation.nextContinuationAfterEpoch,
        continuation_ceiling_time: continuation.nextContinuationCeilingTime,
        continuation_page_token: continuation.hasMoreBacklog ? (pageToken || null) : null,
        messages_discovered: rawMessageHeaders.length,
        messages_enqueued: 0, // Strictly 0 committed rows
        proposed_queue_items_count: queueItems.length,
        messages_excluded_sensitive: excludedSensitiveItems.length,
        excluded_sensitive_details: excludedSensitiveItems,
        proposed_changes_count: proposedChanges.length,
        proposed_reviews_count: proposedReviews.length,
        legacy_reconciled_count: legacyReconciledCount,
        duplicate_messages_count: duplicateCount,
        ignored_messages_count: ignoredMessageIds.length,
        start_history_snapshot: syncResult.startHistorySnapshot || null,
        proposed_changes: proposedChanges,
        gate_locked_reason: gateLockedReason,
      };

      await sql`
        insert into jobbot.sync_logs (
          run_id, bot_name, started_at, completed_at,
          created_count, updated_count, skipped_count,
          errors, verification_results
        ) values (
          ${runId}::uuid, ${BOT_NAME}, ${startedAt}::timestamptz, ${completedAt}::timestamptz,
          ${0}, ${0}, ${duplicateCount + ignoredMessageIds.length + legacyReconciledCount},
          ${sql.json([])},
          ${sql.json(dryRunVerificationResults)}
        )
      `;

      const result: SyncRunResult & {
        hasMoreBacklog: boolean;
        checkpointAdvanced: boolean;
        continuation?: any;
      } = {
        runId,
        status: continuation.status as any,
        mailbox: OWNER_EMAIL,
        dryRun: true,
        executionMode: "diagnostic_dry_run",
        gateLockedReason: gateLockedReason || undefined,
        gapReconciled: gapReconcile,
        syncStrategy: syncResult.strategy,
        startHistoryId: scanWindow.startHistoryId || null,
        latestHistoryId: latestHistoryId || null,
        startHistorySnapshot: syncResult.startHistorySnapshot || null,
        scanStartAt: new Date(scanWindow.queryAfterEpoch * 1000).toISOString(),
        scanEndAt: completedAt,
        messagesFound: rawMessageHeaders.length,
        messagesEnqueued: 0, // Strictly 0 committed queue rows
        messagesExcludedSensitive: excludedSensitiveItems.length,
        legacyReconciled: legacyReconciledCount,
        messagesClassified: proposedChanges.length + proposedReviews.length,
        statusChangesConfirmed: 0,
        reviewItemsQueued: 0,
        duplicateMessagesSkipped: duplicateCount,
        ignoredMessages: ignoredMessageIds,
        errors: gateLockedReason
          ? [{ code: "gate_locked", detail: gateLockedReason }]
          : [],
        details: {
          proposedChanges,
          proposedReviews: proposedReviews.map((r) => ({
            mailbox: r.mailbox,
            messageId: r.messageId,
            reasonCode: r.reasonCode,
            proposedStage: r.proposedStage,
            evidenceSummary: r.evidenceSummary,
            candidateCount: r.candidateApplications.length,
          })),
          excludedSensitiveMessages: excludedSensitiveItems,
        },
        hasMoreBacklog: continuation.hasMoreBacklog,
        checkpointAdvanced: false,
        continuationStrategy: continuation.continuationStrategy,
        lastConsumedHistoryRecordId: continuation.lastConsumedHistoryRecordId,
        continuation: continuation.hasMoreBacklog ? {
          strategy: continuation.continuationStrategy,
          beforeEpoch: continuation.nextContinuationBeforeEpoch,
          afterEpoch: continuation.nextContinuationAfterEpoch,
          ceilingTime: continuation.nextContinuationCeilingTime,
          pageToken: pageToken || undefined,
          lastConsumedHistoryRecordId: continuation.lastConsumedHistoryRecordId,
        } : null,
      };

      return json(result, 200);
    }

    // 12. INGESTION ONLY EXECUTION BRANCH
    // Atomically enqueues message metadata and advances the ingestion checkpoint in jobbot.sync_cursors.
    // Invariant: NEVER mutates job_applications, application_events, or recruitment_review_items.
    // Invariant: Any queue insertion failure prevents cursor advancement (throws & rolls back transaction).
    let actualCommittedQueueRows = 0;
    let queueEnqueueResult = {
      totalProcessed: 0,
      newlyEnqueued: 0,
      duplicatesSkipped: 0,
      excludedSensitive: 0,
    };

    await sql.begin(async (tx) => {
      // 1. Transactional queue insertion (no try/catch swallowing errors)
      queueEnqueueResult = await enqueueDiscoveredMessages(tx, queueItems);
      actualCommittedQueueRows = queueEnqueueResult.newlyEnqueued;

      // 2. Advance dedicated sync cursor (ONLY in this transaction!)
      // Invariant (Issue 1): NEVER advance completed ingestion cursor beyond unprocessed Gmail records.
      // Invariant (Issue 1 & 2): When all pages complete, advance to safe snapshot captured before discovery.
      // Invariant (Issue 1 & 3): When backlog remains, NEVER advance last_success_at! For history sync, only
      // advance last_history_id to safe fully-consumed record boundary. For query_full backfill, do NOT advance last_history_id.
      if (continuation.checkpointAdvanced) {
        const effectiveCheckpointTime = continuation.effectiveCheckpointTime || completedAt;
        const effectiveHistoryId = syncResult.startHistorySnapshot || latestHistoryId || null;

        await tx`
          insert into jobbot.sync_cursors (
            owner_id, source_key, last_success_at, last_observed_at,
            last_history_id, overlap_minutes, initial_lookback_hours,
            consecutive_failures, updated_at
          ) values (
            ${OWNER_UUID}::uuid, 'gmail_status_ingestion',
            ${effectiveCheckpointTime}::timestamptz,
            ${maxInternalDate > 0 ? new Date(maxInternalDate).toISOString() : completedAt}::timestamptz,
            ${effectiveHistoryId},
            ${OVERLAP_MINUTES}, 72, 0, now()
          )
          on conflict (owner_id, source_key) do update
          set last_success_at = ${effectiveCheckpointTime}::timestamptz,
              last_observed_at = coalesce(${maxInternalDate > 0 ? new Date(maxInternalDate).toISOString() : null}::timestamptz, jobbot.sync_cursors.last_observed_at),
              last_history_id = coalesce(${effectiveHistoryId}, jobbot.sync_cursors.last_history_id),
              consecutive_failures = 0,
              updated_at = now()
        `;
      } else {
        const safePartialHistoryId = syncResult.strategy === "history"
          ? (syncResult.latestHistoryId || null)
          : null;

        await tx`
          insert into jobbot.sync_cursors (
            owner_id, source_key, last_success_at, last_observed_at,
            last_history_id, overlap_minutes, initial_lookback_hours,
            consecutive_failures, updated_at
          ) values (
            ${OWNER_UUID}::uuid, 'gmail_status_ingestion',
            null,
            ${maxInternalDate > 0 ? new Date(maxInternalDate).toISOString() : null}::timestamptz,
            ${safePartialHistoryId},
            ${OVERLAP_MINUTES}, 72, 0, now()
          )
          on conflict (owner_id, source_key) do update
          set last_observed_at = coalesce(${maxInternalDate > 0 ? new Date(maxInternalDate).toISOString() : null}::timestamptz, jobbot.sync_cursors.last_observed_at),
              last_history_id = coalesce(${safePartialHistoryId}, jobbot.sync_cursors.last_history_id),
              consecutive_failures = 0,
              updated_at = now()
        `;
      }

      // 3. Write ingestion sync log
      const liveVerificationResults = {
        status: continuation.status,
        mode: "ingestion_only",
        dry_run: false,
        mailbox: OWNER_EMAIL,
        sync_strategy: syncResult.strategy,
        continuation_strategy: continuation.continuationStrategy,
        start_history_id: scanWindow.startHistoryId || null,
        latest_history_id: latestHistoryId || null,
        last_consumed_history_record_id: continuation.lastConsumedHistoryRecordId,
        start_history_snapshot: syncResult.startHistorySnapshot || null,
        history_expired_recovered: syncResult.historyExpiredRecovered || false,
        run_kind: scanWindow.isResumingBackfill
          ? "backfill_continuation"
          : (gapReconcile ? "gap_reconciliation" : "scheduled_incremental_poll"),
        scan_start_at: new Date(scanWindow.queryAfterEpoch * 1000).toISOString(),
        last_gmail_scan_at: completedAt,
        has_more_backlog: continuation.hasMoreBacklog,
        all_pages_complete: continuation.allPagesComplete,
        checkpoint_advanced: continuation.checkpointAdvanced,
        continuation_before_epoch: continuation.nextContinuationBeforeEpoch,
        continuation_after_epoch: continuation.nextContinuationAfterEpoch,
        continuation_ceiling_time: continuation.nextContinuationCeilingTime,
        continuation_page_token: continuation.hasMoreBacklog ? (pageToken || null) : null,
        messages_discovered: rawMessageHeaders.length,
        messages_enqueued: actualCommittedQueueRows,
        messages_excluded_sensitive: queueEnqueueResult.excludedSensitive,
        duplicates_skipped: queueEnqueueResult.duplicatesSkipped,
        legacy_reconciled_count: legacyReconciledCount,
        pending_fetch_count: queueItems.filter((q) => q.processing_status === "pending_fetch").length,
        updated_count: 0,
        statusChangesConfirmed: 0,
        latest_successful_ingestion_at: continuation.checkpointAdvanced ? completedAt : (cursorRow?.last_success_at || null),
      };

      await tx`
        insert into jobbot.sync_logs (
          run_id, bot_name, started_at, completed_at,
          created_count, updated_count, skipped_count,
          errors, verification_results
        ) values (
          ${runId}::uuid, ${BOT_NAME}, ${startedAt}::timestamptz, ${completedAt}::timestamptz,
          ${actualCommittedQueueRows}, 0,
          ${queueEnqueueResult.duplicatesSkipped + queueEnqueueResult.excludedSensitive + legacyReconciledCount},
          ${sql.json([])},
          ${sql.json(liveVerificationResults)}
        )
      `;
    });

    return json({
      runId,
      status: continuation.hasMoreBacklog ? "partial_backfill_succeeded" : "sync_succeeded",
      dryRun: false,
      executionMode: "ingestion_only",
      syncStrategy: syncResult.strategy,
      startHistoryId: scanWindow.startHistoryId || null,
      latestHistoryId: latestHistoryId || null,
      startHistorySnapshot: syncResult.startHistorySnapshot || null,
      messagesFound: rawMessageHeaders.length,
      messagesEnqueued: actualCommittedQueueRows,
      messagesExcludedSensitive: queueEnqueueResult.excludedSensitive,
      legacyReconciled: legacyReconciledCount,
      duplicatesSkipped: queueEnqueueResult.duplicatesSkipped,
      updated: 0,
      statusChangesConfirmed: 0,
      reviewsQueued: 0,
      hasMoreBacklog: continuation.hasMoreBacklog,
      checkpointAdvanced: continuation.checkpointAdvanced,
      continuationStrategy: continuation.continuationStrategy,
      lastConsumedHistoryRecordId: continuation.lastConsumedHistoryRecordId,
      continuation: continuation.hasMoreBacklog ? {
        strategy: continuation.continuationStrategy,
        beforeEpoch: continuation.nextContinuationBeforeEpoch,
        afterEpoch: continuation.nextContinuationAfterEpoch,
        ceilingTime: continuation.nextContinuationCeilingTime,
        pageToken: pageToken || undefined,
        lastConsumedHistoryRecordId: continuation.lastConsumedHistoryRecordId,
      } : null,
      completedAt,
    });
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    return json({
      runId,
      status: "failed",
      error: { code: "sync_execution_error", detail: errorMsg },
    }, 500);
  }
});
