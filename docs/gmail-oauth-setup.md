# Google OAuth 2.0 Setup Guide for Gmail Monitoring

This guide provides instructions to authorize the Supabase Edge Function (`gmail-status-sync`) to read recruitment emails via Google OAuth 2.0 with minimal required permissions.

---

## 1. Google Cloud Console Configuration

### A. Project & API Activation
1. Navigate to the [Google Cloud Console](https://console.cloud.google.com/).
2. Select your existing project or create a new project named **Job Farming Automation**.
3. Go to **APIs & Services** > **Library**.
4. Search for **Gmail API** and click **Enable**.

### B. OAuth Consent Screen
1. Go to **APIs & Services** > **OAuth consent screen**.
2. Select **External** (if testing with personal accounts) and click **Create**.
3. Fill in required details:
   - **App name**: `Job Farming Status Monitor`
   - **User support email**: `govardhanreddy.vys7@gmail.com`
   - **Developer contact email**: `govardhanreddy.vys7@gmail.com`
4. Click **Save and Continue**.
5. Under **Scopes**, click **Add or Remove Scopes**:
   - Filter for `Gmail API`.
   - Select ONLY: `https://www.googleapis.com/auth/gmail.readonly` (Read resources from Gmail).
   - **DO NOT** request send, delete, or modify scopes.
6. Click **Update** > **Save and Continue**.
7. Under **Test Users**:
   - Click **Add Users**.
   - Enter `govardhanreddy.vys7@gmail.com`.
8. Click **Save and Continue**.

### C. Create OAuth 2.0 Client Credentials
1. Go to **APIs & Services** > **Credentials**.
2. Click **Create Credentials** > **OAuth client ID**.
3. Set **Application type** to **Web application**.
4. Set **Name** to `Job Farming Supabase Function`.
5. Under **Authorized redirect URIs**, add:
   - `https://developers.google.com/oauthplayground` (useful for initial refresh token acquisition)
6. Click **Create**.
7. Note down your **Client ID** and **Client Secret**.

---

## 2. Obtain Refresh Token via Google OAuth Playground

1. Go to the [Google OAuth 2.0 Playground](https://developers.google.com/oauthplayground).
2. Click the gear icon (Settings) in the top right:
   - Check **Use your own OAuth credentials**.
   - Enter your **OAuth Client ID** and **OAuth Client Secret**.
3. In Step 1 (Select & authorize APIs):
   - In the input box, paste: `https://www.googleapis.com/auth/gmail.readonly`
   - Click **Authorize APIs**.
4. Sign in using `govardhanreddy.vys7@gmail.com` and grant read permissions.
5. In Step 2 (Exchange authorization code for tokens):
   - Click **Exchange authorization code for tokens**.
6. Copy the resulting **Refresh token**.

---

## 3. Store Credentials in Supabase Vault

Execute the following SQL in your Supabase SQL Editor (or via Supabase CLI / MCP) to securely store your credentials in Supabase Vault:

```sql
-- 1. Insert or update Gmail Client ID
insert into vault.secrets (name, secret, description)
values ('jf_gmail_client_id', 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com', 'Gmail OAuth client id (gmail.readonly)')
on conflict (name) do update
set secret = excluded.secret,
    updated_at = now();

-- 2. Insert or update Gmail Client Secret
insert into vault.secrets (name, secret, description)
values ('jf_gmail_client_secret', 'YOUR_GOOGLE_CLIENT_SECRET', 'Gmail OAuth client secret')
on conflict (name) do update
set secret = excluded.secret,
    updated_at = now();

-- 3. Insert or update Gmail Refresh Token
insert into vault.secrets (name, secret, description)
values ('jf_gmail_refresh_token', 'YOUR_GOOGLE_REFRESH_TOKEN', 'Gmail OAuth refresh token (gmail.readonly)')
on conflict (name) do update
set secret = excluded.secret,
    updated_at = now();

-- 4. Ensure internal invoke token exists
insert into vault.secrets (name, secret, description)
values ('jf_monitor_invoke_token', encode(gen_random_bytes(32), 'hex'), 'Shared secret: pg_cron tick -> gmail-status-sync edge function')
on conflict (name) do nothing;
```

---

## 4. Verification Check

Once credentials are saved, test the integration without writing to the database:

1. Open the dashboard at `https://job-farming-dashboard.vercel.app/monitoring` (or local `http://localhost:3000/monitoring`).
2. Click **Test Dry-Run**.
3. Confirm that the status reports `dry_run_completed` with `0` database status changes and real message discovery counts.

