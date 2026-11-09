-- Job Bot source-of-truth schema (private; no anon access)
CREATE SCHEMA IF NOT EXISTS jobbot;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- A. Job Opportunities
CREATE TABLE jobbot.job_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company text NOT NULL,
  job_title text NOT NULL,
  requisition_id text,
  posting_url text,
  application_url text,
  job_description text,
  jd_ref text,
  date_posted timestamptz,
  date_discovered timestamptz NOT NULL DEFAULT now(),
  location text,
  work_mode text CHECK (work_mode IS NULL OR work_mode IN ('remote','hybrid','onsite','unknown')),
  employment_type text CHECK (employment_type IS NULL OR employment_type IN ('full_time','contract','cth','internship','other')),
  hire_type text CHECK (hire_type IS NULL OR hire_type IN ('w2','c2c','1099','direct','unknown')),
  salary_text text,
  fit_score numeric,
  fit_explanation text,
  discovery_source text,
  processing_status text NOT NULL DEFAULT 'discovered',
  external_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_opportunities_external_key_unique UNIQUE (external_key),
  CONSTRAINT job_opportunities_posting_url_unique UNIQUE (posting_url)
);

CREATE INDEX job_opportunities_company_req_idx
  ON jobbot.job_opportunities (company, requisition_id);
CREATE INDEX job_opportunities_status_idx
  ON jobbot.job_opportunities (processing_status);

-- B. Job Applications
CREATE TABLE jobbot.job_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL REFERENCES jobbot.job_opportunities(id),
  company text NOT NULL,
  job_title text NOT NULL,
  requisition_id text,
  posting_url text,
  application_url text,
  resume_version text,
  cover_letter_version text,
  applied_at timestamptz,
  timezone text NOT NULL DEFAULT 'America/Chicago',
  application_status text NOT NULL DEFAULT 'Preparing',
  user_approval_status text NOT NULL DEFAULT 'pending',
  user_approval_at timestamptz,
  submission_evidence text,
  confirmation_id text,
  confirmation_email_ref text,
  hiring_stage text,
  notes text,
  verification_status text NOT NULL DEFAULT 'unverified',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_applications_status_check CHECK (application_status IN (
    'Preparing',
    'Form Completed',
    'Awaiting Approval',
    'Submission Pending',
    'Submission Failed',
    'Submitted Unverified',
    'Applied Confirmed'
  )),
  CONSTRAINT job_applications_approval_check CHECK (user_approval_status IN (
    'pending','approved','rejected','auto_timeout'
  )),
  CONSTRAINT job_applications_verification_check CHECK (verification_status IN (
    'unverified','verified','failed'
  ))
);

CREATE INDEX job_applications_opportunity_idx
  ON jobbot.job_applications (opportunity_id);
CREATE INDEX job_applications_status_idx
  ON jobbot.job_applications (application_status);
CREATE INDEX job_applications_company_req_idx
  ON jobbot.job_applications (company, requisition_id);

-- C. Application Events (append-only)
CREATE TABLE jobbot.application_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES jobbot.job_applications(id),
  event_type text NOT NULL,
  previous_status text,
  new_status text,
  event_at timestamptz NOT NULL DEFAULT now(),
  evidence_source text,
  external_event_id text,
  actor text NOT NULL DEFAULT 'bot',
  verification_status text,
  notes text,
  CONSTRAINT application_events_actor_check CHECK (actor IN ('bot','user'))
);

CREATE INDEX application_events_application_idx
  ON jobbot.application_events (application_id, event_at);

-- D. Workflow Assets
CREATE TABLE jobbot.workflow_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_type text NOT NULL,
  name text NOT NULL,
  version int NOT NULL DEFAULT 1,
  content text NOT NULL,
  source_ref text,
  original_timestamp timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workflow_assets_type_check CHECK (asset_type IN (
    'instruction','skill','routine','preference','tailor_rule','convention'
  )),
  CONSTRAINT workflow_assets_name_version_unique UNIQUE (asset_type, name, version)
);

-- E. Sync Logs
CREATE TABLE jobbot.sync_logs (
  run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_name text NOT NULL DEFAULT 'Job Bot',
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_count int NOT NULL DEFAULT 0,
  updated_count int NOT NULL DEFAULT 0,
  skipped_count int NOT NULL DEFAULT 0,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  verification_results jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- RLS: enable; no anon policies (MCP/service access only)
ALTER TABLE jobbot.job_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobbot.job_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobbot.application_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobbot.workflow_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobbot.sync_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON SCHEMA jobbot FROM anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA jobbot FROM anon, authenticated;
GRANT USAGE ON SCHEMA jobbot TO postgres, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA jobbot TO postgres, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA jobbot TO postgres, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA jobbot GRANT ALL ON TABLES TO postgres, service_role;;
