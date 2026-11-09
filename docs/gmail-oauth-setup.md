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

> [!NOTE]
> **Existing Secrets Verified**: The four required secrets (`jf_gmail_client_id`, `jf_gmail_client_secret`, `jf_gmail_refresh_token`, and `jf_monitor_invoke_token`) already exist in your Supabase Vault. **Do not re-insert or overwrite them** unless you are deliberately rotating OAuth credentials.

If rotating credentials in the future, use the supported Supabase Vault API functions (`vault.create_secret` / `vault.update_secret`) rather than direct table insertion with `ON CONFLICT` (since `vault.secrets` does not have a unique constraint on `name`):

```sql
-- Supported Supabase Vault update-or-create procedure:
do $$
declare
  v_secret_id uuid;
begin
  -- 1. Gmail Client ID
  select id into v_secret_id from vault.secrets where name = 'jf_gmail_client_id' limit 1;
  if v_secret_id is not null then
    perform vault.update_secret(v_secret_id, 'YOUR_CLIENT_ID.apps.googleusercontent.com', 'jf_gmail_client_id', 'Gmail OAuth client id (gmail.readonly)');
  else
    perform vault.create_secret('YOUR_CLIENT_ID.apps.googleusercontent.com', 'jf_gmail_client_id', 'Gmail OAuth client id (gmail.readonly)');
  end if;

  -- 2. Gmail Client Secret
  select id into v_secret_id from vault.secrets where name = 'jf_gmail_client_secret' limit 1;
  if v_secret_id is not null then
    perform vault.update_secret(v_secret_id, 'YOUR_CLIENT_SECRET', 'jf_gmail_client_secret', 'Gmail OAuth client secret');
  else
    perform vault.create_secret('YOUR_CLIENT_SECRET', 'jf_gmail_client_secret', 'Gmail OAuth client secret');
  end if;

  -- 3. Gmail Refresh Token
  select id into v_secret_id from vault.secrets where name = 'jf_gmail_refresh_token' limit 1;
  if v_secret_id is not null then
    perform vault.update_secret(v_secret_id, 'YOUR_REFRESH_TOKEN', 'jf_gmail_refresh_token', 'Gmail OAuth refresh token (gmail.readonly)');
  else
    perform vault.create_secret('YOUR_REFRESH_TOKEN', 'jf_gmail_refresh_token', 'Gmail OAuth refresh token (gmail.readonly)');
  end if;

  -- 4. Internal Invoke Token (if not present)
  select id into v_secret_id from vault.secrets where name = 'jf_monitor_invoke_token' limit 1;
  if v_secret_id is null then
    perform vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'jf_monitor_invoke_token', 'Shared secret: pg_cron tick -> gmail-status-sync edge function');
  end if;
end $$;
```

---

## 4. Verification Check

Once credentials are saved, test the integration without writing to the database:

1. Open the dashboard at `https://job-farming-dashboard.vercel.app/monitoring` (or local `http://localhost:3000/monitoring`).
2. Click **Test Dry-Run**.
3. Confirm that the status reports `dry_run_completed` with `0` database status changes and real message discovery counts.

