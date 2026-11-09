-- ============================================================================
-- Migration: Create Loss-Resistant Gmail Ingestion & Grok Processing Queue
-- Schema: jobbot
-- Table: jobbot.gmail_processing_queue
-- Status: PROPOSED FOR OWNER APPROVAL (DO NOT APPLY AUTOMATICALLY)
-- ============================================================================

CREATE TABLE IF NOT EXISTS jobbot.gmail_processing_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL DEFAULT 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid,
    mailbox TEXT NOT NULL,
    message_id TEXT NOT NULL,
    thread_id TEXT,
    message_timestamp TIMESTAMPTZ NOT NULL,
    history_id TEXT,
    processing_status TEXT NOT NULL DEFAULT 'pending',
    content_hash TEXT NOT NULL,
    subject_clean TEXT,
    sender_clean TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    lease_token UUID,
    lease_expires_at TIMESTAMPTZ,
    last_attempted_at TIMESTAMPTZ,
    error_details JSONB DEFAULT '[]'::jsonb,
    analysis_version TEXT,
    classification_result JSONB,
    proposed_application_match JSONB,
    evidence_references JSONB,
    review_status TEXT NOT NULL DEFAULT 'pending',
    exclusion_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Security & Integrity Constraints
    CONSTRAINT gmail_processing_queue_owner_id_check 
        CHECK (owner_id = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid),
    CONSTRAINT gmail_processing_queue_mailbox_message_unique 
        UNIQUE (mailbox, message_id),
    CONSTRAINT gmail_processing_queue_status_check 
        CHECK (processing_status IN ('pending', 'pending_fetch', 'claimed', 'completed', 'failed', 'skipped', 'excluded')),
    CONSTRAINT gmail_processing_queue_review_status_check 
        CHECK (review_status IN ('pending', 'requires_review', 'auto_approved', 'user_approved', 'user_rejected', 'ignored'))
);

-- Index 1: High-concurrency worker claim with FOR UPDATE SKIP LOCKED
CREATE INDEX IF NOT EXISTS idx_gmail_queue_worker_claim 
    ON jobbot.gmail_processing_queue (mailbox, processing_status, lease_expires_at) 
    WHERE processing_status IN ('pending', 'pending_fetch', 'claimed');

-- Index 2: Chronological ordering & timestamp lookups
CREATE INDEX IF NOT EXISTS idx_gmail_queue_timestamp 
    ON jobbot.gmail_processing_queue (mailbox, message_timestamp DESC);

-- Index 3: Thread-level correlation
CREATE INDEX IF NOT EXISTS idx_gmail_queue_thread 
    ON jobbot.gmail_processing_queue (mailbox, thread_id);

-- Enable Row Level Security (RLS)
ALTER TABLE jobbot.gmail_processing_queue ENABLE ROW LEVEL SECURITY;

-- Policy 1: Owner-only authenticated access
CREATE POLICY "owner_access_gmail_processing_queue" 
    ON jobbot.gmail_processing_queue
    FOR ALL 
    TO authenticated 
    USING (owner_id = auth.uid())
    WITH CHECK (owner_id = auth.uid());

-- Policy 2: Backend service-role access
CREATE POLICY "service_role_gmail_processing_queue" 
    ON jobbot.gmail_processing_queue
    FOR ALL 
    TO service_role 
    USING (true)
    WITH CHECK (true);

-- Explicit privilege configuration (Fail-closed for anonymous traffic)
REVOKE ALL ON jobbot.gmail_processing_queue FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON jobbot.gmail_processing_queue TO authenticated;
GRANT ALL ON jobbot.gmail_processing_queue TO service_role;

-- Register monitor source for ingestion tracking in sync_cursors
INSERT INTO jobbot.monitor_sources (
    source_key,
    owner_id,
    display_name,
    adapter,
    capabilities,
    limitations,
    connection_status,
    verification_status,
    updated_at
) VALUES (
    'gmail_status_ingestion',
    'f2729195-5445-4272-ab85-cac5b03b0967'::uuid,
    'Gmail Ingestion Queue & History Sync',
    'edge_function_gmail_history',
    '{"history_api": true, "loss_resistant": true, "queue_decoupled": true}'::jsonb,
    'Enqueues message metadata; raw bodies fetched on demand only during authorized AI analysis.',
    'connected',
    'verified',
    now()
) ON CONFLICT (source_key) DO UPDATE
SET updated_at = now();

-- Register initial cursor for Gmail Ingestion
INSERT INTO jobbot.sync_cursors (
    owner_id,
    source_key,
    last_success_at,
    last_observed_at,
    last_external_id,
    last_history_id,
    overlap_minutes,
    initial_lookback_hours,
    consecutive_failures,
    updated_at
) VALUES (
    'f2729195-5445-4272-ab85-cac5b03b0967'::uuid,
    'gmail_status_ingestion',
    NULL,
    NULL,
    NULL,
    NULL,
    15,
    72,
    0,
    now()
) ON CONFLICT (owner_id, source_key) DO NOTHING;


