/**
 * Continuation and Backfill Management for Gmail Monitoring Service
 * 
 * Invariants:
 * 1. An incomplete backfill (hasMoreBacklog=true) MUST NEVER create a production
 *    sync log that advances the processing checkpoint past unprocessed messages.
 * 2. In an atomic live-write transaction, an application's hiring stage must be updated
 *    ONLY IF the corresponding Gmail event was actually inserted.
 */

export interface ScanWindow {
  queryAfterEpoch: number;
  queryBeforeEpoch: number | null;
  isResumingBackfill: boolean;
  continuationCeilingTime: string | null;
}

export interface ContinuationState {
  hasMoreBacklog: boolean;
  allPagesComplete: boolean;
  checkpointAdvanced: boolean;
  status: "completed" | "partial_backfill" | "dry_run_completed" | "dry_run_partial_backfill";
  nextContinuationBeforeEpoch: number | null;
  nextContinuationAfterEpoch: number | null;
  nextContinuationCeilingTime: string | null;
  effectiveCheckpointTime: string | null;
}

/**
 * Resolves the query window for Gmail scanning, taking into account unfinished
 * backfills and ensuring dry-run logs never advance checkpoints.
 */
export function resolveScanWindow(params: {
  latestProductionLog?: {
    started_at?: string;
    completed_at?: string;
    verification_results?: any;
  } | null;
  gapReconcile?: boolean;
  lastVerifiedCheckpoint: string;
  overlapMinutes: number;
  bodyBeforeEpoch?: number | null;
  bodyAfterEpoch?: number | null;
}): ScanWindow {
  const {
    latestProductionLog,
    gapReconcile,
    lastVerifiedCheckpoint,
    overlapMinutes,
    bodyBeforeEpoch,
    bodyAfterEpoch,
  } = params;

  // 1. Explicit request parameters override if provided
  if (bodyAfterEpoch !== undefined && bodyAfterEpoch !== null) {
    return {
      queryAfterEpoch: bodyAfterEpoch,
      queryBeforeEpoch: bodyBeforeEpoch || null,
      isResumingBackfill: Boolean(bodyBeforeEpoch),
      continuationCeilingTime: null,
    };
  }

  // 2. Gap reconciliation starts strictly from last verified checkpoint
  if (gapReconcile) {
    const lastScanMs = new Date(lastVerifiedCheckpoint).getTime() - overlapMinutes * 60_000;
    return {
      queryAfterEpoch: Math.floor(lastScanMs / 1000),
      queryBeforeEpoch: null,
      isResumingBackfill: false,
      continuationCeilingTime: null,
    };
  }

  // 3. Inspect the latest production log for an incomplete backfill
  let vResults = latestProductionLog?.verification_results || {};
  if (typeof vResults === "string") {
    try {
      vResults = JSON.parse(vResults);
    } catch {
      vResults = {};
    }
  }
  const isBacklogUnfinished =
    vResults.status === "partial_backfill" ||
    vResults.has_more_backlog === true ||
    vResults.checkpoint_advanced === false;

  if (isBacklogUnfinished && vResults.continuation_before_epoch && vResults.continuation_after_epoch) {
    // Durable backfill continuation: scan older remaining window
    return {
      queryAfterEpoch: Number(vResults.continuation_after_epoch),
      queryBeforeEpoch: Number(vResults.continuation_before_epoch),
      isResumingBackfill: true,
      continuationCeilingTime: vResults.continuation_ceiling_time || latestProductionLog?.completed_at || null,
    };
  }

  // 4. Standard poll from latest completed checkpoint
  let baseTimestamp = lastVerifiedCheckpoint;
  if (
    latestProductionLog?.completed_at &&
    vResults.status === "completed" &&
    !vResults.dry_run &&
    vResults.checkpoint_advanced !== false &&
    !vResults.has_more_backlog
  ) {
    baseTimestamp = latestProductionLog.completed_at;
  }

  const lastScanMs = new Date(baseTimestamp).getTime() - overlapMinutes * 60_000;
  return {
    queryAfterEpoch: Math.floor(lastScanMs / 1000),
    queryBeforeEpoch: null,
    isResumingBackfill: false,
    continuationCeilingTime: null,
  };
}

/**
 * Computes continuation state and checkpoint advancement safety metrics.
 */
export function computeContinuationState(params: {
  rawMessageCount: number;
  maxMessages: number;
  hasRemainingPageToken: boolean;
  minInternalDate?: number;
  queryAfterEpoch: number;
  isResumingBackfill: boolean;
  continuationCeilingTime?: string | null;
  startedAt: string;
  completedAt: string;
  dryRun: boolean;
}): ContinuationState {
  const {
    rawMessageCount,
    maxMessages,
    hasRemainingPageToken,
    minInternalDate,
    queryAfterEpoch,
    isResumingBackfill,
    continuationCeilingTime,
    startedAt,
    completedAt,
    dryRun,
  } = params;

  const hitMessageLimit = rawMessageCount >= maxMessages;
  const hasMoreBacklog = hasRemainingPageToken || hitMessageLimit;

  if (hasMoreBacklog) {
    // Backlog incomplete: checkpoint must NOT advance past unprocessed messages!
    const effectiveMinDate = minInternalDate && minInternalDate > 0
      ? minInternalDate
      : queryAfterEpoch * 1000;
    
    // In Gmail API, messages are returned newest first.
    // The unprocessed portion lies before the oldest message fetched in this run.
    const nextBeforeEpoch = Math.floor(effectiveMinDate / 1000) + 1;

    return {
      hasMoreBacklog: true,
      allPagesComplete: false,
      checkpointAdvanced: false,
      status: dryRun ? "dry_run_partial_backfill" : "partial_backfill",
      nextContinuationBeforeEpoch: nextBeforeEpoch,
      nextContinuationAfterEpoch: queryAfterEpoch,
      nextContinuationCeilingTime: continuationCeilingTime || startedAt,
      effectiveCheckpointTime: null, // DO NOT advance checkpoint
    };
  }

  // All pages complete in this scan window
  const effectiveCheckpointTime = isResumingBackfill
    ? (continuationCeilingTime || completedAt)
    : completedAt;

  return {
    hasMoreBacklog: false,
    allPagesComplete: true,
    checkpointAdvanced: !dryRun,
    status: dryRun ? "dry_run_completed" : "completed",
    nextContinuationBeforeEpoch: null,
    nextContinuationAfterEpoch: null,
    nextContinuationCeilingTime: null,
    effectiveCheckpointTime: dryRun ? null : effectiveCheckpointTime,
  };
}

/**
 * Evaluates whether an atomic stage update is permitted based on event insertion.
 * Invariant: An application's hiring stage must be updated ONLY if the corresponding
 * Gmail event was actually inserted. If the event is a duplicate, do not update.
 */
export function filterAtomicStageUpdates(params: {
  proposedChanges: Array<{
    applicationId: string;
    company: string;
    jobTitle: string;
    previousStage: string | null;
    newStage: string;
    messageId: string;
    internalDate: number;
    quote?: string;
  }>;
  existingExternalEventIds: Set<string>;
  mailbox: string;
}): {
  toInsertEvents: Array<{
    externalEventId: string;
    applicationId: string;
    newStage: string;
    previousStage: string | null;
    internalDate: number;
    quote?: string;
  }>;
  applicationsToUpdate: Array<{
    applicationId: string;
    newStage: string;
  }>;
  duplicateDeliveriesSkipped: number;
} {
  const { proposedChanges, existingExternalEventIds, mailbox } = params;

  const toInsertEvents = [];
  const applicationsToUpdate = [];
  let duplicateDeliveriesSkipped = 0;

  for (const change of proposedChanges) {
    const externalEventId = `gmail-status:${mailbox}:${change.messageId}`;

    if (existingExternalEventIds.has(externalEventId)) {
      // Event already exists! Duplicate delivery detected.
      // MUST NOT update the application's hiring stage.
      duplicateDeliveriesSkipped++;
      continue;
    }

    // Event is new: insert event AND update application stage
    existingExternalEventIds.add(externalEventId);
    toInsertEvents.push({
      externalEventId,
      applicationId: change.applicationId,
      newStage: change.newStage,
      previousStage: change.previousStage,
      internalDate: change.internalDate,
      quote: change.quote,
    });

    applicationsToUpdate.push({
      applicationId: change.applicationId,
      newStage: change.newStage,
    });
  }

  return {
    toInsertEvents,
    applicationsToUpdate,
    duplicateDeliveriesSkipped,
  };
}

