# Job Farming — Gmail Monitoring Migration Delivery Report

**Project:** `JobFarmingDashboard`  
**GitHub Repository:** `REDEVL4/JobFarmingDashboard`  
**Target Branch:** `master`  
**Latest Commit SHA:** `7b482b0` (pushed to origin)  
**Supabase Project:** `mldtysploensrrulchdl`  
**Schema:** `jobbot` (public access via `public.jf_*` views)  
**Mailbox:** `govardhanreddy.vys7@gmail.com`  
**Operating Mode:** **STRICT DRY-RUN (Zero writes enabled without explicit user authorization)**

---

## Executive Summary

The legacy ChatGPT Gmail Status Agent has been replaced with an independent, production-safe monitoring architecture built natively on **Supabase Edge Functions**, **Supabase Cron (`49 * * * *`)**, and the **Gmail API (`gmail.readonly`)**. 

The service operates completely independently without requiring ChatGPT Work credits, active AI chat sessions, or the broken Grok owner MCP connector.

---

## 1. Deliverables Matrix

| Requirement | Deliverable | Status |
|---|---|---|
| **A. Gmail OAuth** | Minimal scope `https://www.googleapis.com/auth/gmail.readonly`, mailbox validation for `govardhanreddy.vys7@gmail.com`, Vault secret storage | ✅ Implemented & Documented |
| **B. Edge Function** | `supabase/functions/gmail-status-sync/index.ts` with Deno runtime, deterministic classification, and candidate application matching | ✅ Implemented (`a38c7bd`) |
| **C. Production Safety** | Strict dry-run default (`dry_run: true`), 0 database updates/events until approved, non-destructive to historical records | ✅ Verified & Tested |
| **D. Hourly Scheduler** | Supabase Cron configuration at `49 * * * *` with server-to-server token header from Supabase Vault | ✅ Documented in `docs/cron-scheduler-setup.md` |
| **E. Dashboard Integration** | Upgraded `/monitoring` with live telemetry, classification breakdown, real review queue (222 items), and manual dry-run trigger | ✅ Implemented (`7b482b0`) |
| **F. Grok Interface** | Isolated read-only endpoint `/api/grok/monitoring` with independent Bearer token auth (`GROK_MONITORING_READ_KEY`) | ✅ Implemented (`d0beca8`) |
| **G. Verification** | 51 unit tests passing, Next.js build clean, idempotency & prompt injection defense verified | ✅ Verified (51/51 Pass) |

---

## 2. Source Code Architecture

### Edge Function: `supabase/functions/gmail-status-sync/`
- [`index.ts`](file:///c:/Users/reddy/OneDrive/Documents/AntiGravity%20Projects/JobFarmingDashboard/supabase/functions/gmail-status-sync/index.ts): Main Deno function. Authenticates invocations via `x-jf-monitor-token`, refreshes Google OAuth tokens, discovers Gmail messages, runs classification and matching, and enforces the `dry_run` gate.
- [`classifier.ts`](file:///c:/Users/reddy/OneDrive/Documents/AntiGravity%20Projects/JobFarmingDashboard/supabase/functions/gmail-status-sync/classifier.ts): Deterministic regex/AST classifier. Strips HTML, defends against malicious prompt injections in email bodies, extracts exact quote evidence, and classifies hiring stages:
  - `Rejected`
  - `Assessment Requested`
  - `Interview Scheduled`
  - `Offer Received`
  - `Applied Confirmed` (acknowledgments)
- [`matcher.ts`](file:///c:/Users/reddy/OneDrive/Documents/AntiGravity%20Projects/JobFarmingDashboard/supabase/functions/gmail-status-sync/matcher.ts): Matches recruitment emails against `jobbot.job_applications` using multi-factor signals:
  1. Exact Requisition ID (e.g. `JR-0000122265`, `134985`)
  2. Exact Confirmation Email ID / Thread Reference
  3. Unique Company + Job Title match
  4. Flags ambiguous matches to `recruitment_review_items` with reason codes (`multiple_candidate_applications`, `sender_employer_mapping_unverified`, `role_less_specific_than_application`).
- [`types.ts`](file:///c:/Users/reddy/OneDrive/Documents/AntiGravity%20Projects/JobFarmingDashboard/supabase/functions/gmail-status-sync/types.ts): Type definitions for all payloads and stages.

### API Routes & Next.js UI
- [`src/app/api/monitoring/dry-run/route.ts`](file:///c:/Users/reddy/OneDrive/Documents/AntiGravity%20Projects/JobFarmingDashboard/src/app/api/monitoring/dry-run/route.ts): Owner-authenticated test trigger endpoint.
- [`src/app/api/grok/monitoring/route.ts`](file:///c:/Users/reddy/OneDrive/Documents/AntiGravity%20Projects/JobFarmingDashboard/src/app/api/grok/monitoring/route.ts): Independent read-only endpoint for Grok.
- [`src/components/monitoring/monitoring-view.tsx`](file:///c:/Users/reddy/OneDrive/Documents/AntiGravity%20Projects/JobFarmingDashboard/src/components/monitoring/monitoring-view.tsx): Client dashboard view with interactive dry-run testing and gap reconciliation controls.
- [`src/app/monitoring/page.tsx`](file:///c:/Users/reddy/OneDrive/Documents/AntiGravity%20Projects/JobFarmingDashboard/src/app/monitoring/page.tsx): Server Component querying real Supabase telemetry via `public.jf_*` views.

---

## 3. Required Supabase Secret Names

The Edge Function reads credentials securely from **Supabase Vault** (`vault.decrypted_secrets`) via the existing database accessor `jobbot.monitor_get_secret(name)`.

| Secret Name | Purpose | Location |
|---|---|---|
| `jf_gmail_client_id` | Google OAuth 2.0 Client ID | Supabase Vault |
| `jf_gmail_client_secret` | Google OAuth 2.0 Client Secret | Supabase Vault |
| `jf_gmail_refresh_token` | Google OAuth 2.0 Refresh Token (`gmail.readonly`) | Supabase Vault |
| `jf_monitor_invoke_token` | Shared secret for server-to-server invocation from `pg_cron` / dashboard | Supabase Vault |
| `GROK_MONITORING_READ_KEY` | Optional independent Bearer key for Grok read-only access | Vercel / Env |

---

## 4. Google OAuth Setup Instructions

Full setup steps are documented in [`docs/gmail-oauth-setup.md`](file:///c:/Users/reddy/OneDrive/Documents/AntiGravity%20Projects/JobFarmingDashboard/docs/gmail-oauth-setup.md).

### Summary of Actions Required by Owner:
1. Enable **Gmail API** in Google Cloud Console.
2. Configure OAuth Consent Screen:
   - Scope: strictly `https://www.googleapis.com/auth/gmail.readonly`
   - Test user: `govardhanreddy.vys7@gmail.com`
3. Generate Web Application Client ID & Client Secret.
4. Obtain refresh token via Google OAuth Playground or CLI.
5. Save in Supabase Vault:
   ```sql
   insert into vault.secrets (name, secret, description)
   values 
     ('jf_gmail_client_id', 'YOUR_CLIENT_ID.apps.googleusercontent.com', 'Gmail OAuth client ID'),
     ('jf_gmail_client_secret', 'YOUR_CLIENT_SECRET', 'Gmail OAuth client secret'),
     ('jf_gmail_refresh_token', 'YOUR_REFRESH_TOKEN', 'Gmail OAuth refresh token (gmail.readonly)')
   on conflict (name) do update set secret = excluded.secret;
   ```

---

## 5. Scheduler Configuration (`49 * * * *`)

Full schedule commands and rollback procedures are in [`docs/cron-scheduler-setup.md`](file:///c:/Users/reddy/OneDrive/Documents/AntiGravity%20Projects/JobFarmingDashboard/docs/cron-scheduler-setup.md).

### Initial Dry-Run Schedule SQL:
```sql
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

> [!IMPORTANT]
> **Safety Guarantee**: The scheduled job runs with `"dry_run": true` by default. It will log proposed updates to `jobbot.sync_logs` without modifying application statuses or inserting historical events until you explicitly approve live writes.

---

## 6. Verification & Test Results

```
> node --experimental-strip-types --test "tests/unit/**/*.test.mjs"

ℹ tests 65
ℹ suites 0
ℹ pass 65
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ duration_ms 148.1
```

- **Auth Security Tests (4/4 passed)**: Fail-closed verification, wrong-owner rejection, missing credential handling.
- **Gmail Classifier Tests (16/16 passed)**: Rejections (Teleport, Barclays), assessments (IBM coding & competency), interviews (Datadog), formal offers (Stripe), acknowledgments (Uber), 2FA/security discard, prompt injection immunity.
- **Gmail Matcher Tests (12/12 passed)**: Requisition ID matching, confirmation thread reference matching, single company hardening (requires role confirmation), unverified third-party domain flagging (Gem), deduplication set verification.
- **Hardening Invariants (7/7 passed)**: Live write gate (`ENABLE_GMAIL_STATUS_WRITES`), dry-run checkpoint invariant, incomplete pagination protection, terminal stage overwrite protection, chronological event sorting.
- **Sync Idempotency Tests (4/4 passed)**: Historical message deduplication, 15-minute lookback window, dry-run invariant.
- **Grok Read-Only Tests (4/4 passed)**: Strict HTTP GET enforcement, bearer authentication, credential leakage prevention.
- **Metrics & Status Normalization (18/18 passed)**: UTC date safety, real-data calculations, canonical status mapping.
- **Next.js Production Build**: Passed with 0 errors (`next build` compiled 10 routes cleanly).

---

## 7. Deployment Plan & Actions Requiring User Approval

### Actions Completed:
1. ✅ All code written, tested, committed, and pushed to `master` (Commit `7b482b0`).
2. ✅ Next.js compilation verified.
3. ✅ Edge Function created and ready for deployment.

### Actions Requiring Your Input / Approval:
1. **Google OAuth Token Setup**: If you wish to refresh the Gmail token in Supabase Vault, follow the steps in [`docs/gmail-oauth-setup.md`](file:///c:/Users/reddy/OneDrive/Documents/AntiGravity%20Projects/JobFarmingDashboard/docs/gmail-oauth-setup.md). (Note: existing `jf_gmail_client_id` and `jf_gmail_refresh_token` from Nov 4 are already present in your Vault).
2. **Deploy Edge Function to Supabase**:
   Run via Supabase CLI:
   ```bash
   supabase functions deploy gmail-status-sync --project-ref mldtysploensrrulchdl
   ```
3. **Register Supabase Cron**: Run the SQL in Section 5 above when ready to start hourly polling in dry-run mode.
4. **Redeploy on Vercel**: Redeploy Vercel with `NEXT_PUBLIC_SUPABASE_SCHEMA=public` to get the updated monitoring telemetry and table score fixes live.
5. **Approval for Live Writes**: Once you review the initial dry-run log output on `/monitoring` and approve, switch `"dry_run": false` in the cron definition.

