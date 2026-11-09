-- Job Farming Phase 5 (A2): scheduler — FREE-PLAN path (Supabase Cron + pg_net).
-- Apply AFTER 01_* and AFTER the linkedin-monitor edge function is deployed.
-- Nothing here activates monitoring: jobbot.monitor_settings.enabled stays false,
-- so every tick is a pure in-database WHERE check (no HTTP, no edge invocation,
-- no Grok) until the owner passes the Gmail source check and enables it.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net  with schema extensions;

do $$
declare jid bigint;
begin
  for jid in select jobid from cron.job
              where jobname in ('jf-linkedin-monitor-tick','jf-linkedin-monitor-housekeeping') loop
    perform cron.unschedule(jid);
  end loop;

  -- ONE fixed 5-minute tick. It calls the edge function only when something is due:
  --   (a) an owner-requested Gmail source check, or
  --   (b) monitoring enabled+unpaused and the 5-min Gmail poll is due (or Run Now), or
  --   (c) AI dispatch enabled, AI interval (20/30/60) elapsed, and >=1 pending AI task.
  -- Otherwise the statement returns zero rows and makes no HTTP call.
  perform cron.schedule('jf-linkedin-monitor-tick', '*/5 * * * *', $cron$
    select net.http_post(
      url := 'https://mldtysploensrrulchdl.supabase.co/functions/v1/linkedin-monitor',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'x-jf-monitor-token', (select decrypted_secret from vault.decrypted_secrets
                                where name = 'jf_monitor_invoke_token' limit 1)),
      body := '{"trigger":"cron"}'::jsonb,
      timeout_milliseconds := 120000)
    where exists (
      select 1 from jobbot.monitor_settings s
       where s.source_check_requested_at is not null
          or (s.enabled and not s.paused
              and (s.run_now_requested_at is not null or s.next_run_at <= now())
              and not exists (select 1 from jobbot.monitor_runs r
                               where r.status = 'claimed' and r.lease_expires_at > now()))
          or (s.ai_dispatch_enabled and not s.paused
              and (s.ai_next_dispatch_at is null or s.ai_next_dispatch_at <= now())
              and exists (select 1 from jobbot.monitor_ai_tasks t
                           where not t.is_test
                             and (t.state = 'pending'
                                  or (t.state = 'claimed' and t.claim_expires_at < now())))));
  $cron$);

  -- Daily housekeeping (free plan = 500 MB DB): pg_cron never prunes its own history.
  perform cron.schedule('jf-linkedin-monitor-housekeeping', '17 3 * * *', $cron$
    delete from cron.job_run_details where end_time < now() - interval '3 days';
    delete from jobbot.monitor_runs r
     where r.status <> 'claimed' and r.events_new = 0 and r.claimed_at < now() - interval '14 days'
       and not exists (select 1 from jobbot.monitor_inbound_events e where e.run_id = r.id);
  $cron$);
end $$;
;
