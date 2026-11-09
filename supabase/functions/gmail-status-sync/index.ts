import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.5";
import { classifyRecruitmentEmail } from "./classifier.ts";
import { matchApplicationToEmail, isMessageProcessed } from "./matcher.ts";
import type {
  CandidateApplication,
  CanonicalHiringStage,
  ReviewReasonCode,
  SyncRunResult,
} from "./types.ts";

const OWNER_EMAIL = "govardhanreddy.vys7@gmail.com";
const OWNER_UUID = "f2729195-5445-4272-ab85-cac5b03b0967";
const BOT_NAME = "Gmail Status Agent";
const SOURCE_KEY = "gmail_status_agent";
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
  // First attempt database vault
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
          // Continue to next part
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

  // 1. Authenticate invocation
  const expectedToken = await getSecret("jf_monitor_invoke_token");
  const authHeader = req.headers.get("x-jf-monitor-token") || req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") || "";
  
  if (!expectedToken || !safeEqual(authHeader, expectedToken)) {
    return json({ error: "Unauthorized: invalid or missing invocation token" }, 401);
  }

  // 2. Parse request parameters (STRICT DRY-RUN BY DEFAULT)
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  // Production Safety: Defaults to true unless explicitly provided as false
  const dryRun: boolean = body.dry_run !== false;
  const gapReconcile: boolean = Boolean(body.gap_reconciliation);
  const maxMessages = Math.min(Number(body.max_messages) || MAX_MESSAGES_PER_RUN, 300);

  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();

  try {
    // 3. Obtain Google OAuth token
    const tokenResult = await getGoogleAccessToken();
    if (tokenResult.error || !tokenResult.token) {
      return json({
        runId,
        status: "source_unavailable",
        error: tokenResult.error,
        dryRun,
      }, 503);
    }
    const token = tokenResult.token;

    // 4. Validate mailbox owner
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

    // 5. Determine sync checkpoint
    let lastScanTimeMs: number;
    if (gapReconcile) {
      // Reconcile gap from the last verified batch completed on Nov 8, 2026 ~22:47 UTC
      lastScanTimeMs = new Date(LAST_VERIFIED_CHECKPOINT).getTime() - OVERLAP_MINUTES * 60_000;
    } else {
      // Check sync_logs for latest completed Gmail Status Agent run
      const [latestLog] = await sql`
        select started_at, completed_at, verification_results
          from jobbot.sync_logs
         where bot_name = ${BOT_NAME}
           and (verification_results->>'status') in ('completed', 'dry_run_completed')
         order by started_at desc limit 1
      `;

      if (latestLog?.completed_at) {
        lastScanTimeMs = new Date(latestLog.completed_at).getTime() - OVERLAP_MINUTES * 60_000;
      } else {
        lastScanTimeMs = new Date(LAST_VERIFIED_CHECKPOINT).getTime() - OVERLAP_MINUTES * 60_000;
      }
    }

    const queryEpochSeconds = Math.floor(lastScanTimeMs / 1000);
    const gmailQuery = `after:${queryEpochSeconds} (label:INBOX OR label:SENT) -from:security-noreply@*`;

    // 6. Discover Gmail messages
    const messageIds: string[] = [];
    let pageToken = "";
    do {
      const page = await callGmailApi(
        token,
        `messages?q=${encodeURIComponent(gmailQuery)}&maxResults=100${pageToken ? `&pageToken=${pageToken}` : ""}`
      );
      for (const m of page.messages || []) {
        messageIds.push(m.id);
      }
      pageToken = page.nextPageToken || "";
    } while (pageToken && messageIds.length < maxMessages);

    // 7. Load known applications and previously processed message IDs for deduplication
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

    // 8. Process messages
    const proposedChanges: Array<{
      applicationId: string;
      company: string;
      jobTitle: string;
      previousStage: string | null;
      newStage: string;
      messageId: string;
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
    let duplicateCount = 0;
    let maxInternalDate = 0;

    for (const msgId of messageIds) {
      if (isMessageProcessed(msgId, processedMessageIds)) {
        duplicateCount++;
        continue;
      }

      const msg = await callGmailApi(
        token,
        `messages/${msgId}?format=full`
      );

      const internalDate = Number(msg.internalDate || 0);
      if (internalDate > maxInternalDate) {
        maxInternalDate = internalDate;
      }

      const headers = msg.payload?.headers || [];
      const subject = getHeader(headers, "Subject");
      const from = getHeader(headers, "From");
      const dateStr = getHeader(headers, "Date");
      const snippet = msg.snippet || "";
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
        // High confidence match with definite stage
        if (match.matchedApplication.hiring_stage !== classification.stage) {
          proposedChanges.push({
            applicationId: match.matchedApplication.id,
            company: match.matchedApplication.company,
            jobTitle: match.matchedApplication.job_title,
            previousStage: match.matchedApplication.hiring_stage || null,
            newStage: classification.stage,
            messageId: msgId,
            quote: classification.quote,
          });
        }
      } else if (match.ambiguous || classification.requiresReview || !classification.stage) {
        // Ambiguous match or unclear stage -> stage to review queue
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

    // 9. Execution Branch: DRY-RUN vs LIVE WRITES
    if (dryRun) {
      // In DRY RUN mode, we DO NOT write to job_applications or application_events
      // We record a dry_run_completed sync_log for full operational transparency
      await sql`
        insert into jobbot.sync_logs (
          run_id, bot_name, started_at, completed_at,
          created_count, updated_count, skipped_count,
          errors, verification_results
        ) values (
          ${runId}::uuid, ${BOT_NAME}, ${startedAt}::timestamptz, ${completedAt}::timestamptz,
          ${0}, ${proposedChanges.length}, ${duplicateCount + ignoredMessageIds.length},
          ${JSON.stringify([])}::jsonb,
          ${JSON.stringify({
            status: "dry_run_completed",
            dry_run: true,
            mailbox: OWNER_EMAIL,
            run_kind: gapReconcile ? "gap_reconciliation_dry_run" : "scheduled_incremental_poll_dry_run",
            scan_start_at: new Date(lastScanTimeMs).toISOString(),
            last_gmail_scan_at: completedAt,
            messages_discovered: messageIds.length,
            proposed_changes_count: proposedChanges.length,
            proposed_reviews_count: proposedReviews.length,
            duplicate_messages_count: duplicateCount,
            ignored_messages_count: ignoredMessageIds.length,
            proposed_changes: proposedChanges,
          })}::jsonb
        )
      `;

      const result: SyncRunResult = {
        runId,
        status: "dry_run_completed",
        mailbox: OWNER_EMAIL,
        dryRun: true,
        gapReconciled: gapReconcile,
        scanStartAt: new Date(lastScanTimeMs).toISOString(),
        scanEndAt: completedAt,
        messagesFound: messageIds.length,
        messagesClassified: proposedChanges.length + proposedReviews.length,
        statusChangesConfirmed: proposedChanges.length,
        reviewItemsQueued: proposedReviews.length,
        duplicateMessagesSkipped: duplicateCount,
        ignoredMessages: ignoredMessageIds,
        errors: [],
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
      };

      return json(result, 200);
    }

    // 10. LIVE WRITES (Only executes when dry_run = false)
    for (const change of proposedChanges) {
      // Record immutable event in application_events
      await sql`
        insert into jobbot.application_events (
          id, application_id, event_type, previous_status, new_status,
          event_at, evidence_source, external_event_id, actor, verification_status, notes
        ) values (
          ${crypto.randomUUID()}::uuid,
          ${change.applicationId}::uuid,
          'hiring_stage_change',
          ${change.previousStage},
          ${change.newStage},
          now(),
          'gmail',
          ${`gmail-status:${OWNER_EMAIL}:${change.messageId}`},
          'bot',
          'verified',
          ${JSON.stringify({
            kind: "stage_change",
            mailbox: OWNER_EMAIL,
            message_id: change.messageId,
            quote: change.quote,
            ingested_at: completedAt,
          })}
        )
      `;

      // Update application hiring stage
      await sql`
        update jobbot.job_applications
           set hiring_stage = ${change.newStage},
               updated_at = now()
         where id = ${change.applicationId}::uuid
      `;
    }

    // Insert ambiguous matches into recruitment_review_items
    for (const review of proposedReviews) {
      await sql`
        insert into jobbot.recruitment_review_items (
          id, mailbox, message_id, thread_id, event_at,
          reason_code, proposed_stage, candidate_applications,
          evidence_summary, state, created_at, updated_at
        ) values (
          ${crypto.randomUUID()}::uuid,
          ${review.mailbox},
          ${review.messageId},
          ${review.threadId},
          ${review.eventAt}::timestamptz,
          ${review.reasonCode},
          ${review.proposedStage},
          ${JSON.stringify(review.candidateApplications)}::jsonb,
          ${review.evidenceSummary},
          'open',
          now(),
          now()
        )
        on conflict do nothing
      `;
    }

    // Log live completed run
    await sql`
      insert into jobbot.sync_logs (
        run_id, bot_name, started_at, completed_at,
        created_count, updated_count, skipped_count,
        errors, verification_results
      ) values (
        ${runId}::uuid, ${BOT_NAME}, ${startedAt}::timestamptz, ${completedAt}::timestamptz,
        ${0}, ${proposedChanges.length}, ${duplicateCount + ignoredMessageIds.length},
        ${JSON.stringify([])}::jsonb,
        ${JSON.stringify({
          status: "completed",
          dry_run: false,
          mailbox: OWNER_EMAIL,
          run_kind: gapReconcile ? "gap_reconciliation" : "scheduled_incremental_poll",
          scan_start_at: new Date(lastScanTimeMs).toISOString(),
          last_gmail_scan_at: completedAt,
          messages_discovered: messageIds.length,
          updated_count: proposedChanges.length,
          review_queued_count: proposedReviews.length,
          latest_successful_database_write_at: completedAt,
        })}::jsonb
      )
    `;

    return json({
      runId,
      status: "sync_succeeded",
      dryRun: false,
      updated: proposedChanges.length,
      reviewsQueued: proposedReviews.length,
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
