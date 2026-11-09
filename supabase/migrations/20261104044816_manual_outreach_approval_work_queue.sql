-- REVIEW ONLY: do not apply before owner approves production schema changes.
-- No scheduler, webhook, outbound sending, auth user, or credential is created.
-- Existing historical decisions are intentionally not queued retrospectively.
BEGIN;
CREATE TABLE jobbot.outreach_approval_work (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL,
 action_id uuid NOT NULL,
 revision_id uuid NOT NULL,
 decision_id uuid NOT NULL REFERENCES jobbot.outreach_decisions(id),
 state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','manual_action_required','verification_required','failed','sent_verified','invalidated')),
 approved_at timestamptz NOT NULL, queued_at timestamptz NOT NULL DEFAULT now(),
 dispatched_at timestamptz, execution_started_at timestamptz, sent_confirmed_at timestamptz,
 acknowledged_at timestamptz, result_evidence text,
 FOREIGN KEY (action_id,owner_id) REFERENCES jobbot.outreach_actions(id,owner_id),
 FOREIGN KEY (revision_id,action_id,owner_id) REFERENCES jobbot.outreach_action_revisions(id,action_id,owner_id),
 UNIQUE(revision_id), UNIQUE(decision_id),
 CHECK(owner_id='f2729195-5445-4272-ab85-cac5b03b0967'::uuid)
);
ALTER TABLE jobbot.outreach_approval_work ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_read ON jobbot.outreach_approval_work FOR SELECT TO authenticated
 USING(owner_id=(SELECT auth.uid()) AND owner_id='f2729195-5445-4272-ab85-cac5b03b0967'::uuid);
REVOKE ALL ON jobbot.outreach_approval_work FROM PUBLIC,anon,authenticated;
GRANT SELECT ON jobbot.outreach_approval_work TO authenticated;
CREATE VIEW public.jf_outreach_approval_work WITH (security_invoker=true) AS
 SELECT id,action_id,revision_id,decision_id,state,approved_at,queued_at,dispatched_at,execution_started_at,sent_confirmed_at,acknowledged_at,result_evidence FROM jobbot.outreach_approval_work;
REVOKE ALL ON public.jf_outreach_approval_work FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.jf_outreach_approval_work TO authenticated;
-- Changes use existing authenticated-owner audit enforcement.
CREATE TRIGGER audit_outreach AFTER INSERT OR UPDATE ON jobbot.outreach_approval_work FOR EACH ROW EXECUTE FUNCTION jobbot.outreach_audit_change();
CREATE FUNCTION jobbot.queue_outreach_decision() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE action_key uuid;
BEGIN
 IF (SELECT auth.uid()) IS DISTINCT FROM NEW.owner_id OR NEW.owner_id<>'f2729195-5445-4272-ab85-cac5b03b0967'::uuid THEN RAISE EXCEPTION 'Owner required'; END IF;
 SELECT action_id INTO STRICT action_key FROM jobbot.outreach_action_revisions WHERE id=NEW.revision_id AND owner_id=NEW.owner_id;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(action_key::text,0));
 IF NEW.decision='approved' THEN
  INSERT INTO jobbot.outreach_approval_work(owner_id,action_id,revision_id,decision_id,approved_at)
  VALUES(NEW.owner_id,action_key,NEW.revision_id,NEW.id,NEW.created_at) ON CONFLICT(revision_id) DO NOTHING;
 ELSE
  UPDATE jobbot.outreach_approval_work SET state='invalidated' WHERE owner_id=NEW.owner_id AND revision_id=NEW.revision_id AND state IN ('queued','manual_action_required','verification_required');
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION jobbot.queue_outreach_decision() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER outreach_queue_decision AFTER INSERT ON jobbot.outreach_decisions FOR EACH ROW EXECUTE FUNCTION jobbot.queue_outreach_decision();
CREATE FUNCTION jobbot.invalidate_outreach_work() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF (SELECT auth.uid()) IS DISTINCT FROM NEW.owner_id OR NEW.owner_id<>'f2729195-5445-4272-ab85-cac5b03b0967'::uuid THEN RAISE EXCEPTION 'Owner required'; END IF;
 UPDATE jobbot.outreach_approval_work SET state='invalidated' WHERE owner_id=NEW.owner_id AND action_id=NEW.action_id AND revision_id<>NEW.id AND state IN ('queued','manual_action_required','verification_required');
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION jobbot.invalidate_outreach_work() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER outreach_queue_revision AFTER INSERT ON jobbot.outreach_action_revisions FOR EACH ROW EXECUTE FUNCTION jobbot.invalidate_outreach_work();
CREATE FUNCTION jobbot.invalidate_opted_out_outreach_work() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF (SELECT auth.uid()) IS DISTINCT FROM NEW.owner_id OR NEW.owner_id<>'f2729195-5445-4272-ab85-cac5b03b0967'::uuid THEN RAISE EXCEPTION 'Owner required'; END IF;
 IF NEW.do_not_contact AND NOT OLD.do_not_contact THEN
  UPDATE jobbot.outreach_approval_work w SET state='invalidated'
   FROM jobbot.outreach_actions a WHERE a.contact_id=NEW.id AND a.owner_id=NEW.owner_id
    AND w.action_id=a.id AND w.owner_id=NEW.owner_id AND w.state IN ('queued','manual_action_required','verification_required');
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION jobbot.invalidate_opted_out_outreach_work() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER outreach_queue_optout AFTER UPDATE OF do_not_contact ON jobbot.outreach_contacts FOR EACH ROW EXECUTE FUNCTION jobbot.invalidate_opted_out_outreach_work();
-- This is an OWNER manual-assistance acknowledgement, not a Grok credential,
-- delivery integration, webhook, or evidence of sending.
CREATE FUNCTION public.jf_acknowledge_outreach_manual(p_work_id uuid,p_revision_id uuid) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE result uuid;
BEGIN
 IF (SELECT auth.uid()) IS DISTINCT FROM 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid THEN RAISE EXCEPTION 'Owner required'; END IF;
 SELECT jobbot.acknowledge_outreach_manual(p_work_id,p_revision_id) INTO result;
 RETURN result;
END $$;
CREATE FUNCTION jobbot.acknowledge_outreach_manual(p_work_id uuid,p_revision_id uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w jobbot.outreach_approval_work; c jobbot.outreach_contacts; r jobbot.outreach_action_revisions; a jobbot.outreach_actions; target_state text; action_key uuid;
BEGIN
 IF (SELECT auth.uid()) IS DISTINCT FROM 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid THEN RAISE EXCEPTION 'Owner required'; END IF;
 SELECT action_id INTO action_key FROM jobbot.outreach_approval_work WHERE id=p_work_id AND owner_id=(SELECT auth.uid());
 IF action_key IS NULL THEN RAISE EXCEPTION 'Work item or revision mismatch'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(action_key::text,0));
 SELECT * INTO w FROM jobbot.outreach_approval_work WHERE id=p_work_id AND owner_id=(SELECT auth.uid()) FOR UPDATE;
 IF w.id IS NULL OR w.revision_id IS DISTINCT FROM p_revision_id THEN RAISE EXCEPTION 'Work item or revision mismatch'; END IF;
 IF w.state IN ('manual_action_required','verification_required') THEN RETURN w.id; END IF;
 IF w.state<>'queued' THEN RAISE EXCEPTION 'Work item is not eligible'; END IF;
 SELECT * INTO a FROM jobbot.outreach_actions WHERE id=w.action_id AND owner_id=w.owner_id;
 SELECT * INTO r FROM jobbot.outreach_action_revisions WHERE id=w.revision_id AND owner_id=w.owner_id;
 IF EXISTS(SELECT 1 FROM jobbot.outreach_action_revisions x WHERE x.action_id=w.action_id AND x.revision_no>r.revision_no) THEN RAISE EXCEPTION 'Revision changed'; END IF;
 IF a.contact_id IS NOT NULL THEN SELECT * INTO c FROM jobbot.outreach_contacts WHERE id=a.contact_id AND owner_id=w.owner_id; END IF;
 IF a.contact_id IS NOT NULL AND (c.id IS NULL OR c.do_not_contact) THEN RAISE EXCEPTION 'Contact unavailable or opted out'; END IF;
 -- A matching LinkedIn profile URL permits manual assistance; all other targets
 -- require further verification. This comparison does not prove person identity.
 target_state := CASE WHEN a.channel='linkedin' AND c.linkedin_url IS NOT NULL AND r.target_url IS NOT NULL
  AND lower(rtrim(c.linkedin_url,'/'))=lower(rtrim(r.target_url,'/')) THEN 'manual_action_required' ELSE 'verification_required' END;
 UPDATE jobbot.outreach_approval_work SET state=target_state,acknowledged_at=now(),execution_started_at=now() WHERE id=w.id;
 RETURN w.id;
END $$;
REVOKE ALL ON FUNCTION jobbot.acknowledge_outreach_manual(uuid,uuid),public.jf_acknowledge_outreach_manual(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION jobbot.acknowledge_outreach_manual(uuid,uuid),public.jf_acknowledge_outreach_manual(uuid,uuid) TO authenticated;
COMMIT;
;
