import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.5";
import { classifyRecruitmentEmail } from "./classifier.ts";
import { matchApplicationToEmail, isMessageProcessed } from "./matcher.ts";
import {
  resolveScanWindow,
  computeContinuationState,
} from "./continuation.ts";
import {
  executeGmailSync,
  HistoryExpiredError,
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

  // 3. HARDENED LIVE-WRITE GATE ENFORCEMENT:
  // A request specifying dry_run: false MUST NEVER be sufficient to enable live writes.
  // Both the request and the server-side configuration gate ENABLE_GMAIL_STATUS_WRITES must be explicitly true.
  const serverGateEnabled =
    Deno.env.get("ENABLE_GMAIL_STATUS_WRITES") === "true" ||
    (await getSecret("jf_enable_gmail_status_writes")) === "true";

  const requestedLive = body?.dry_run === false;
  const isLiveWrite = requestedLive && serverGateEnabled;

  // Defaults strictly to dry_run: true
  const dryRun = !isLiveWrite;
  const liveWriteGateLocked = requestedLive && !serverGateEnabled;

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
    // Strictly retrieve the latest verified PRODUCTION run (dry_run IS NOT true).
    // An incomplete backfill (status='partial_backfill') or dry-run log must NEVER
    // advance the production checkpoint past unprocessed messages.
    // Handles both JSONB objects and any legacy JSONB strings defensively.
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
      gapReconcile,
      lastVerifiedCheckpoint: LAST_VERIFIED_CHECKPOINT,
      overlapMinutes: OVERLAP_MINUTES,
      bodyBeforeEpoch: body.continuation_before_epoch ? Number(body.continuation_before_epoch) : null,
      bodyAfterEpoch: body.continuation_after_epoch ? Number(body.continuation_after_epoch) : null,
    });

    // 7. Loss-Resistant Gmail Synchronization (History API + Full Query Fallback)
    // Removes restrictive (label:INBOX OR label:SENT) to capture archived and custom-labeled emails
    const syncResult = await executeGmailSync({
      token,
      startHistoryId: scanWindow.startHistoryId || body.start_history_id || null,
      queryAfterEpoch: scanWindow.queryAfterEpoch,
      queryBeforeEpoch: scanWindow.queryBeforeEpoch,
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

    const processedMessageIds = new Set<string>();
    for (const r of reviewRows) {
      if (r.message_id) processedMessageIds.add(r.message_id);
    }
    for (const r of eventRows) {
      if (r.external_event_id) {
        const parts = r.external_event_id.split(":");
        const id = parts[parts.length - 1];
        if (id) processedMessageIds.add(id);
      }
    }

    // 9. Fetch full messages and sort chronologically (internalDate ascending)
    const fetchedMessages: any[] = [];
    let duplicateCount = 0;

    for (const item of rawMessageHeaders) {
      if (isMessageProcessed(item.id, processedMessageIds)) {
        duplicateCount++;
        continue;
      }
      try {
        const msg = await callGmailApi(token, `messages/${item.id}?format=full`);
        fetchedMessages.push(msg);
      } catch (err) {
        console.warn(`Failed to fetch message ${item.id}:`, err);
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
    const queueItems: GmailQueueItem[] = [];
    const excludedSensitiveItems: Array<{ messageId: string; reason: string }> = [];

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
    });

    // 11. STRICT DRY-RUN EXECUTION BRANCH
    if (dryRun) {
      // In DRY RUN mode:
      // - updated_count is strictly 0 (no actual committed updates)
      // - proposed updates are recorded separately in verification_results
      // - checkpoint_advanced is strictly false
      // - verification_results is stored as a true JSONB object via sql.json
      // - No sync_cursors advancement
      // - No application status updates
      // - No application_events inserts
      const dryRunVerificationResults = {
        status: continuation.status,
        dry_run: true,
        mailbox: OWNER_EMAIL,
        sync_strategy: syncResult.strategy,
        start_history_id: scanWindow.startHistoryId || null,
        latest_history_id: latestHistoryId || null,
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
        messages_enqueued: queueItems.filter((q) => q.processing_status === "pending").length,
        messages_excluded_sensitive: excludedSensitiveItems.length,
        excluded_sensitive_details: excludedSensitiveItems,
        proposed_changes_count: proposedChanges.length,
        proposed_reviews_count: proposedReviews.length,
        duplicate_messages_count: duplicateCount,
        ignored_messages_count: ignoredMessageIds.length,
        proposed_changes: proposedChanges,
        live_write_gate_locked: liveWriteGateLocked,
      };

      await sql`
        insert into jobbot.sync_logs (
          run_id, bot_name, started_at, completed_at,
          created_count, updated_count, skipped_count,
          errors, verification_results
        ) values (
          ${runId}::uuid, ${BOT_NAME}, ${startedAt}::timestamptz, ${completedAt}::timestamptz,
          ${0}, ${0}, ${duplicateCount + ignoredMessageIds.length},
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
        gapReconciled: gapReconcile,
        syncStrategy: syncResult.strategy,
        startHistoryId: scanWindow.startHistoryId || null,
        latestHistoryId: latestHistoryId || null,
        scanStartAt: new Date(scanWindow.queryAfterEpoch * 1000).toISOString(),
        scanEndAt: completedAt,
        messagesFound: rawMessageHeaders.length,
        messagesEnqueued: queueItems.filter((q) => q.processing_status === "pending").length,
        messagesExcludedSensitive: excludedSensitiveItems.length,
        excludedSensitiveDetails: excludedSensitiveItems,
        messagesClassified: proposedChanges.length + proposedReviews.length,
        statusChangesConfirmed: 0, // Actual committed updates is zero
        reviewItemsQueued: 0,     // Actual committed reviews is zero
        duplicateMessagesSkipped: duplicateCount,
        ignoredMessages: ignoredMessageIds,
        errors: liveWriteGateLocked
          ? [{ code: "live_writes_gate_locked", detail: "ENABLE_GMAIL_STATUS_WRITES is disabled. Live database mutations blocked." }]
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
        },
        hasMoreBacklog: continuation.hasMoreBacklog,
        checkpointAdvanced: false,
        continuation: continuation.hasMoreBacklog ? {
          beforeEpoch: continuation.nextContinuationBeforeEpoch,
          afterEpoch: continuation.nextContinuationAfterEpoch,
          ceilingTime: continuation.nextContinuationCeilingTime,
          pageToken: pageToken || undefined,
        } : null,
      };

      return json(result, 200);
    }

    // 12. ATOMIC LIVE WRITES (Only runs when both requested AND serverGateEnabled is true)
    let actualCommittedUpdates = 0;
    let duplicateDeliveriesSkipped = 0;
    let actualCommittedReviews = 0;

    await sql.begin(async (tx) => {
      // Invariant: Enqueue discovered messages into durable processing queue
      if (queueItems.length > 0) {
        try {
          await enqueueDiscoveredMessages(tx, queueItems);
        } catch (err: any) {
          console.warn("Queue enqueueing skipped (table may be pending migration):", err?.message || err);
        }
      }

      // Invariant: Update application hiring stage ONLY IF corresponding Gmail event was actually inserted.
      // If event already exists (duplicate), DO NOT update application.
      for (const change of proposedChanges) {
        const externalEventId = `gmail-status:${OWNER_EMAIL}:${change.messageId}`;

        const inserted = await tx`
          insert into jobbot.application_events (
            id, application_id, event_type, previous_status, new_status,
            event_at, evidence_source, external_event_id, actor, verification_status, notes
          )
          select
            ${crypto.randomUUID()}::uuid,
            ${change.applicationId}::uuid,
            'hiring_stage_change',
            ${change.previousStage},
            ${change.newStage},
            ${new Date(change.internalDate).toISOString()}::timestamptz,
            'gmail',
            ${externalEventId},
            'bot',
            'verified',
            ${JSON.stringify({
              kind: "stage_change",
              mailbox: OWNER_EMAIL,
              message_id: change.messageId,
              quote: change.quote,
              ingested_at: completedAt,
            })}::jsonb
          where not exists (
            select 1 from jobbot.application_events
             where external_event_id = ${externalEventId}
          )
          returning id
        `;

        if (inserted && inserted.length > 0) {
          // Event was ACTUALLY inserted for the first time -> update application hiring stage
          await tx`
            update jobbot.job_applications
               set hiring_stage = ${change.newStage},
                   updated_at = now()
             where id = ${change.applicationId}::uuid
          `;
          actualCommittedUpdates++;
        } else {
          // Event already exists (duplicate or concurrent delivery) -> skip application update
          duplicateDeliveriesSkipped++;
        }
      }

      // Insert ambiguous matches into review queue ONLY IF not already existing
      for (const review of proposedReviews) {
        const insertedReview = await tx`
          insert into jobbot.recruitment_review_items (
            id, mailbox, message_id, thread_id, event_at,
            reason_code, proposed_stage, candidate_applications,
            evidence_summary, state, created_at, updated_at
          )
          select
            ${crypto.randomUUID()}::uuid,
            ${review.mailbox},
            ${review.messageId},
            ${review.threadId},
            ${review.eventAt}::timestamptz,
            ${review.reasonCode},
            ${review.proposedStage},
            ${sql.json(review.candidateApplications)},
            ${review.evidenceSummary},
            'open',
            now(),
            now()
          where not exists (
            select 1 from jobbot.recruitment_review_items
             where mailbox = ${review.mailbox}
               and message_id = ${review.messageId}
          )
          returning id
        `;

        if (insertedReview && insertedReview.length > 0) {
          actualCommittedReviews++;
        }
      }

      // Record live production sync_log
      // Invariant: An incomplete backfill (hasMoreBacklog=true) MUST NEVER create a log
      // that can advance the checkpoint past unprocessed messages!
      // Serializes errors and verification_results as true JSONB objects/arrays via sql.json
      const liveVerificationResults = {
        status: continuation.status,
        dry_run: false,
        mailbox: OWNER_EMAIL,
        sync_strategy: syncResult.strategy,
        start_history_id: scanWindow.startHistoryId || null,
        latest_history_id: latestHistoryId || null,
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
        messages_enqueued: queueItems.filter((q) => q.processing_status === "pending").length,
        messages_excluded_sensitive: excludedSensitiveItems.length,
        excluded_sensitive_details: excludedSensitiveItems,
        updated_count: actualCommittedUpdates,
        duplicate_deliveries_skipped: duplicateDeliveriesSkipped,
        review_queued_count: actualCommittedReviews,
        latest_successful_database_write_at: completedAt,
      };

      await tx`
        insert into jobbot.sync_logs (
          run_id, bot_name, started_at, completed_at,
          created_count, updated_count, skipped_count,
          errors, verification_results
        ) values (
          ${runId}::uuid, ${BOT_NAME}, ${startedAt}::timestamptz, ${completedAt}::timestamptz,
          ${0}, ${actualCommittedUpdates}, ${duplicateCount + ignoredMessageIds.length + duplicateDeliveriesSkipped},
          ${sql.json([])},
          ${sql.json(liveVerificationResults)}
        )
      `;
    });

    return json({
      runId,
      status: continuation.hasMoreBacklog ? "partial_backfill_succeeded" : "sync_succeeded",
      dryRun: false,
      syncStrategy: syncResult.strategy,
      startHistoryId: scanWindow.startHistoryId || null,
      latestHistoryId: latestHistoryId || null,
      messagesEnqueued: queueItems.filter((q) => q.processing_status === "pending").length,
      messagesExcludedSensitive: excludedSensitiveItems.length,
      excludedSensitiveDetails: excludedSensitiveItems,
      updated: actualCommittedUpdates,
      duplicateDeliveriesSkipped,
      reviewsQueued: actualCommittedReviews,
      hasMoreBacklog: continuation.hasMoreBacklog,
      checkpointAdvanced: continuation.checkpointAdvanced,
      continuation: continuation.hasMoreBacklog ? {
        beforeEpoch: continuation.nextContinuationBeforeEpoch,
        afterEpoch: continuation.nextContinuationAfterEpoch,
        ceilingTime: continuation.nextContinuationCeilingTime,
        pageToken: pageToken || undefined,
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
