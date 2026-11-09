/**
 * Type definitions for Supabase Edge Function: gmail-status-sync
 * Enforces strict typing for Gmail API interactions, recruitment classification,
 * application matching, telemetry logging, and durable processing queue.
 */

export type CanonicalHiringStage =
  | "Applied Confirmed"
  | "Under Review"
  | "Assessment Requested"
  | "Interview Scheduled"
  | "Offer Received"
  | "Rejected"
  | "Withdrawn";

export type ReviewReasonCode =
  | "sender_employer_mapping_unverified"
  | "role_less_specific_than_application"
  | "assessment_without_role_identifier"
  | "missing_role_and_unclear_outcome"
  | "multiple_candidate_applications"
  | "ambiguous_outcome";

export type QueueProcessingStatus =
  | "pending"
  | "pending_fetch"
  | "claimed"
  | "completed"
  | "failed"
  | "skipped"
  | "excluded";

export type ExecutionMode =
  | "diagnostic_dry_run"
  | "ingestion_only"
  | "live_updates";

export type QueueReviewStatus =
  | "pending"
  | "requires_review"
  | "auto_approved"
  | "user_approved"
  | "user_rejected"
  | "ignored";

export interface GmailMessageHeader {
  name: string;
  value: string;
}

export interface GmailMessageSummary {
  id: string;
  threadId: string;
  internalDate: string;
  snippet: string;
  headers: Record<string, string>;
  from: string;
  subject: string;
  date: string;
  messageIdHeader?: string;
  references?: string;
  inReplyTo?: string;
  bodyText?: string;
}

export interface ClassificationResult {
  isRecruitment: boolean;
  stage: CanonicalHiringStage | null;
  confidence: number;
  evidenceSummary: string;
  quote?: string;
  assessmentDetails?: {
    type?: string;
    deadlineText?: string;
    deadlineAt?: string | null;
  };
  requiresReview: boolean;
  reasonCode?: ReviewReasonCode;
  actionItems: string[];
}

export interface CandidateApplication {
  id: string;
  company: string;
  job_title: string;
  requisition_id?: string | null;
  confirmation_email_ref?: string | null;
  hiring_stage?: string | null;
  application_status?: string | null;
  applied_at?: string | null;
}

export interface MatchResult {
  matched: boolean;
  confidence: number;
  matchBasis?: string;
  matchedApplication?: CandidateApplication;
  ambiguous: boolean;
  candidateApplications?: CandidateApplication[];
  reasonCode?: ReviewReasonCode;
}

export interface GmailQueueItem {
  id?: string;
  owner_id: string;
  mailbox: string;
  message_id: string;
  thread_id?: string | null;
  message_timestamp: string;
  history_id?: string | null;
  processing_status: QueueProcessingStatus;
  content_hash: string;
  subject_clean?: string | null;
  sender_clean?: string | null;
  attempt_count: number;
  max_attempts: number;
  lease_token?: string | null;
  lease_expires_at?: string | null;
  last_attempted_at?: string | null;
  error_details?: any;
  analysis_version?: string | null;
  classification_result?: any;
  proposed_application_match?: any;
  evidence_references?: any;
  review_status: QueueReviewStatus;
  exclusion_reason?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface IngestionCheckpoint {
  checkpoint_type: "gmail_ingestion";
  mailbox: string;
  last_history_id?: string | null;
  last_message_timestamp?: string | null;
  last_scan_at: string;
  sync_strategy: "history" | "query_full" | "gap_reconciliation";
  has_more_backlog: boolean;
  continuation_strategy?: "history" | "query_full" | "gap_reconciliation";
  continuation_before_epoch?: number | null;
  continuation_after_epoch?: number | null;
  continuation_ceiling_time?: string | null;
  continuation_page_token?: string | null;
  last_consumed_history_record_id?: string | null;
}

export interface AnalysisCheckpoint {
  checkpoint_type: "ai_analysis";
  mailbox: string;
  last_processed_queue_id?: string | null;
  last_analysis_at: string;
  items_completed: number;
  items_pending: number;
  items_failed: number;
}

export interface SensitiveCheckResult {
  isSensitive: boolean;
  reason?: "sensitive_security_otp" | "sensitive_password_reset" | "sensitive_security_alert" | "sensitive_auth_code";
}

export interface SyncRunOptions {
  dryRun: boolean;
  gapReconciliation: boolean;
  maxMessages?: number;
  scanFromTimestamp?: string;
  startHistoryId?: string;
}

export interface SyncRunResult {
  runId: string;
  status: "dry_run_completed" | "sync_succeeded" | "failed" | "source_unavailable" | "partial_backfill_succeeded";
  mailbox: string;
  dryRun: boolean;
  executionMode?: ExecutionMode;
  gateLockedReason?: string;
  gapReconciled: boolean;
  syncStrategy?: "history" | "query_full" | "gap_reconciliation";
  startHistoryId?: string | null;
  latestHistoryId?: string | null;
  startHistorySnapshot?: string | null;
  scanStartAt: string;
  scanEndAt: string;
  messagesFound: number;
  messagesEnqueued?: number;
  messagesExcludedSensitive?: number;
  legacyReconciled?: number;
  messagesClassified: number;
  statusChangesConfirmed: number;
  reviewItemsQueued: number;
  duplicateMessagesSkipped: number;
  ignoredMessages: string[];
  checkpointAdvanced: boolean;
  hasMoreBacklog?: boolean;
  continuationStrategy?: "history" | "query_full" | "gap_reconciliation";
  lastConsumedHistoryRecordId?: string | null;
  continuation?: {
    strategy?: "history" | "query_full" | "gap_reconciliation";
    beforeEpoch?: number | null;
    afterEpoch?: number | null;
    ceilingTime?: string | null;
    pageToken?: string | null;
    lastConsumedHistoryRecordId?: string | null;
  } | null;
  errors: Array<{ code: string; detail?: string }>;
  details?: {
    proposedChanges: Array<{
      applicationId: string;
      company: string;
      jobTitle: string;
      previousStage: string | null;
      newStage: string;
      messageId: string;
      quote?: string;
    }>;
    proposedReviews: Array<{
      mailbox: string;
      messageId: string;
      reasonCode: ReviewReasonCode;
      proposedStage: string | null;
      evidenceSummary: string;
      candidateCount: number;
    }>;
    excludedSensitiveMessages?: Array<{
      messageId: string;
      reason: string;
    }>;
  };
}
