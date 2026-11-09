-- FINAL REVIEW ONLY: fixture-only APIs, not deployed. Gateway must validate owner JWT cryptographically.
BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN ('jf_owner_claim_work','jf_owner_complete_work'))
 THEN RAISE EXCEPTION 'Owner RPC already exists: stop and review all overloads'; END IF;
END $$;
-- Empty by design. Enrollment is a separately reviewed administrative change, never a client RPC.
CREATE TABLE jobbot.outreach_owner_test_allowlist (
 work_id uuid PRIMARY KEY REFERENCES jobbot.outreach_approval_work(id),
 revision_id uuid NOT NULL REFERENCES jobbot.outreach_action_revisions(id),
 enrolled_at timestamptz NOT NULL DEFAULT now(),
 review_reference text NOT NULL CHECK(length(review_reference) BETWEEN 8 AND 240)
);
ALTER TABLE jobbot.outreach_owner_test_allowlist ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON jobbot.outreach_owner_test_allowlist FROM PUBLIC,anon,authenticated,service_role;
-- No client policies, view, grants or enrollment function.
CREATE TABLE jobbot.outreach_owner_processing (
 work_id uuid PRIMARY KEY REFERENCES jobbot.outreach_approval_work(id),
 owner_id uuid NOT NULL CHECK(owner_id='f2729195-5445-4272-ab85-cac5b03b0967'),
 revision_id uuid NOT NULL REFERENCES jobbot.outreach_action_revisions(id),
 request_id uuid NOT NULL UNIQUE, claim_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 claimed_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 outcome text CHECK(outcome IN ('manual_action_required','verification_required','failed')),
 receipt_reference text CHECK(length(receipt_reference) BETWEEN 1 AND 240),
 CHECK((completed_at IS NULL AND outcome IS NULL AND receipt_reference IS NULL) OR
       (completed_at IS NOT NULL AND outcome IS NOT NULL AND receipt_reference IS NOT NULL))
);
ALTER TABLE jobbot.outreach_owner_processing ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON jobbot.outreach_owner_processing FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON jobbot.outreach_owner_processing TO authenticated;
CREATE POLICY owner_read ON jobbot.outreach_owner_processing FOR SELECT TO authenticated
 USING(owner_id=(SELECT auth.uid()));
CREATE VIEW public.jf_outreach_owner_processing WITH(security_invoker=true) AS
 SELECT * FROM jobbot.outreach_owner_processing;
REVOKE ALL ON public.jf_outreach_owner_processing FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.jf_outreach_owner_processing TO authenticated;

CREATE FUNCTION jobbot.require_owner_processing_auth() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j jsonb:=auth.jwt(); sid uuid;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'authenticated'
 OR (SELECT auth.uid()) IS DISTINCT FROM 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid
 OR j->>'sub' IS DISTINCT FROM 'f2729195-5445-4272-ab85-cac5b03b0967'
 OR j->>'role' IS DISTINCT FROM 'authenticated'
 THEN RAISE EXCEPTION 'Authenticated owner required'; END IF;
 IF coalesce(j->>'exp','') !~ '^[0-9]{1,12}$' THEN RAISE EXCEPTION 'Owner session required'; END IF;
 IF (j->>'exp')::numeric<=extract(epoch FROM now()) THEN RAISE EXCEPTION 'Owner session expired'; END IF;
 IF coalesce(j->>'session_id','') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN
 RAISE EXCEPTION 'Owner session required'; END IF;
 sid:=(j->>'session_id')::uuid;
 IF NOT EXISTS(SELECT 1 FROM auth.sessions s JOIN auth.users u ON u.id=s.user_id
 WHERE s.id=sid AND s.user_id=(SELECT auth.uid()) AND (s.not_after IS NULL OR s.not_after>now())
 AND u.deleted_at IS NULL AND NOT coalesce(u.is_anonymous,false)
 AND (u.banned_until IS NULL OR u.banned_until<=now()))
 THEN RAISE EXCEPTION 'Active owner session required'; END IF;
END $$;
REVOKE ALL ON FUNCTION jobbot.require_owner_processing_auth() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.jf_owner_claim_work(p_work_id uuid,p_revision_id uuid,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w jobbot.outreach_approval_work; r jobbot.outreach_action_revisions; a jobbot.outreach_actions;
 x jobbot.outreach_owner_processing; d jobbot.outreach_webhook_dispatches;
BEGIN
 PERFORM jobbot.require_owner_processing_auth();
 -- Explicit work/revision-ID gate; target text never authorizes access.
 PERFORM 1 FROM jobbot.outreach_owner_test_allowlist f
 WHERE f.work_id=p_work_id AND f.revision_id=p_revision_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Fixture not allowlisted'; END IF;
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'Explicit request required'; END IF;
 -- Same validation/lock order as dedicated processing: action/contact/work, then outbox.
 w:=jobbot.webhook_validate_work(p_work_id,ARRAY['queued','verification_required','manual_action_required','failed']);
 IF w.revision_id IS DISTINCT FROM p_revision_id THEN RAISE EXCEPTION 'Revision mismatch'; END IF;
 SELECT * INTO r FROM jobbot.outreach_action_revisions WHERE id=w.revision_id;
 SELECT * INTO a FROM jobbot.outreach_actions WHERE id=w.action_id;
 SELECT * INTO x FROM jobbot.outreach_owner_processing WHERE work_id=w.id;
 IF x.work_id IS NOT NULL THEN
  IF x.request_id IS DISTINCT FROM p_request_id THEN RETURN jsonb_build_object('status','already_claimed'); END IF;
  RETURN jsonb_build_object('status',CASE WHEN x.completed_at IS NULL THEN 'claimed' ELSE 'already_completed' END,
   'work_id',w.id,'revision_id',x.revision_id,'claim_id',x.claim_id,'action_type',a.action_type,'channel',a.channel,'contact_id',a.contact_id,'body',r.body,'target',r.target_snapshot,
   'target_url',r.target_url,'document_id',r.document_id,'document_sha256',r.document_sha256,'execution_mode','manual_only');
 END IF;
 IF w.state<>'queued' THEN RAISE EXCEPTION 'Work is not queued'; END IF;
 SELECT * INTO d FROM jobbot.outreach_webhook_dispatches WHERE work_id=w.id FOR UPDATE;
 IF d.id IS NULL OR d.state<>'pending' OR d.attempts<>0 OR d.dry_run THEN RAISE EXCEPTION 'Work reserved by another path'; END IF;
 IF EXISTS(SELECT 1 FROM jobbot.outreach_owner_processing WHERE request_id=p_request_id) THEN RAISE EXCEPTION 'Request already used'; END IF;
 INSERT INTO jobbot.outreach_owner_processing(work_id,owner_id,revision_id,request_id)
 VALUES(w.id,w.owner_id,w.revision_id,p_request_id) RETURNING * INTO x;
 -- This blocks dedicated reservation/claim without inventing a webhook acceptance.
 UPDATE jobbot.outreach_approval_work SET state='verification_required',execution_started_at=now() WHERE id=w.id;
 INSERT INTO jobbot.outreach_webhook_events(owner_id,event_code,actor_id,actor_kind,correlation_id)
 VALUES(w.owner_id,'owner_processing_claimed',(SELECT auth.uid()),'owner',x.claim_id);
 RETURN jsonb_build_object('status','claimed','work_id',w.id,'revision_id',r.id,'claim_id',x.claim_id,
 'action_type',a.action_type,'channel',a.channel,'contact_id',a.contact_id,'body',r.body,'target',r.target_snapshot,'target_url',r.target_url,'document_id',r.document_id,
 'document_sha256',r.document_sha256,'execution_mode','manual_only');
END $$;
REVOKE ALL ON FUNCTION public.jf_owner_claim_work(uuid,uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.jf_owner_claim_work(uuid,uuid,uuid) TO authenticated;

CREATE FUNCTION public.jf_owner_complete_work(p_work_id uuid,p_revision_id uuid,p_claim_id uuid,p_outcome text,p_receipt_reference text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w jobbot.outreach_approval_work; x jobbot.outreach_owner_processing;
BEGIN
 PERFORM jobbot.require_owner_processing_auth();
 -- Explicit work/revision-ID gate; target text never authorizes access.
 PERFORM 1 FROM jobbot.outreach_owner_test_allowlist f
 WHERE f.work_id=p_work_id AND f.revision_id=p_revision_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Fixture not allowlisted'; END IF;
 w:=jobbot.webhook_validate_work(p_work_id,ARRAY['verification_required','manual_action_required','failed']);
 IF w.revision_id IS DISTINCT FROM p_revision_id OR p_outcome IS NULL
 OR p_outcome NOT IN ('manual_action_required','verification_required','failed')
 OR coalesce(length(trim(p_receipt_reference)),0) NOT BETWEEN 1 AND 240
 OR p_receipt_reference ~* '(bearer[[:space:]]|sb_secret_|service_role|access_token=|token=|key=)'
 THEN RAISE EXCEPTION 'Invalid completion'; END IF;
 SELECT * INTO x FROM jobbot.outreach_owner_processing WHERE work_id=w.id FOR UPDATE;
 IF x.work_id IS NULL OR x.revision_id IS DISTINCT FROM p_revision_id OR x.claim_id IS DISTINCT FROM p_claim_id
 OR p_claim_id IS NULL OR x.owner_id IS DISTINCT FROM (SELECT auth.uid()) THEN RAISE EXCEPTION 'Claim mismatch'; END IF;
 IF x.completed_at IS NOT NULL THEN
  IF x.outcome=p_outcome AND x.receipt_reference=trim(p_receipt_reference) THEN RETURN x.claim_id; END IF;
  RAISE EXCEPTION 'Conflicting completion';
 END IF;
 UPDATE jobbot.outreach_owner_processing SET completed_at=now(),outcome=p_outcome,receipt_reference=trim(p_receipt_reference) WHERE work_id=w.id;
 UPDATE jobbot.outreach_approval_work SET state=p_outcome,acknowledged_at=now() WHERE id=w.id;
 INSERT INTO jobbot.outreach_webhook_events(owner_id,event_code,actor_id,actor_kind,correlation_id)
 VALUES(w.owner_id,'owner_processing_completed',(SELECT auth.uid()),'owner',x.claim_id);
 RETURN x.claim_id;
END $$;
REVOKE ALL ON FUNCTION public.jf_owner_complete_work(uuid,uuid,uuid,text,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.jf_owner_complete_work(uuid,uuid,uuid,text,text) TO authenticated;
COMMIT;
;
