/**
 * Database definitions for the Supabase `jobbot` schema.
 * Source of truth: Supabase PostgreSQL database tables in schema `jobbot`.
 */

export interface DbJobOpportunity {
  id: string;
  company: string;
  job_title: string;
  requisition_id?: string | null;
  posting_url?: string | null;
  application_url?: string | null;
  job_description?: string | null;
  jd_ref?: string | null;
  date_posted?: string | null;
  date_discovered: string;
  location?: string | null;
  work_mode?: "remote" | "hybrid" | "onsite" | string | null;
  employment_type?: "full_time" | "contract" | "internship" | string | null;
  hire_type?: string | null;
  salary_text?: string | null;
  fit_score?: number | null;
  fit_explanation?: string | null;
  discovery_source?: string | null;
  processing_status: string;
  external_key: string;
  created_at: string;
  updated_at: string;
}

export interface DbJobApplication {
  id: string;
  opportunity_id?: string;
  company?: string;
  job_title?: string;
  requisition_id?: string | null;
  posting_url?: string | null;
  application_url?: string | null;
  resume_version?: string | null;
  cover_letter_version?: string | null;
  applied_at?: string | null;
  timezone?: string;
  application_status?: string; // 'Applied Confirmed', 'Reported Submitted', 'Submitted Unverified', etc.
  status?: string; // tracker alias
  user_approval_status?: string;
  user_approval_at?: string | null;
  submission_evidence?: string | null;
  confirmation_id?: string | null;
  confirmation_email_ref?: string | null;
  hiring_stage?: string | null; // null, 'Rejected', 'Assessment Requested', 'Interview', 'Offer'
  notes?: string | null;
  verification_status?: string;
  verification_source?: string | null;
  verified_at?: string | null;
  original_tracker_status?: string | null;
  resume_document_id?: string | null;
  cover_letter_document_id?: string | null;
  recruiter_name?: string | null;
  recruiter_email?: string | null;
  score?: number | string | null;
  role?: string;
  source_apply_mode?: string;
  follow_up_at?: string | null;
  timeline_json?: any;
  job?: any;
  jobs?: any;
  created_at: string;
  updated_at: string;

  // Joined opportunity
  job_opportunities?: DbJobOpportunity | null;
}

export interface DbApplicationEvent {
  id: string;
  application_id: string;
  event_type: "status_change" | "submission_confirmation_observed" | "hiring_stage_change" | "recruitment_update" | string;
  previous_status?: string | null;
  new_status?: string | null;
  event_at?: string | null;
  evidence_source?: string | null;
  external_event_id?: string | null;
  actor: string;
  verification_status?: string | null;
  notes?: string | null;
}

export interface DbApplicationDocument {
  id: string;
  application_id?: string | null;
  opportunity_external_key?: string | null;
  doc_type: "resume" | "cover_letter" | "portfolio" | "other" | string;
  storage_path?: string | null;
  original_filename?: string | null;
  content_sha256?: string | null;
  byte_size?: number | null;
  mime_type?: string | null;
  source_local_path?: string | null;
  created_at: string;
  doc_version?: string | null;
  upload_status: string;
  uploaded_at?: string | null;
  upload_verified_at?: string | null;
  master_base_ref?: string | null;
  is_editable_source: boolean;
}

export interface DbRecruitmentReviewItem {
  id: string;
  mailbox: string;
  message_id: string;
  thread_id: string;
  event_at?: string | null;
  reason_code: string;
  proposed_stage?: string | null;
  candidate_applications: any;
  evidence_summary: string;
  state: "open" | "resolved" | "dismissed" | string;
  resolved_application_id?: string | null;
  reviewed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbOutreachContact {
  id: string;
  owner_id?: string;
  full_name?: string;
  name?: string;
  company?: string | null;
  professional_title?: string | null;
  role?: string | null;
  category?: "recruiter" | "hiring_manager" | "peer" | "founder" | "other" | string;
  contact_type?: "recruiter" | "hiring_manager" | "peer" | "founder" | "other" | string;
  linkedin_url?: string | null;
  team_affiliation?: string | null;
  team_verification?: string | null;
  relevance_score?: number | null;
  score?: number | null;
  technical_overlap?: string | null;
  personalization_context?: string | null;
  connection_note?: string | null;
  follow_up_note?: string | null;
  application_id?: string | null;
  matched_application_id?: string | null;
  opportunity_id?: string | null;
  connection_stage?: string;
  status?: "research" | "draft_pending_approval" | "approved" | "sent" | "connected" | "in_conversation" | "rejected" | "postponed" | string;
  reply_state?: string;
  priority?: "high" | "medium" | "low" | string;
  last_interaction_at?: string | null;
  next_action?: string | null;
  follow_up_at?: string | null;
  notes?: string | null;
  evidence_source?: string | null;
  last_verified_at?: string | null;
  do_not_contact?: boolean;
  created_at: string;
  updated_at: string;
}

export interface DbSyncLogVerificationResults {
  status?: string;
  mailbox?: string;
  run_kind?: string;
  scan_start_at?: string;
  last_gmail_scan_at?: string;
  full_scan_cutoff_at?: string;
  ignored_message_ids?: string[];
  processed_message_ids?: string[];
  unresolved_review_count?: number;
  latest_successful_database_write_at?: string;
  proposed_changes_count?: number;
  dry_run?: boolean;
}

export interface DbSyncLog {
  run_id: string;
  bot_name: string;
  started_at: string;
  completed_at?: string | null;
  created_count: number;
  updated_count: number;
  skipped_count: number;
  errors: any;
  verification_results: DbSyncLogVerificationResults | any;
}

export interface DbMonitorSettings {
  id: string;
  owner_id: string;
  enabled: boolean;
  paused: boolean;
  interval_minutes: number;
  last_run_at?: string | null;
  next_run_at?: string | null;
  ai_dispatch_enabled: boolean;
  updated_at: string;
}

// Compatibility aliases for dashboard view models
export type DbJob = DbJobOpportunity;
export type DbApplication = DbJobApplication;

export interface DbEmailEvent {
  id: string;
  gmail_message_id?: string;
  thread_id?: string | null;
  from_email?: string;
  sender?: string;
  subject: string;
  snippet?: string | null;
  body_excerpt?: string | null;
  received_at?: string;
  receivedAt?: string;
  classification?: "interview" | "rejection" | "assessment" | "offer" | "acknowledgement" | "needs_review" | string;
  confidence?: number | null;
  matched_job_id?: string | null;
  matched_application_id?: string | null;
  action_taken?: string | null;
  actionTaken?: string | null;
  created_at?: string;
  evidence_summary?: string;
  proposed_stage?: string | null;
  candidate_applications?: any[];
  state?: "open" | "resolved" | "ignored" | string;
  reason_code?: string;
}

