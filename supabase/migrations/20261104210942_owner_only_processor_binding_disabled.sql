-- REVIEW ONLY. Not applied to production. No tables, columns, policies or queued work change.
-- Decouples owner-authorized processor registration from unavailable webhook credentials.
BEGIN;
CREATE FUNCTION public.jf_bind_work_processor(p_processor_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cfg jobbot.outreach_webhook_config;
BEGIN
 IF (SELECT auth.uid()) IS DISTINCT FROM 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid THEN
  RAISE EXCEPTION 'Owner required';
 END IF;
 SELECT * INTO cfg FROM jobbot.outreach_webhook_config
 WHERE owner_id=(SELECT auth.uid()) FOR UPDATE;
 IF cfg.owner_id IS NULL THEN RAISE EXCEPTION 'Configuration unavailable'; END IF;
 IF cfg.enabled OR EXISTS(SELECT 1 FROM jobbot.monitor_settings WHERE owner_id=cfg.owner_id AND ai_dispatch_enabled) THEN
  RAISE EXCEPTION 'Both dispatch switches must be disabled';
 END IF;
 IF p_processor_user_id IS NULL OR p_processor_user_id=cfg.owner_id THEN
  RAISE EXCEPTION 'A separate verified processor identity is required';
 END IF;
 PERFORM 1 FROM auth.users WHERE id=p_processor_user_id AND role='authenticated'
 AND NOT coalesce(is_anonymous,false) AND deleted_at IS NULL AND confirmed_at IS NOT NULL
 AND (banned_until IS NULL OR banned_until<=now()) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active confirmed Auth user required'; END IF;
 IF cfg.processor_user_id IS NOT DISTINCT FROM p_processor_user_id THEN RETURN; END IF;
 IF EXISTS(SELECT 1 FROM jobbot.outreach_webhook_dispatches WHERE owner_id=cfg.owner_id AND state IN ('in_flight','accepted','acceptance_unknown','processing')) THEN
  RAISE EXCEPTION 'Resolve outstanding dispatches before rebinding';
 END IF;
 UPDATE jobbot.outreach_webhook_config SET processor_user_id=p_processor_user_id,updated_at=now()
 WHERE owner_id=cfg.owner_id;
 INSERT INTO jobbot.outreach_webhook_events(owner_id,event_code,actor_id,actor_kind,correlation_id)
 VALUES(cfg.owner_id,'processor_bound_disabled:'||p_processor_user_id::text,(SELECT auth.uid()),'owner',gen_random_uuid());
END $$;
REVOKE ALL ON FUNCTION public.jf_bind_work_processor(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.jf_bind_work_processor(uuid) TO authenticated;
COMMIT;
;
