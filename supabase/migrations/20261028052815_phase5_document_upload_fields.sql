-- Add upload verification fields to existing application_documents (no recreate)
ALTER TABLE jobbot.application_documents
  ADD COLUMN IF NOT EXISTS doc_version text,
  ADD COLUMN IF NOT EXISTS upload_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS uploaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS upload_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS master_base_ref text,
  ADD COLUMN IF NOT EXISTS is_editable_source boolean NOT NULL DEFAULT false;

DO $$ BEGIN
  ALTER TABLE jobbot.application_documents
    ADD CONSTRAINT application_documents_upload_status_check
    CHECK (upload_status IN ('pending','uploaded','verified','unavailable'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE jobbot.application_documents
    ADD CONSTRAINT application_documents_doc_type_check
    CHECK (doc_type IN (
      'resume','cover_letter','success_screenshot','other',
      'resume_source','cover_letter_source','master_resume','master_resume_source'
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Widen private bucket mime types for LaTeX/text sources (keep private)
UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'application/pdf',
  'image/png','image/webp','image/jpeg',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'application/x-tex',
  'text/x-tex',
  'application/octet-stream'
]::text[],
    file_size_limit = 52428800
WHERE id = 'jobbot-application-docs';

-- Mark existing metadata rows still awaiting binary upload
UPDATE jobbot.application_documents
SET upload_status = 'pending'
WHERE storage_path IS NULL AND upload_status = 'pending';;
