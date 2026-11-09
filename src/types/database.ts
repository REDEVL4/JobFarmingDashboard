/**
 * Database definitions for the Supabase `jobbot` schema.
 * Source of truth: Database migrations, data contract, and runtime logs.
 */

export interface DbJob {
  id: string;
  canonical_fingerprint?: string;
  company_name: string;
  title: string;
  description_raw?: string | null;
  description_clean?: string | null;
  location_text?: string | null;
  country_code?: string | null;
  region?: string | null;
  city?: string | null;
  remote_type?: string | null; // "remote" | "hybrid" | "onsite"
  employment_type?: string | null; // "full-time" | "contract" | "internship"
  experience_level?: string | null;
  salary_min?: number | null;
  salary_max?: number | null;
  salary_currency?: string | null;
  source_primary?: string | null;
  canonical_url?: string | null;
  apply_url?: string | null;
  status?: string;
  posted_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface DbApplication {
  id: string;
  user_id?: string;
  job_id?: string;
  company?: string;
  role?: string;
  score?: number | string | null;
  status: string;
  source_apply_mode?: string;
  applied_at?: string | null;
  follow_up_at?: string | null;
  recruiter_name?: string | null;
  recruiter_email?: string | null;
  notes?: string | null;
  timeline_json?: DbTimelineEvent[] | null;
  resume_id?: string | null;
  cover_letter_id?: string | null;
  created_at: string;
  updated_at: string;
  
  // Joined fields or alternative naming from tracker
  jobs?: DbJob | null;
  job?: DbJob | null;
}

export interface DbTimelineEvent {
  status: string;
  timestamp: string;
  note?: string;
  source?: string;
}

export interface DbApplicationDocument {
  id: string;
  application_id: string;
  doc_type: "resume" | "cover_letter" | "portfolio" | "other";
  storage_key: string;
  format: "pdf" | "docx" | "tex" | "md";
  version_no?: number;
  created_at: string;
}

export interface DbEmailEvent {
  id: string;
  gmail_message_id: string;
  thread_id?: string | null;
  from_email: string;
  subject: string;
  snippet?: string | null;
  body_excerpt?: string | null;
  received_at: string;
  classification?: string; // "interview" | "rejection" | "assessment" | "offer" | "acknowledgement" | "needs_review"
  confidence?: number | null;
  matched_job_id?: string | null;
  matched_application_id?: string | null;
  action_taken?: string | null;
  created_at: string;
}

export interface DbOutreachContact {
  id: string;
  name: string;
  company: string;
  role?: string | null;
  contact_type: "recruiter" | "hiring_manager" | "peer" | "founder" | "other";
  status: "research" | "draft_pending_approval" | "approved" | "sent" | "connected" | "in_conversation" | "rejected" | "postponed";
  score?: number | null;
  phone?: string | null;
  email?: string | null;
  linkedin_url?: string | null;
  connection_note?: string | null;
  follow_up_note?: string | null;
  matched_application_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbAuditLog {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  details_json?: Record<string, unknown> | null;
  created_at: string;
}
