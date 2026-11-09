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
  startHistoryId?: string | null;
  syncStrategy?: "history" | "query_full" | "gap_reconciliation";
}

export interface ContinuationState {
  hasMoreBacklog: boolean;
  allPagesComplete: boolean;
  checkpointAdvanced: boolean;
  status: "completed" | "partial_backfill" | "dry_run_completed" | "dry_run_partial_backfill";
  continuationStrategy: "history" | "query_full" | "gap_reconciliation";
  nextContinuationBeforeEpoch: number | null;
  nextContinuationAfterEpoch: number | null;
  nextContinuationCeilingTime: string | null;
  effectiveCheckpointTime: string | null;
  lastConsumedHistoryRecordId: string | null;
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
  cursorRecord?: {
    last_history_id?: string | null;
    last_success_at?: string | null;
    last_observed_at?: string | null;
  } | null;
  gapReconcile?: boolean;
  lastVerifiedCheckpoint: string;
  overlapMinutes: number;
  bodyBeforeEpoch?: number | null;
  bodyAfterEpoch?: number | null;
  bodyStartHistoryId?: string | null;
}): ScanWindow {
  const {
    latestProductionLog,
    cursorRecord,
    gapReconcile,
    lastVerifiedCheckpoint,
    overlapMinutes,
    bodyBeforeEpoch,
    bodyAfterEpoch,
    bodyStartHistoryId,
  } = params;

  // 1. Explicit request parameters override if provided
  if (bodyAfterEpoch !== undefined && bodyAfterEpoch !== null) {
    return {
      queryAfterEpoch: bodyAfterEpoch,
      queryBeforeEpoch: bodyBeforeEpoch || null,
      isResumingBackfill: Boolean(bodyBeforeEpoch),
      continuationCeilingTime: null,
      startHistoryId: bodyStartHistoryId || null,
      syncStrategy: bodyStartHistoryId && !bodyBeforeEpoch ? "history" : "query_full",
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
      startHistoryId: null, // Force full scan for reconciliation
      syncStrategy: "gap_reconciliation",
    };
  }

  // 3. Inspect the latest production log for an incomplete backfill or partial history scan
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
    vResults.status === "dry_run_partial_backfill" ||
    vResults.has_more_backlog === true ||
    vResults.checkpoint_advanced === false;

  const unfinishedStrategy =
    vResults.continuation_strategy ||
    vResults.sync_strategy ||
    (vResults.last_consumed_history_record_id ? "history" : (vResults.continuation_before_epoch ? "query_full" : undefined));

  if (isBacklogUnfinished) {
    // 3A. Unfinished Gmail History API scan: MUST resume using last safely consumed history record ID!
    // Invariant: Never interpret a partial History API scan as a timestamp-based full-search backfill.
    if (unfinishedStrategy === "history") {
      const safeHistoryId =
        bodyStartHistoryId ||
        cursorRecord?.last_history_id ||
        vResults.last_consumed_history_record_id ||
        vResults.latest_history_id ||
        vResults.start_history_id ||
        null;

      // Base timestamp for fallback if history is expired
      const baseTimestamp = cursorRecord?.last_success_at || latestProductionLog?.completed_at || lastVerifiedCheckpoint;
      const lastScanMs = new Date(baseTimestamp).getTime() - overlapMinutes * 60_000;

      return {
        queryAfterEpoch: Math.floor(lastScanMs / 1000),
        queryBeforeEpoch: null,
        isResumingBackfill: false, // Strictly false: this is History API continuation, NOT full-search backfill!
        continuationCeilingTime: null,
        startHistoryId: safeHistoryId,
        syncStrategy: "history",
      };
    }

    // 3B. Unfinished Full-Search Backfill: resume the outstanding time window
    if (vResults.continuation_before_epoch && vResults.continuation_after_epoch) {
      const snapshotHistoryId = vResults.start_history_snapshot || vResults.latest_history_id || vResults.history_id || null;
      const latestHistoryId = bodyStartHistoryId || snapshotHistoryId;

      return {
        queryAfterEpoch: Number(vResults.continuation_after_epoch),
        queryBeforeEpoch: Number(vResults.continuation_before_epoch),
        isResumingBackfill: true,
        continuationCeilingTime: vResults.continuation_ceiling_time || latestProductionLog?.completed_at || null,
        startHistoryId: latestHistoryId,
        syncStrategy: "query_full",
      };
    }
  }

  // 4. Standard poll from dedicated ingestion cursor or latest completed checkpoint
  let baseTimestamp = lastVerifiedCheckpoint;
  if (cursorRecord?.last_success_at) {
    baseTimestamp = cursorRecord.last_success_at;
  } else if (
    latestProductionLog?.completed_at &&
    vResults.status === "completed" &&
    !vResults.dry_run &&
    vResults.checkpoint_advanced !== false &&
    !vResults.has_more_backlog
  ) {
    baseTimestamp = latestProductionLog.completed_at;
  }

  const snapshotHistoryId = vResults.start_history_snapshot || vResults.latest_history_id || vResults.history_id || null;
  const effectiveHistoryId = bodyStartHistoryId || cursorRecord?.last_history_id || snapshotHistoryId;

  const lastScanMs = new Date(baseTimestamp).getTime() - overlapMinutes * 60_000;
  return {
    queryAfterEpoch: Math.floor(lastScanMs / 1000),
    queryBeforeEpoch: null,
    isResumingBackfill: false,
    continuationCeilingTime: null,
    startHistoryId: effectiveHistoryId,
    syncStrategy: effectiveHistoryId ? "history" : "query_full",
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
  isResumingBackfill?: boolean;
  continuationCeilingTime?: string | null;
  startedAt: string;
  completedAt: string;
  dryRun: boolean;
  syncStrategy?: "history" | "query_full" | "gap_reconciliation";
  lastConsumedHistoryRecordId?: string | null;
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
    syncStrategy,
    lastConsumedHistoryRecordId,
  } = params;

  const strategy = syncStrategy || "query_full";
  const hitMessageLimit = rawMessageCount >= maxMessages;
  const hasMoreBacklog = hasRemainingPageToken || hitMessageLimit;

  if (hasMoreBacklog) {
    // Backlog incomplete: checkpoint must NOT advance past unprocessed messages!
    if (strategy === "history") {
      // For History API scans: continuation is history-based, NOT timestamp-based!
      // Invariant: Do not set continuation_before_epoch/after_epoch so unattended runs
      // resume strictly from the last safely processed history record ID.
      return {
        hasMoreBacklog: true,
        allPagesComplete: false,
        checkpointAdvanced: false,
        status: dryRun ? "dry_run_partial_backfill" : "partial_backfill",
        continuationStrategy: "history",
        nextContinuationBeforeEpoch: null,
        nextContinuationAfterEpoch: null,
        nextContinuationCeilingTime: null,
        effectiveCheckpointTime: null, // DO NOT advance checkpoint
        lastConsumedHistoryRecordId: lastConsumedHistoryRecordId || null,
      };
    }

    // For Full-Search backfills (query_full / gap_reconciliation):
    // In Gmail API, messages are returned newest first.
    // The unprocessed portion lies before the oldest message fetched in this run.
    const effectiveMinDate = minInternalDate && minInternalDate > 0
      ? minInternalDate
      : queryAfterEpoch * 1000;
    
    const nextBeforeEpoch = Math.floor(effectiveMinDate / 1000) + 1;

    return {
      hasMoreBacklog: true,
      allPagesComplete: false,
      checkpointAdvanced: false,
      status: dryRun ? "dry_run_partial_backfill" : "partial_backfill",
      continuationStrategy: strategy,
      nextContinuationBeforeEpoch: nextBeforeEpoch,
      nextContinuationAfterEpoch: queryAfterEpoch,
      nextContinuationCeilingTime: continuationCeilingTime || startedAt,
      effectiveCheckpointTime: null, // DO NOT advance checkpoint
      lastConsumedHistoryRecordId: null,
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
    continuationStrategy: strategy,
    nextContinuationBeforeEpoch: null,
    nextContinuationAfterEpoch: null,
    nextContinuationCeilingTime: null,
    effectiveCheckpointTime: dryRun ? null : effectiveCheckpointTime,
    lastConsumedHistoryRecordId: lastConsumedHistoryRecordId || null,
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

