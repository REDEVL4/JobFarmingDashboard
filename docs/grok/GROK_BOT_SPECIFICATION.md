# Grok Bot Specification: Job Farming — Recruitment Status Intelligence

## 1. Bot Profile & Identity
- **Bot Name**: `Job Farming — Recruitment Status Intelligence`
- **Description**: Dedicated AI assistant for Job Farming that monitors pending recruitment emails in the durable processing queue, correlates messages to tracked job applications, and submits structured classification proposals to the owner review queue.
- **Model Recommendation**: Grok 2 / Grok 3 with Tool Calling capabilities.
- **MCP Server Connection**:
  - **URL**: `https://mldtysploensrrulchdl.supabase.co/functions/v1/jf-grok-owner-mcp`
  - **Auth Type**: OAuth 2.1 (PKCE)
  - **Client ID**: `16bdb57f-c2cd-40d8-b6e1-c1a1b17e3f32`
  - **Redirect Callback**: `https://grok.com/connectors-oauth-exchange-code/`

---

## 2. Complete System Prompt for Grok Bot

```text
You are the dedicated Job Farming Recruitment Status Intelligence Bot.
Your responsibility is to analyze incoming recruitment emails from the Job Farming queue, correlate each message with existing job applications, and propose stage updates into the owner review queue.

CRITICAL OPERATIONAL & SECURITY BOUNDARIES:
1. READ-ONLY APPLICATION STATUSES: You MUST NOT modify or update application statuses directly in the database. All findings must be submitted as classification proposals into the owner review queue using `submit_classification_proposal`.
2. ZERO OUTBOUND MESSAGING: You MUST NOT send emails, replies, or LinkedIn messages under any circumstance.
3. STRICT EVIDENCE REQUIREMENT: Every proposal must include concrete textual evidence extracted from the subject line and sender information.
4. AMBIGUITY HANDLING: If multiple applications match a company name or the sender cannot be identified with high confidence (>0.7), classify the message as `other_uncertain` and record the ambiguity details in `ambiguity_notes`.
5. BOUNDED BATCHES: Process pending messages in bounded batches of 10 to 25.

WORKFLOW PER RUN:
Step 1: Check runtime status using `runtime_status`. Verify that owner authentication is valid.
Step 2: Fetch pending messages using `list_pending_recruitment_emails`.
Step 3: For each message:
  - Inspect subject and sender details.
  - Search candidate applications using `find_candidate_applications`.
  - Classify the email into one of:
      * application_confirmation
      * rejection
      * interview_invitation
      * assessment
      * recruiter_follow_up
      * offer
      * other_uncertain
  - Submit the proposal using `submit_classification_proposal`.
Step 4: Output a clean, concise execution summary table listing:
  - Queue ID / Message ID
  - Matched Company & Application
  - Classification & Confidence
  - Review Proposal Status
```

---

## 3. Step-by-Step Owner UI Procedure for Grok Connection

Follow these exact steps in the Grok web interface:

1. **Navigate to Grok Connectors / Tools**:
   - Open [Grok Settings](https://grok.com/) -> **Connectors / MCP Tools** -> **Add Custom Tool**.
2. **Enter MCP Server URL**:
   - Set Server URL to: `https://mldtysploensrrulchdl.supabase.co/functions/v1/jf-grok-owner-mcp`
   - Select **OAuth 2.0 / 2.1** authentication.
3. **Interactive Consent Flow**:
   - Grok will automatically open the authorization window to:
     `https://job-farming-dashboard.vercel.app/oauth/consent?authorization_id=...`
   - Ensure you are signed in as `govardhanreddy.vys7@gmail.com`.
   - The consent page displays:
     - Client Name: `Grok`
     - Verified Client ID: `16bdb57f-c2cd-40d8-b6e1-c1a1b17e3f32`
     - Verified Redirect URI: `https://grok.com/connectors-oauth-exchange-code/`
   - Click **Authorize Application**.
4. **Tool Discovery Verification**:
   - After redirecting back to Grok, Grok will call `tools/list`.
   - Grok will display the registered tools:
     - `runtime_status`
     - *(And upon Phase C deployment)*: `list_pending_recruitment_emails`, `get_recruitment_email_details`, `find_candidate_applications`, `submit_classification_proposal`.

---

## 4. Scheduled Hourly Routine Specification

- **Trigger Schedule**: Hourly at **minute 55** (e.g., `55 * * * *`).
- **Dependency Pipeline**:
  - `49 * * * *`: Gmail Ingestion Cron runs unattended, queries Gmail History API, and inserts raw emails into `jobbot.gmail_processing_queue` (`mode: ingestion_only`).
  - `55 * * * *`: Grok Recruitment Intelligence Routine runs, fetches the newly queued pending messages, matches applications, and posts classification proposals to `jobbot.recruitment_review_items`.
- **Manual Gate Before Unattended Activation**:
  - The routine MUST NOT be scheduled in unattended mode until at least ONE interactive run is manually triggered and verified by the owner.
