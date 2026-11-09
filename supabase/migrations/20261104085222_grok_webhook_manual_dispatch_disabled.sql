-- REVIEW ONLY. New webhook stage; production approval required. No credentials or schedules.
BEGIN;
CREATE TABLE jobbot.outreach_webhook_config (
 owner_id uuid PRIMARY KEY CHECK(owner_id='f2729195-5445-4272-ab85-cac5b03b0967'::uuid),
 enabled boolean NOT NULL DEFAULT false,
 webhook_host text,
 header_name text,
 auth_mode text CHECK(auth_mode IN ('bearer','raw')),
 panel_auth_verified boolean NOT NULL DEFAULT false,
 processor_user_id uuid REFERENCES auth.users(id),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(processor_user_id IS NULL OR processor_user_id<>owner_id)
);
INSERT INTO jobbot.outreach_webhook_config(owner_id) VALUES('f2729195-5445-4272-ab85-cac5b03b0967');
CREATE TABLE jobbot.outreach_webhook_dispatches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES jobbot.outreach_webhook_config(owner_id),
 work_id uuid NOT NULL UNIQUE REFERENCES jobbot.outreach_approval_work(id),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','in_flight','accepted','acceptance_unknown','rejected','processing','completed','cancelled')),
 dry_run boolean NOT NULL DEFAULT false,
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 attempt_id uuid,
 dispatch_requested_at timestamptz,
 webhook_accepted_at timestamptz,
 http_status integer CHECK(http_status BETWEEN 100 AND 599),
 processing_started_at timestamptz,
 processing_completed_at timestamptz,
 claimed_by uuid,
 claim_id uuid,
 outcome text CHECK(outcome IN ('manual_action_required','verification_required','failed')),
 receipt_reference text CHECK(length(receipt_reference) BETWEEN 1 AND 240),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE jobbot.outreach_webhook_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES jobbot.outreach_webhook_config(owner_id),
 dispatch_id uuid REFERENCES jobbot.outreach_webhook_dispatches(id),
 correlation_id uuid,
 event_code text NOT NULL CHECK(length(event_code) BETWEEN 1 AND 64),
 actor_id uuid, actor_kind text NOT NULL CHECK(actor_kind IN ('owner','dispatcher','processor')),
 event_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX webhook_correlated_event ON jobbot.outreach_webhook_events(event_code,correlation_id) WHERE correlation_id IS NOT NULL;
ALTER TABLE jobbot.outreach_webhook_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobbot.outreach_webhook_dispatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobbot.outreach_webhook_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_read ON jobbot.outreach_webhook_config FOR SELECT TO authenticated USING(owner_id=(SELECT auth.uid()));
CREATE POLICY owner_read ON jobbot.outreach_webhook_dispatches FOR SELECT TO authenticated USING(owner_id=(SELECT auth.uid()));
CREATE POLICY owner_read ON jobbot.outreach_webhook_events FOR SELECT TO authenticated USING(owner_id=(SELECT auth.uid()));
REVOKE ALL ON jobbot.outreach_webhook_config,jobbot.outreach_webhook_dispatches,jobbot.outreach_webhook_events FROM PUBLIC,anon,authenticated;
GRANT SELECT ON jobbot.outreach_webhook_config,jobbot.outreach_webhook_dispatches,jobbot.outreach_webhook_events TO authenticated;
CREATE TRIGGER immutable_webhook_events BEFORE UPDATE OR DELETE ON jobbot.outreach_webhook_events FOR EACH ROW EXECUTE FUNCTION jobbot.outreach_immutable();
CREATE VIEW public.jf_outreach_webhook_dispatches WITH(security_invoker=true) AS
 SELECT d.*,w.revision_id,w.approved_at,w.state AS approval_work_state FROM jobbot.outreach_webhook_dispatches d JOIN jobbot.outreach_approval_work w ON w.id=d.work_id;
REVOKE ALL ON public.jf_outreach_webhook_dispatches FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.jf_outreach_webhook_dispatches TO authenticated;

-- No changes to the existing owner-only audit trigger or its function.
CREATE FUNCTION jobbot.webhook_validate_work(p_id uuid,p_states text[]) RETURNS jobbot.outreach_approval_work
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w jobbot.outreach_approval_work; a jobbot.outreach_actions; r jobbot.outreach_action_revisions; c jobbot.outreach_contacts; current_decision uuid; doc_hash text;
BEGIN
 SELECT * INTO w FROM jobbot.outreach_approval_work WHERE id=p_id AND owner_id='f2729195-5445-4272-ab85-cac5b03b0967';
 IF w.id IS NULL THEN RAISE EXCEPTION 'Work unavailable'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(w.action_id::text,0));
 SELECT * INTO a FROM jobbot.outreach_actions WHERE id=w.action_id AND owner_id=w.owner_id;
 IF a.contact_id IS NOT NULL THEN
  SELECT * INTO c FROM jobbot.outreach_contacts WHERE id=a.contact_id AND owner_id=w.owner_id FOR SHARE;
  IF c.id IS NULL OR c.do_not_contact THEN RAISE EXCEPTION 'Contact unavailable or opted out'; END IF;
 END IF;
 SELECT * INTO w FROM jobbot.outreach_approval_work WHERE id=p_id FOR UPDATE;
 IF NOT(w.state=ANY(p_states)) THEN RAISE EXCEPTION 'Work is not eligible'; END IF;
 SELECT * INTO r FROM jobbot.outreach_action_revisions WHERE id=w.revision_id AND owner_id=w.owner_id;
 IF r.id IS NULL OR EXISTS(SELECT 1 FROM jobbot.outreach_action_revisions WHERE action_id=w.action_id AND revision_no>r.revision_no) THEN RAISE EXCEPTION 'Revision changed'; END IF;
 SELECT id INTO current_decision FROM jobbot.outreach_decisions WHERE revision_id=w.revision_id AND owner_id=w.owner_id ORDER BY created_at DESC,id DESC LIMIT 1;
 IF current_decision IS DISTINCT FROM w.decision_id OR NOT EXISTS(SELECT 1 FROM jobbot.outreach_decisions WHERE id=current_decision AND decision='approved') THEN RAISE EXCEPTION 'Approval revoked'; END IF;
 IF r.document_id IS NOT NULL THEN
  SELECT content_sha256 INTO doc_hash FROM jobbot.application_documents WHERE id=r.document_id AND upload_status='verified';
  IF doc_hash IS NULL OR doc_hash IS DISTINCT FROM r.document_sha256 THEN RAISE EXCEPTION 'Attachment changed'; END IF;
 END IF;
 RETURN w;
END $$;
REVOKE ALL ON FUNCTION jobbot.webhook_validate_work(uuid,text[]) FROM PUBLIC,anon,authenticated;

-- Owner-confirmed manual delivery, never a processor-reported send.
CREATE FUNCTION public.jf_confirm_outreach_sent(p_work_id uuid,p_revision_id uuid,p_sent_at timestamptz,p_evidence_source text,p_evidence_ref text,p_recipient_confirmed boolean)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w jobbot.outreach_approval_work; a jobbot.outreach_actions; r jobbot.outreach_action_revisions; event_kind text; old_event uuid; evidence text;
BEGIN
 IF (SELECT auth.uid()) IS DISTINCT FROM 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid THEN RAISE EXCEPTION 'Owner required'; END IF;
 w:=jobbot.webhook_validate_work(p_work_id,ARRAY['manual_action_required','verification_required','sent_verified']);
 IF w.revision_id IS DISTINCT FROM p_revision_id THEN RAISE EXCEPTION 'Revision mismatch'; END IF;
 IF p_recipient_confirmed IS DISTINCT FROM true OR p_sent_at IS NULL OR p_sent_at<w.approved_at OR p_sent_at>now() THEN RAISE EXCEPTION 'Confirm recipient and actual delivery time'; END IF;
 IF p_evidence_source IS NULL OR p_evidence_source NOT IN ('linkedin_sent_view','linkedin_export','authorized_provider_receipt') OR coalesce(length(trim(p_evidence_ref)),0)<8 OR length(p_evidence_ref)>1000 OR p_evidence_ref ~* '(bearer[[:space:]]|sb_secret_|service_role|access_token=|token=|key=)' THEN RAISE EXCEPTION 'Credible delivery evidence required; no credentials'; END IF;
 evidence:=p_evidence_source||':'||trim(p_evidence_ref);
 SELECT * INTO a FROM jobbot.outreach_actions WHERE id=w.action_id;
 SELECT * INTO r FROM jobbot.outreach_action_revisions WHERE id=w.revision_id;
 IF a.contact_id IS NULL THEN RAISE EXCEPTION 'A matched contact is required'; END IF;
 event_kind:=CASE WHEN a.action_type='connection_invitation' THEN 'invitation_sent' WHEN a.action_type='share_document' THEN 'resume_shared' WHEN a.action_type IN ('direct_message','inmail','reply','follow_up','email','referral_request') THEN 'message_sent' ELSE NULL END;
 IF event_kind IS NULL THEN RAISE EXCEPTION 'This action needs a separate evidence workflow'; END IF;
 SELECT id INTO old_event FROM jobbot.outreach_interactions WHERE owner_id=w.owner_id AND external_key='work:'||w.id||':verified-send';
 IF w.state='sent_verified' THEN
  IF old_event IS NOT NULL AND w.result_evidence=evidence AND w.sent_confirmed_at=p_sent_at THEN RETURN old_event; END IF;
  RAISE EXCEPTION 'Already confirmed with different evidence';
 END IF;
 IF EXISTS(SELECT 1 FROM jobbot.outreach_interactions WHERE revision_id=w.revision_id AND event_type=event_kind) THEN RAISE EXCEPTION 'Existing send record requires reconciliation'; END IF;
 INSERT INTO jobbot.outreach_interactions(owner_id,contact_id,action_id,revision_id,event_type,channel,direction,message_summary,event_at,verification,evidence_source,evidence_ref,external_key,application_id)
 VALUES(w.owner_id,a.contact_id,a.id,r.id,event_kind,a.channel,'outbound','Owner manually verified delivery of this exact revision',p_sent_at,'verified',p_evidence_source,trim(p_evidence_ref),'work:'||w.id||':verified-send',r.application_id) RETURNING id INTO old_event;
 UPDATE jobbot.outreach_approval_work SET state='sent_verified',sent_confirmed_at=p_sent_at,result_evidence=evidence WHERE id=w.id;
 RETURN old_event;
END $$;
REVOKE ALL ON FUNCTION public.jf_confirm_outreach_sent(uuid,uuid,timestamptz,text,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.jf_confirm_outreach_sent(uuid,uuid,timestamptz,text,text,boolean) TO authenticated;

-- Non-secret configuration only. Enabling stays a separate, post-test approval.
CREATE FUNCTION public.jf_configure_work_webhook(p_host text,p_header text,p_auth_mode text,p_processor_user_id uuid,p_panel_verified boolean)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF (SELECT auth.uid()) IS DISTINCT FROM 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid THEN RAISE EXCEPTION 'Owner required'; END IF;
 IF p_host IS NULL OR p_header IS NULL OR p_auth_mode IS NULL OR p_host !~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$' OR p_host NOT LIKE '%.%' OR p_header !~ '^[A-Za-z][A-Za-z0-9-]{0,63}$' OR lower(p_header) IN ('host','content-type','content-length','cookie') OR p_auth_mode NOT IN ('bearer','raw') OR p_panel_verified IS DISTINCT FROM true OR p_processor_user_id IS NULL OR p_processor_user_id=(SELECT auth.uid()) THEN RAISE EXCEPTION 'Verified panel settings and a separate processor identity required'; END IF;
 UPDATE jobbot.outreach_webhook_config SET webhook_host=p_host,header_name=p_header,auth_mode=p_auth_mode,processor_user_id=p_processor_user_id,panel_auth_verified=true,enabled=false,updated_at=now() WHERE owner_id=(SELECT auth.uid());
 INSERT INTO jobbot.outreach_webhook_events(owner_id,event_code,actor_id,actor_kind) VALUES((SELECT auth.uid()),'configuration_saved_disabled',(SELECT auth.uid()),'owner');
END $$;
REVOKE ALL ON FUNCTION public.jf_configure_work_webhook(text,text,text,uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.jf_configure_work_webhook(text,text,text,uuid,boolean) TO authenticated;

-- ID-only signed signal; no reusable token or webhook URL is placed in pg_net.
CREATE FUNCTION jobbot.webhook_signal(p_dispatch_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cfg jobbot.outreach_webhook_config; stamp text; sig text; signing_key text;
BEGIN
 SELECT * INTO cfg FROM jobbot.outreach_webhook_config WHERE owner_id='f2729195-5445-4272-ab85-cac5b03b0967';
 IF NOT cfg.enabled OR NOT cfg.panel_auth_verified THEN RETURN; END IF;
 SELECT decrypted_secret INTO signing_key FROM vault.decrypted_secrets WHERE name='jf_grok_dispatch_signing_key';
 IF signing_key IS NULL THEN RETURN; END IF;
 stamp:=floor(extract(epoch FROM clock_timestamp()))::bigint::text;
 sig:=encode(extensions.hmac(p_dispatch_id::text||'.'||stamp,signing_key,'sha256'),'hex');
 PERFORM net.http_post(url:='https://mldtysploensrrulchdl.supabase.co/functions/v1/jf-work-dispatch',headers:=jsonb_build_object('Content-Type','application/json','x-jf-timestamp',stamp,'x-jf-signature',sig),body:=jsonb_build_object('dispatch_id',p_dispatch_id),timeout_milliseconds:=15000);
EXCEPTION WHEN OTHERS THEN
 -- Keep the durable item even if the internal wake-up cannot be enqueued.
 INSERT INTO jobbot.outreach_webhook_events(owner_id,dispatch_id,event_code,actor_kind)
 SELECT owner_id,id,'signal_not_enqueued','dispatcher' FROM jobbot.outreach_webhook_dispatches WHERE id=p_dispatch_id;
END $$;
REVOKE ALL ON FUNCTION jobbot.webhook_signal(uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION jobbot.webhook_enqueue_work() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE did uuid;
BEGIN
 -- Called by the existing owner approval transaction; do not backfill old work.
 INSERT INTO jobbot.outreach_webhook_dispatches(owner_id,work_id) VALUES(NEW.owner_id,NEW.id) ON CONFLICT(work_id) DO NOTHING RETURNING id INTO did;
 IF did IS NOT NULL THEN
  INSERT INTO jobbot.outreach_webhook_events(owner_id,dispatch_id,event_code,actor_id,actor_kind) VALUES(NEW.owner_id,did,'pending',(SELECT auth.uid()),'owner');
  PERFORM jobbot.webhook_signal(did);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION jobbot.webhook_enqueue_work() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER webhook_enqueue_work AFTER INSERT ON jobbot.outreach_approval_work FOR EACH ROW EXECUTE FUNCTION jobbot.webhook_enqueue_work();

-- Restricted processor read/claim: its Auth UUID has no table-write or approval rights.
CREATE FUNCTION public.jf_grok_claim_work(p_work_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cfg jobbot.outreach_webhook_config; w jobbot.outreach_approval_work; d jobbot.outreach_webhook_dispatches; a jobbot.outreach_actions; r jobbot.outreach_action_revisions;
BEGIN
 SELECT * INTO cfg FROM jobbot.outreach_webhook_config WHERE owner_id='f2729195-5445-4272-ab85-cac5b03b0967';
 IF cfg.processor_user_id IS NULL OR cfg.processor_user_id IS DISTINCT FROM (SELECT auth.uid()) THEN RAISE EXCEPTION 'Processor required'; END IF;
 w:=jobbot.webhook_validate_work(p_work_id,ARRAY['queued']);
 SELECT * INTO d FROM jobbot.outreach_webhook_dispatches WHERE work_id=w.id FOR UPDATE;
 IF d.id IS NULL OR d.dry_run OR d.state NOT IN ('in_flight','accepted','acceptance_unknown','processing','completed') THEN RAISE EXCEPTION 'Not dispatched'; END IF;
 IF d.state='completed' THEN RETURN jsonb_build_object('status','already_completed','outcome',d.outcome); END IF;
 IF d.state='processing' THEN RETURN jsonb_build_object('status','already_claimed'); END IF;
 SELECT * INTO a FROM jobbot.outreach_actions WHERE id=w.action_id;
 SELECT * INTO r FROM jobbot.outreach_action_revisions WHERE id=w.revision_id;
 UPDATE jobbot.outreach_webhook_dispatches SET state='processing',processing_started_at=now(),claimed_by=(SELECT auth.uid()),claim_id=gen_random_uuid() WHERE id=d.id RETURNING * INTO d;
 INSERT INTO jobbot.outreach_webhook_events(owner_id,dispatch_id,event_code,actor_id,actor_kind) VALUES(w.owner_id,d.id,'processing',(SELECT auth.uid()),'processor');
 RETURN jsonb_build_object('status','claimed','work_item_id',w.id,'revision_id',w.revision_id,'claim_id',d.claim_id,'action_type',a.action_type,'channel',a.channel,'contact_id',a.contact_id,'target',r.target_snapshot,'target_url',r.target_url,'body',r.body,'document_id',r.document_id,'document_sha256',r.document_sha256,'execution_mode','manual_only');
END $$;
CREATE FUNCTION public.jf_grok_complete_work(p_work_id uuid,p_revision_id uuid,p_claim_id uuid,p_outcome text,p_receipt_reference text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cfg jobbot.outreach_webhook_config; w jobbot.outreach_approval_work; d jobbot.outreach_webhook_dispatches;
BEGIN
 SELECT * INTO cfg FROM jobbot.outreach_webhook_config WHERE owner_id='f2729195-5445-4272-ab85-cac5b03b0967';
 IF cfg.processor_user_id IS NULL OR cfg.processor_user_id IS DISTINCT FROM (SELECT auth.uid()) THEN RAISE EXCEPTION 'Processor required'; END IF;
 w:=jobbot.webhook_validate_work(p_work_id,ARRAY['queued','manual_action_required','verification_required']);
 IF w.revision_id IS DISTINCT FROM p_revision_id OR p_outcome IS NULL OR p_outcome NOT IN ('manual_action_required','verification_required','failed') OR coalesce(length(trim(p_receipt_reference)),0) NOT BETWEEN 1 AND 240 THEN RAISE EXCEPTION 'Invalid completion'; END IF;
 SELECT * INTO d FROM jobbot.outreach_webhook_dispatches WHERE work_id=w.id FOR UPDATE;
 IF d.claim_id IS DISTINCT FROM p_claim_id OR p_claim_id IS NULL OR d.claimed_by IS DISTINCT FROM (SELECT auth.uid()) THEN RAISE EXCEPTION 'Claim mismatch'; END IF;
 IF d.state='completed' AND d.outcome=p_outcome AND d.receipt_reference=trim(p_receipt_reference) THEN RETURN d.id; END IF;
 IF d.state<>'processing' THEN RAISE EXCEPTION 'Not processing'; END IF;
 UPDATE jobbot.outreach_webhook_dispatches SET state='completed',outcome=p_outcome,receipt_reference=trim(p_receipt_reference),processing_completed_at=now() WHERE id=d.id;
 INSERT INTO jobbot.outreach_webhook_events(owner_id,dispatch_id,event_code,actor_id,actor_kind) VALUES(w.owner_id,d.id,'completed_'||p_outcome,(SELECT auth.uid()),'processor');
 RETURN d.id;
END $$;
REVOKE ALL ON FUNCTION public.jf_grok_claim_work(uuid),public.jf_grok_complete_work(uuid,uuid,uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.jf_grok_claim_work(uuid),public.jf_grok_complete_work(uuid,uuid,uuid,text,text) TO authenticated;

-- Backend-only reservation. A crash after reservation is acceptance_unknown in
-- operator review; NEVER silently resend an ambiguous request.
CREATE FUNCTION jobbot.webhook_reserve(p_dispatch_id uuid,p_test boolean DEFAULT false) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cfg jobbot.outreach_webhook_config; d jobbot.outreach_webhook_dispatches; w jobbot.outreach_approval_work; target text;
BEGIN
 SELECT * INTO cfg FROM jobbot.outreach_webhook_config WHERE owner_id='f2729195-5445-4272-ab85-cac5b03b0967';
 IF cfg.panel_auth_verified IS DISTINCT FROM true OR cfg.processor_user_id IS NULL OR (NOT cfg.enabled AND p_test IS DISTINCT FROM true) THEN RETURN NULL; END IF;
 SELECT * INTO d FROM jobbot.outreach_webhook_dispatches WHERE id=p_dispatch_id;
 IF d.id IS NULL THEN RETURN NULL; END IF;
 w:=jobbot.webhook_validate_work(d.work_id,ARRAY['queued']);
 IF p_test THEN
  SELECT target_snapshot INTO target FROM jobbot.outreach_action_revisions WHERE id=w.revision_id;
  IF target NOT LIKE 'SYNTHETIC TEST%' THEN RAISE EXCEPTION 'Only clearly labeled synthetic work may bypass the disabled dispatch gate'; END IF;
 END IF;
 SELECT * INTO d FROM jobbot.outreach_webhook_dispatches WHERE id=p_dispatch_id FOR UPDATE;
 IF d.state<>'pending' OR d.attempts>=3 THEN RETURN NULL; END IF;
 UPDATE jobbot.outreach_webhook_dispatches SET state='in_flight',attempts=attempts+1,attempt_id=gen_random_uuid(),dispatch_requested_at=now() WHERE id=d.id RETURNING * INTO d;
 INSERT INTO jobbot.outreach_webhook_events(owner_id,dispatch_id,event_code,actor_kind) VALUES(d.owner_id,d.id,'dispatch_requested','dispatcher');
 RETURN jsonb_build_object('dispatch_id',d.id,'attempt_id',d.attempt_id,'work_item_id',d.work_id,'dry_run',d.dry_run);
END $$;
CREATE FUNCTION jobbot.webhook_record_http(p_dispatch_id uuid,p_attempt_id uuid,p_status integer) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d jobbot.outreach_webhook_dispatches; code text;
BEGIN
 SELECT * INTO d FROM jobbot.outreach_webhook_dispatches WHERE id=p_dispatch_id FOR UPDATE;
 IF d.id IS NULL OR d.attempt_id IS DISTINCT FROM p_attempt_id OR p_attempt_id IS NULL THEN RAISE EXCEPTION 'Attempt mismatch'; END IF;
 IF d.http_status IS NOT NULL OR d.state IN ('rejected','acceptance_unknown') THEN RETURN; END IF;
 code:=CASE WHEN p_status BETWEEN 200 AND 299 THEN 'accepted' WHEN p_status IN (400,401,403,404,405,422) THEN 'rejected' ELSE 'acceptance_unknown' END;
 UPDATE jobbot.outreach_webhook_dispatches SET
  http_status=p_status,
  webhook_accepted_at=CASE WHEN code='accepted' THEN coalesce(webhook_accepted_at,now()) ELSE webhook_accepted_at END,
  state=CASE WHEN state IN ('processing','completed','cancelled') THEN state ELSE code END WHERE id=d.id;
 INSERT INTO jobbot.outreach_webhook_events(owner_id,dispatch_id,event_code,actor_kind) VALUES(d.owner_id,d.id,'webhook_'||code,'dispatcher');
END $$;
REVOKE ALL ON FUNCTION jobbot.webhook_reserve(uuid,boolean),jobbot.webhook_record_http(uuid,uuid,integer) FROM PUBLIC,anon,authenticated;

-- Explicit owner retry only after a definite rejection, maximum three attempts.
CREATE FUNCTION public.jf_retry_rejected_work_webhook(p_dispatch_id uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d jobbot.outreach_webhook_dispatches;
BEGIN
 IF (SELECT auth.uid()) IS DISTINCT FROM 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid THEN RAISE EXCEPTION 'Owner required'; END IF;
 SELECT * INTO d FROM jobbot.outreach_webhook_dispatches WHERE id=p_dispatch_id AND owner_id=(SELECT auth.uid());
 IF d.id IS NULL THEN RAISE EXCEPTION 'Dispatch unavailable'; END IF;
 PERFORM jobbot.webhook_validate_work(d.work_id,ARRAY['queued']);
 SELECT * INTO d FROM jobbot.outreach_webhook_dispatches WHERE id=p_dispatch_id FOR UPDATE;
 IF d.state<>'rejected' OR d.attempts>=3 THEN RAISE EXCEPTION 'Retry requires a definite rejection and remaining attempts'; END IF;
 UPDATE jobbot.outreach_webhook_dispatches SET state='pending',http_status=NULL WHERE id=d.id;
 INSERT INTO jobbot.outreach_webhook_events(owner_id,dispatch_id,event_code,actor_id,actor_kind) VALUES(d.owner_id,d.id,'owner_retry_requested',(SELECT auth.uid()),'owner');
 PERFORM jobbot.webhook_signal(d.id);
END $$;
REVOKE ALL ON FUNCTION public.jf_retry_rejected_work_webhook(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.jf_retry_rejected_work_webhook(uuid) TO authenticated;

-- Prepare restricted AI drafting interfaces. Global AI dispatch stays OFF.
ALTER TABLE jobbot.monitor_ai_tasks ADD COLUMN processor_claim_id uuid,ADD COLUMN processor_user_id uuid REFERENCES auth.users(id),ADD COLUMN processing_completed_at timestamptz,ADD COLUMN processor_input_hash text;
CREATE FUNCTION public.jf_grok_claim_ai_task(p_task_id uuid DEFAULT NULL) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cfg jobbot.outreach_webhook_config; t jobbot.monitor_ai_tasks; ai_enabled boolean;
BEGIN
 SELECT * INTO cfg FROM jobbot.outreach_webhook_config WHERE owner_id='f2729195-5445-4272-ab85-cac5b03b0967';
 IF cfg.processor_user_id IS NULL OR cfg.processor_user_id IS DISTINCT FROM (SELECT auth.uid()) THEN RAISE EXCEPTION 'Processor required'; END IF;
 SELECT ai_dispatch_enabled INTO ai_enabled FROM jobbot.monitor_settings WHERE owner_id=cfg.owner_id;
 SELECT * INTO t FROM jobbot.monitor_ai_tasks WHERE owner_id=cfg.owner_id AND assignee='linkedin_bot' AND (p_task_id IS NULL OR id=p_task_id)
  AND (state='pending' OR (state='claimed' AND claim_expires_at<now())) AND attempts<3 AND (is_test OR coalesce(ai_enabled,false))
  AND (contact_id IS NULL OR EXISTS(SELECT 1 FROM jobbot.outreach_contacts c WHERE c.id=contact_id AND c.owner_id=cfg.owner_id AND NOT c.do_not_contact))
  ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF t.id IS NULL THEN RETURN NULL; END IF;
 UPDATE jobbot.monitor_ai_tasks SET state='claimed',claimed_at=now(),claim_expires_at=now()+interval '10 minutes',attempts=attempts+1,processor_claim_id=gen_random_uuid(),processor_user_id=(SELECT auth.uid()),processor_input_hash=encode(extensions.digest(payload::text,'sha256'),'hex'),updated_at=now() WHERE id=t.id RETURNING * INTO t;
 INSERT INTO jobbot.outreach_webhook_events(owner_id,event_code,actor_id,actor_kind) VALUES(t.owner_id,'ai_task_claimed',(SELECT auth.uid()),'processor');
 RETURN jsonb_build_object('task_id',t.id,'claim_id',t.processor_claim_id,'task_type',t.task_type,'payload',t.payload,'requires_approval',true,'execution_mode','draft_only');
END $$;
CREATE FUNCTION public.jf_grok_complete_ai_task(p_task_id uuid,p_claim_id uuid,p_draft text) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cfg jobbot.outreach_webhook_config; t jobbot.monitor_ai_tasks; ai_enabled boolean;
BEGIN
 SELECT * INTO cfg FROM jobbot.outreach_webhook_config WHERE owner_id='f2729195-5445-4272-ab85-cac5b03b0967';
 IF cfg.processor_user_id IS NULL OR cfg.processor_user_id IS DISTINCT FROM (SELECT auth.uid()) THEN RAISE EXCEPTION 'Processor required'; END IF;
 SELECT * INTO t FROM jobbot.monitor_ai_tasks WHERE id=p_task_id AND owner_id=cfg.owner_id FOR UPDATE;
 SELECT ai_dispatch_enabled INTO ai_enabled FROM jobbot.monitor_settings WHERE owner_id=cfg.owner_id;
 IF t.id IS NULL OR p_claim_id IS NULL OR t.processor_claim_id IS DISTINCT FROM p_claim_id OR t.processor_user_id IS DISTINCT FROM (SELECT auth.uid()) OR t.assignee<>'linkedin_bot' THEN RAISE EXCEPTION 'Claim mismatch'; END IF;
 IF NOT t.is_test AND NOT coalesce(ai_enabled,false) THEN RAISE EXCEPTION 'AI dispatch disabled'; END IF;
 IF t.contact_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jobbot.outreach_contacts WHERE id=t.contact_id AND owner_id=cfg.owner_id AND NOT do_not_contact) THEN RAISE EXCEPTION 'Contact unavailable or opted out'; END IF;
 IF t.processor_input_hash IS DISTINCT FROM encode(extensions.digest(t.payload::text,'sha256'),'hex') THEN RAISE EXCEPTION 'Task context changed'; END IF;
 IF t.state='completed' AND t.result_draft=p_draft THEN RETURN t.id; END IF;
 IF t.state<>'claimed' OR t.claim_expires_at<now() OR coalesce(length(trim(p_draft)),0) NOT BETWEEN 1 AND 8000 THEN RAISE EXCEPTION 'Claim expired or invalid draft'; END IF;
 UPDATE jobbot.monitor_ai_tasks SET state='completed',result_draft=p_draft,processing_completed_at=now(),updated_at=now() WHERE id=t.id;
 INSERT INTO jobbot.outreach_webhook_events(owner_id,event_code,actor_id,actor_kind) VALUES(t.owner_id,'ai_draft_completed_pending_review',(SELECT auth.uid()),'processor');
 RETURN t.id;
END $$;
REVOKE ALL ON FUNCTION public.jf_grok_claim_ai_task(uuid),public.jf_grok_complete_ai_task(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.jf_grok_claim_ai_task(uuid),public.jf_grok_complete_ai_task(uuid,uuid,text) TO authenticated;
-- No enabling RPC is included: production activation is a separate reviewed step.

CREATE FUNCTION jobbot.webhook_record_probe(p_probe_id uuid,p_code text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_probe_id IS NULL OR p_code NOT IN ('probe_requested_A','probe_requested_B','probe_requested_C','probe_http_accepted','probe_http_rejected','probe_http_unknown') THEN RAISE EXCEPTION 'Invalid probe'; END IF;
 INSERT INTO jobbot.outreach_webhook_events(owner_id,correlation_id,event_code,actor_kind) VALUES('f2729195-5445-4272-ab85-cac5b03b0967',p_probe_id,p_code,'dispatcher') ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION jobbot.webhook_record_probe(uuid,text) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.jf_grok_ack_probe(p_probe_id uuid,p_result text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cfg jobbot.outreach_webhook_config; expected text;
BEGIN
 SELECT * INTO cfg FROM jobbot.outreach_webhook_config WHERE owner_id='f2729195-5445-4272-ab85-cac5b03b0967';
 IF cfg.processor_user_id IS NULL OR cfg.processor_user_id IS DISTINCT FROM (SELECT auth.uid()) THEN RAISE EXCEPTION 'Processor required'; END IF;
 expected:=CASE WHEN p_result='missing_work' THEN 'probe_requested_A' WHEN p_result='ai_disabled_dry_run' THEN 'probe_requested_B' END;
 IF expected IS NULL OR NOT EXISTS(SELECT 1 FROM jobbot.outreach_webhook_events WHERE correlation_id=p_probe_id AND event_code=expected) THEN RAISE EXCEPTION 'Probe mismatch'; END IF;
 INSERT INTO jobbot.outreach_webhook_events(owner_id,correlation_id,event_code,actor_id,actor_kind) VALUES(cfg.owner_id,p_probe_id,'probe_ack_'||p_result,(SELECT auth.uid()),'processor') ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.jf_grok_ack_probe(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.jf_grok_ack_probe(uuid,text) TO authenticated;

-- An invalidated work item cannot leave a misleading pending processor state.
CREATE FUNCTION jobbot.webhook_cancel_invalid_work() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE did uuid;
BEGIN
 IF NEW.state IN ('invalidated','failed','sent_verified') AND NEW.state IS DISTINCT FROM OLD.state THEN
  UPDATE jobbot.outreach_webhook_dispatches SET state='cancelled' WHERE work_id=NEW.id AND state IN ('pending','in_flight','accepted','acceptance_unknown','processing') RETURNING id INTO did;
  IF did IS NOT NULL THEN INSERT INTO jobbot.outreach_webhook_events(owner_id,dispatch_id,event_code,actor_id,actor_kind) VALUES(NEW.owner_id,did,'work_no_longer_executable',(SELECT auth.uid()),'owner'); END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION jobbot.webhook_cancel_invalid_work() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER webhook_cancel_invalid_work AFTER UPDATE OF state ON jobbot.outreach_approval_work FOR EACH ROW EXECUTE FUNCTION jobbot.webhook_cancel_invalid_work();
CREATE FUNCTION public.jf_wake_pending_work_webhook(p_dispatch_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d jobbot.outreach_webhook_dispatches;
BEGIN
 IF (SELECT auth.uid()) IS DISTINCT FROM 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid THEN RAISE EXCEPTION 'Owner required'; END IF;
 SELECT * INTO d FROM jobbot.outreach_webhook_dispatches WHERE id=p_dispatch_id AND owner_id=(SELECT auth.uid());
 IF d.id IS NULL OR d.state<>'pending' THEN RAISE EXCEPTION 'Pending dispatch required'; END IF;
 PERFORM jobbot.webhook_validate_work(d.work_id,ARRAY['queued']);
 PERFORM jobbot.webhook_signal(d.id);
END $$;
REVOKE ALL ON FUNCTION public.jf_wake_pending_work_webhook(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.jf_wake_pending_work_webhook(uuid) TO authenticated;

CREATE FUNCTION public.jf_grok_runtime_status() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cfg jobbot.outreach_webhook_config; ai boolean;
BEGIN
 SELECT * INTO cfg FROM jobbot.outreach_webhook_config WHERE owner_id='f2729195-5445-4272-ab85-cac5b03b0967';
 IF cfg.processor_user_id IS NULL OR cfg.processor_user_id IS DISTINCT FROM (SELECT auth.uid()) THEN RAISE EXCEPTION 'Processor required'; END IF;
 SELECT ai_dispatch_enabled INTO ai FROM jobbot.monitor_settings WHERE owner_id=cfg.owner_id;
 RETURN jsonb_build_object('ai_dispatch_enabled',coalesce(ai,false),'work_dispatch_enabled',cfg.enabled,'execution_mode','manual_only');
END $$;
REVOKE ALL ON FUNCTION public.jf_grok_runtime_status() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.jf_grok_runtime_status() TO authenticated;
COMMIT;
;
