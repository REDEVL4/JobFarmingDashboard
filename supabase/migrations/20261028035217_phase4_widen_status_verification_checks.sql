-- Allow Reported Submitted + multi-evidence verification statuses
ALTER TABLE jobbot.job_applications
  DROP CONSTRAINT IF EXISTS job_applications_status_check;

ALTER TABLE jobbot.job_applications
  ADD CONSTRAINT job_applications_status_check
  CHECK (application_status = ANY (ARRAY[
    'Preparing',
    'Form Completed',
    'Awaiting Approval',
    'Submission Pending',
    'Submission Failed',
    'Submitted Unverified',
    'Applied Confirmed',
    'Reported Submitted'
  ]));

ALTER TABLE jobbot.job_applications
  DROP CONSTRAINT IF EXISTS job_applications_verification_check;

ALTER TABLE jobbot.job_applications
  ADD CONSTRAINT job_applications_verification_check
  CHECK (verification_status = ANY (ARRAY[
    'unverified',
    'verified',
    'failed',
    'confirmed',
    'pending'
  ]));

-- Events actor: allow phase4 migration label via bot (constraint is bot|user only)
-- Keep actor check; importers must use actor = 'bot'.
;
