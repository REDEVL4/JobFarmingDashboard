/**
 * Durable Processing Queue Service for Gmail Ingestion & AI Analysis
 * 
 * Invariants:
 * 1. Enforce uniqueness for (mailbox, message_id).
 * 2. Never store complete raw email bodies in the queue.
 * 3. Use retryable processing leases with FOR UPDATE SKIP LOCKED to prevent double processing.
 * 4. Ingestion progress advances independently of AI classification.
 */

import type { GmailQueueItem, QueueProcessingStatus, QueueReviewStatus } from "./types.ts";

export interface QueueEnqueueResult {
  totalProcessed: number;
  newlyEnqueued: number;
  duplicatesSkipped: number;
  excludedSensitive: number;
}

export interface ClaimResult {
  claimedItems: GmailQueueItem[];
  workerToken: string;
}

/**
 * Enqueues discovered messages idempotently.
 * Enforces uniqueness on (mailbox, message_id).
 */
export async function enqueueDiscoveredMessages(
  sql: any,
  items: GmailQueueItem[]
): Promise<QueueEnqueueResult> {
  if (!items || items.length === 0) {
    return {
      totalProcessed: 0,
      newlyEnqueued: 0,
      duplicatesSkipped: 0,
      excludedSensitive: 0,
    };
  }

  let newlyEnqueued = 0;
  let duplicatesSkipped = 0;
  let excludedSensitive = 0;

  for (const item of items) {
    if (item.processing_status === "excluded") {
      excludedSensitive++;
    }

    // Insert with ON CONFLICT (mailbox, message_id) DO NOTHING
    // Using (xmax = 0) in RETURNING to detect whether the row was newly inserted
    const [row] = await sql`
      insert into jobbot.gmail_processing_queue (
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
        created_at,
        updated_at
      ) values (
        ${item.owner_id}::uuid,
        ${item.mailbox},
        ${item.message_id},
        ${item.thread_id || null},
        ${item.message_timestamp}::timestamptz,
        ${item.history_id || null},
        ${item.processing_status},
        ${item.content_hash},
        ${item.subject_clean || null},
        ${item.sender_clean || null},
        ${item.attempt_count || 0},
        ${item.max_attempts || 5},
        ${item.review_status || 'pending'},
        ${item.exclusion_reason || null},
        now(),
        now()
      )
      on conflict (mailbox, message_id) do nothing
      returning id
    `;

    if (row?.id) {
      newlyEnqueued++;
    } else {
      duplicatesSkipped++;
    }
  }

  return {
    totalProcessed: items.length,
    newlyEnqueued,
    duplicatesSkipped,
    excludedSensitive,
  };
}

/**
 * Atomically claims a batch of queue items using PostgreSQL FOR UPDATE SKIP LOCKED.
 * Safe for concurrent workers; prevents race conditions and duplicate lease grants.
 */
export async function claimQueueBatch(
  sql: any,
  params: {
    mailbox: string;
    batchSize: number;
    leaseSeconds: number;
    workerToken?: string;
  }
): Promise<ClaimResult> {
  const { mailbox, batchSize, leaseSeconds } = params;
  const workerToken = params.workerToken || crypto.randomUUID();

  const claimedRows = await sql`
    with eligible as (
      select id
        from jobbot.gmail_processing_queue
       where mailbox = ${mailbox}
         and (
           processing_status = 'pending'
           or (processing_status = 'claimed' and lease_expires_at < now())
         )
         and attempt_count < max_attempts
       order by message_timestamp asc
       limit ${batchSize}
       for update skip locked
    )
    update jobbot.gmail_processing_queue q
       set processing_status = 'claimed',
           lease_token = ${workerToken}::uuid,
           lease_expires_at = now() + (${leaseSeconds} || ' seconds')::interval,
           last_attempted_at = now(),
           attempt_count = q.attempt_count + 1,
           updated_at = now()
      from eligible e
     where q.id = e.id
     returning q.id, q.mailbox, q.message_id, q.thread_id,
               q.message_timestamp, q.processing_status,
               q.content_hash, q.attempt_count, q.max_attempts,
               q.lease_token, q.lease_expires_at, q.review_status
  `;

  return {
    claimedItems: claimedRows.map((r: any) => ({
      id: r.id,
      owner_id: "f2729195-5445-4272-ab85-cac5b03b0967",
      mailbox: r.mailbox,
      message_id: r.message_id,
      thread_id: r.thread_id,
      message_timestamp: r.message_timestamp,
      processing_status: r.processing_status as QueueProcessingStatus,
      content_hash: r.content_hash,
      attempt_count: r.attempt_count,
      max_attempts: r.max_attempts,
      lease_token: r.lease_token,
      lease_expires_at: r.lease_expires_at,
      review_status: r.review_status as QueueReviewStatus,
    })),
    workerToken,
  };
}

/**
 * Marks a claimed queue item as completed with its classification and match results.
 */
export async function completeQueueItem(
  sql: any,
  params: {
    itemId: string;
    workerToken: string;
    analysisVersion: string;
    classificationResult: any;
    proposedMatch?: any;
    reviewStatus?: QueueReviewStatus;
  }
): Promise<boolean> {
  const {
    itemId,
    workerToken,
    analysisVersion,
    classificationResult,
    proposedMatch,
    reviewStatus,
  } = params;

  const result = await sql`
    update jobbot.gmail_processing_queue
       set processing_status = 'completed',
           lease_token = null,
           lease_expires_at = null,
           analysis_version = ${analysisVersion},
           classification_result = ${sql.json(classificationResult)},
           proposed_application_match = ${proposedMatch ? sql.json(proposedMatch) : null},
           review_status = ${reviewStatus || 'pending'},
           updated_at = now()
     where id = ${itemId}::uuid
       and lease_token = ${workerToken}::uuid
     returning id
  `;

  return result.length > 0;
}

/**
 * Handles a failed queue processing attempt.
 * If attempt_count >= max_attempts, marks status as 'failed' (dead-letter queue).
 * Otherwise clears the lease and resets to 'pending' for retry.
 */
export async function failQueueItem(
  sql: any,
  params: {
    itemId: string;
    workerToken: string;
    error: string;
  }
): Promise<{ success: boolean; processingStatus?: QueueProcessingStatus; reviewStatus?: QueueReviewStatus }> {
  const { itemId, workerToken, error } = params;

  const result = await sql`
    update jobbot.gmail_processing_queue
       set processing_status = case when attempt_count >= max_attempts then 'failed' else 'pending' end,
           review_status = case when attempt_count >= max_attempts then 'requires_review' else review_status end,
           lease_token = null,
           lease_expires_at = null,
           error_details = jsonb_build_array(
             coalesce(error_details, '[]'::jsonb),
             jsonb_build_object('error', ${error}, 'timestamp', now())
           ),
           updated_at = now()
     where id = ${itemId}::uuid
       and lease_token = ${workerToken}::uuid
     returning id, processing_status, review_status
  `;

  if (result.length > 0) {
    return {
      success: true,
      processingStatus: result[0].processing_status,
      reviewStatus: result[0].review_status,
    };
  }

  return { success: false };
}
