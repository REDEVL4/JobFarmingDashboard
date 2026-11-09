-- Phase 4: verification columns + application documents metadata
-- Keep Phase 3 TEST rows. RLS on. No anon grants.

ALTER TABLE jobbot.job_applications
  ADD COLUMN IF NOT EXISTS verification_source text,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS original_tracker_status text,
  ADD COLUMN IF NOT EXISTS resume_document_id uuid,
  ADD COLUMN IF NOT EXISTS cover_letter_document_id uuid;

COMMENT ON COLUMN jobbot.job_applications.verification_source IS
  'ats_success_screen | browser_execution_trace | portal_application_status | confirmation_id | email_confirmation | bot_reported_only | unverified';
COMMENT ON COLUMN jobbot.job_applications.verification_status IS
  'confirmed | pending | unverified';
COMMENT ON COLUMN jobbot.job_applications.application_status IS
  'Includes Applied Confirmed, Reported Submitted, and workflow statuses';

CREATE TABLE IF NOT EXISTS jobbot.application_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid REFERENCES jobbot.job_applications(id) ON DELETE SET NULL,
  opportunity_external_key text,
  doc_type text NOT NULL,
  storage_path text,
  original_filename text,
  content_sha256 text,
  byte_size bigint,
  mime_type text,
  source_local_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT application_documents_doc_type_check
    CHECK (doc_type IN ('resume', 'cover_letter', 'success_screenshot', 'other'))
);

CREATE INDEX IF NOT EXISTS application_documents_application_idx
  ON jobbot.application_documents (application_id);
CREATE INDEX IF NOT EXISTS application_documents_opp_key_idx
  ON jobbot.application_documents (opportunity_external_key);

ALTER TABLE jobbot.job_applications
  DROP CONSTRAINT IF EXISTS job_applications_resume_document_id_fkey,
  DROP CONSTRAINT IF EXISTS job_applications_cover_letter_document_id_fkey;

ALTER TABLE jobbot.job_applications
  ADD CONSTRAINT job_applications_resume_document_id_fkey
    FOREIGN KEY (resume_document_id) REFERENCES jobbot.application_documents(id) ON DELETE SET NULL,
  ADD CONSTRAINT job_applications_cover_letter_document_id_fkey
    FOREIGN KEY (cover_letter_document_id) REFERENCES jobbot.application_documents(id) ON DELETE SET NULL;

ALTER TABLE jobbot.application_documents ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE jobbot.application_documents FROM anon, authenticated;
GRANT ALL ON TABLE jobbot.application_documents TO service_role;

-- Optional helper: mark which sync pack
COMMENT ON TABLE jobbot.application_documents IS
  'Metadata for resumes/covers/screenshots; files live in private Storage bucket jobbot-application-docs';
;
