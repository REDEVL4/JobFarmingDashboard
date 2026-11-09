/**
 * Type definitions for Supabase Edge Function: gmail-status-sync
 * Enforces strict typing for Gmail API interactions, recruitment classification,
 * application matching, and telemetry logging.
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

export interface SyncRunOptions {
  dryRun: boolean;
  gapReconciliation: boolean;
  maxMessages?: number;
  scanFromTimestamp?: string;
}

export interface SyncRunResult {
  runId: string;
  status: "dry_run_completed" | "sync_succeeded" | "failed" | "source_unavailable";
  mailbox: string;
  dryRun: boolean;
  gapReconciled: boolean;
  scanStartAt: string;
  scanEndAt: string;
  messagesFound: number;
  messagesClassified: number;
  statusChangesConfirmed: number;
  reviewItemsQueued: number;
  duplicateMessagesSkipped: number;
  ignoredMessages: string[];
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
  };
}
