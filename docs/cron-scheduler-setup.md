# Supabase Cron Scheduler Setup & Rollback Guide (`49 * * * *`)

This guide specifies how to configure and control the Supabase Cron job that triggers the `gmail-status-sync` Edge Function on an hourly schedule.

---

## 1. Production Constraints & Safety Rules

- **Schedule**: `49 * * * *` (Executes every hour at minute 49 UTC).
- **Default Mode**: `dry_run: true`. No application statuses or database records are modified until you explicitly approve live writes.
- **Security**: The cron job retrieves the shared secret `jf_monitor_invoke_token` directly from `vault.decrypted_secrets` inside the database, sending it as the `x-jf-monitor-token` HTTP header. No keys are hardcoded in the cron command.

---

## 2. Register Hourly Cron Job (Initial Dry-Run Mode)

Execute the following SQL in your Supabase SQL Editor:

```sql
-- Schedule hourly Gmail Status Sync at minute 49 (Dry-Run by default)
select cron.schedule(
  'jf-gmail-status-sync-hourly',
  '49 * * * *',
  $$
  select net.http_post(
    url := 'https://mldtysploensrrulchdl.supabase.co/functions/v1/gmail-status-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-jf-monitor-token', (select decrypted_secret from vault.decrypted_secrets where name = 'jf_monitor_invoke_token' limit 1)
    ),
    body := '{"trigger":"cron","dry_run":true}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
```

---

## 3. Verify Scheduler Registration

Run this query to check the active cron job:

```sql
select jobid, jobname, schedule, active, command
  from cron.job
 where jobname = 'jf-gmail-status-sync-hourly';
```

Expected output:
- `jobname`: `jf-gmail-status-sync-hourly`
- `schedule`: `49 * * * *`
- `active`: `true`

---

## 4. Test Scheduler Execution Manually

To trigger a test execution immediately without waiting for minute :49:

```sql
select net.http_post(
  url := 'https://mldtysploensrrulchdl.supabase.co/functions/v1/gmail-status-sync',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'x-jf-monitor-token', (select decrypted_secret from vault.decrypted_secrets where name = 'jf_monitor_invoke_token' limit 1)
  ),
  body := '{"trigger":"manual_test","dry_run":true}'::jsonb,
  timeout_milliseconds := 120000
);
```

Check the latest execution log in `jobbot.sync_logs`:

```sql
select run_id, bot_name, started_at, completed_at, verification_results
  from jobbot.sync_logs
 where bot_name = 'Gmail Status Agent'
 order by started_at desc limit 1;
```

---

## 5. Enable Live Writes (Requires Explicit Owner Approval)

Once dry-run results have been inspected and verified:

```sql
-- Update the cron job payload to permit live database updates
select cron.alter_job(
  job_id := (select jobid from cron.job where jobname = 'jf-gmail-status-sync-hourly'),
  schedule := '49 * * * *',
  command := $$
  select net.http_post(
    url := 'https://mldtysploensrrulchdl.supabase.co/functions/v1/gmail-status-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-jf-monitor-token', (select decrypted_secret from vault.decrypted_secrets where name = 'jf_monitor_invoke_token' limit 1)
    ),
    body := '{"trigger":"cron","dry_run":false}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
```

---

## 6. Emergency Rollback & Deactivation

If you need to immediately pause or unschedule the job:

### To Pause (keeps job registered but inactive):
```sql
update cron.job
   set active = false
 where jobname = 'jf-gmail-status-sync-hourly';
```

### To Completely Unschedule:
```sql
select cron.unschedule('jf-gmail-status-sync-hourly');
```
