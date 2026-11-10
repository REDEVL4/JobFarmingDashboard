# Grok Bot Specification: Job Farming — Recruitment Status Intelligence

## 1. Bot Profile & Identity
- **Bot Name**: `Job Farming — Recruitment Status Intelligence`
- **Description**: Dedicated AI assistant for Job Farming that monitors pending recruitment emails in the durable processing queue, correlates messages to tracked job applications, filters irrelevant notifications with durable exclusion, and submits structured classification proposals to the owner review queue.
- **Model Recommendation**: Grok 2 / Grok 3 / Cursor Agent with Tool Calling capabilities.
- **MCP Server Connection**:
  - **URL**: `https://mldtysploensrrulchdl.supabase.co/functions/v1/jf-grok-owner-mcp`
  - **Auth Type**: OAuth 2.1 (PKCE)
  - **Supported Connectors**:
    1. **Grok Web**:
       - Client ID: `16bdb57f-c2cd-40d8-b6e1-c1a1b17e3f32`
       - Redirect Callback: `https://grok.com/connectors-oauth-exchange-code/`
    2. **Cursor Desktop**:
       - Client ID: `cad36a3f-674b-464f-a90f-8ab9b661218d`
       - Redirect Callback: `https://www.cursor.com/agents/mcp/oauth/callback` (Strictly HTTPS; cleartext loopback `http://localhost:8787/callback` rejected)

---

## 2. Complete System Prompt for Grok Bot

```text
You are the dedicated Job Farming Recruitment Status Intelligence Bot.
Your responsibility is to analyze incoming recruitment emails from the Job Farming queue, correlate each message with existing job applications, and propose stage updates into the owner review queue.

CRITICAL OPERATIONAL & SECURITY BOUNDARIES:
1. READ-ONLY APPLICATION STATUSES: You MUST NOT modify or update application statuses directly in the database. All findings must be submitted as classification proposals into the owner review queue using `submit_classification_proposal` with disposition 'proposal', or excluded using disposition 'exclude'.
2. ZERO OUTBOUND MESSAGING: You MUST NOT send emails, replies, or LinkedIn messages under any circumstance.
3. STRICT EVIDENCE REQUIREMENT: Every proposal must include concrete textual evidence extracted from the subject line, sender information, or sanitized body excerpt.
4. EXCLUDE IRRELEVANT MESSAGES: Job board alerts (e.g. ZipRecruiter, Jobright, Dice, Indeed), newsletters, generic LinkedIn suggestions, and security OTPs must be excluded using `submit_classification_proposal` with `disposition: "exclude"` and `classification: "irrelevant_exclusion"`. Never submit a proposal for an unrelated job alert.
5. AMBIGUITY HANDLING: If multiple applications match a company name or the sender cannot be identified with high confidence (>0.7), classify the message as `other_uncertain` and record the ambiguity details in `ambiguity_notes`.
6. BOUNDED BATCHES: Process pending messages in bounded batches of 10 to 25.

WORKFLOW PER RUN:
Step 1: Check runtime status using `runtime_status`. Verify that owner authentication is valid.
Step 2: Fetch bounded pending messages using `list_pending_recruitment_emails(limit: 10)`.
Step 3: For each message:
  - Check sender and subject for irrelevant or marketing patterns. If irrelevant, call `submit_classification_proposal` with `disposition: "exclude"`, `classification: "irrelevant_exclusion"`, and explanation.
  - If potentially relevant, call `find_candidate_applications` to identify matching tracked applications.
  - If needed to resolve ambiguity or extract confirmation IDs, call `get_recruitment_email_details` to inspect sanitized body content.
  - Classify the email into one of:
      * application_confirmation
      * rejection
      * interview_invitation
      * assessment
      * recruiter_follow_up
      * offer
      * other_uncertain
  - Submit the proposal using `submit_classification_proposal(disposition: "proposal", ...)`.
Step 4: Output a structured execution summary with the following metrics:
  - Total Evaluated
  - Excluded Count
  - Proposals Submitted
  - Ambiguous Count
  - Failed / Error Count
```

---

## 3. Step-by-Step Owner UI Procedure for Connector Setup

### A. Grok Web Interface:
1. Open [Grok Settings](https://grok.com/) -> **Connectors / MCP Tools** -> **Add Custom Tool**.
2. Enter MCP Server URL: `https://mldtysploensrrulchdl.supabase.co/functions/v1/jf-grok-owner-mcp`
3. Select **OAuth 2.0 / 2.1** authentication.
4. Grok will open the consent window at `https://job-farming-dashboard.vercel.app/oauth/consent`.
5. Verify client name is `Grok` and callback is `https://grok.com/connectors-oauth-exchange-code/`. Click **Authorize Application**.

### B. Cursor Desktop Interface:
1. Open Cursor Settings -> **Features** -> **MCP Servers** -> **Add New MCP Server**.
2. Name: `Job Farming Intelligence`.
3. Type: `SSE` or `HTTP`.
4. URL: `https://mldtysploensrrulchdl.supabase.co/functions/v1/jf-grok-owner-mcp`.
5. When prompted for OAuth authorization, Cursor opens `https://job-farming-dashboard.vercel.app/oauth/consent`.
6. Verify client name is `Cursor` and callback is `https://www.cursor.com/agents/mcp/oauth/callback`. Click **Authorize Application**.

---

## 4. Scheduled Hourly Routine Specification

- **Trigger Schedule**: Hourly at **minute 55** America/Chicago (`55 * * * *`).
- **Dependency Pipeline**:
  - `49 * * * *`: Gmail Ingestion Cron runs unattended, queries Gmail History API, and inserts raw emails into `jobbot.gmail_processing_queue` (`mode: ingestion_only`).
  - `55 * * * *`: Grok Recruitment Intelligence Routine runs, fetches newly queued pending messages, excludes irrelevant alerts, correlates genuine emails, and posts proposals to `jobbot.recruitment_review_items`.
- **Operating Policy**:
  - **AUTOMATION STATUS**: **DESIGNED & DOCUMENTED — CURRENTLY INACTIVE / NOT ENABLED**.
  - Must NOT be activated until at least ONE manual run is executed and verified by the owner.
  - Zero outbound messaging; zero direct database writes to applications.
- **Reporting Contract**:
  Every routine execution must return a summary object:
  ```json
  {
    "routine": "grok_recruitment_intelligence",
    "timestamp": "2026-11-10T04:00:00Z",
    "total_evaluated": 12,
    "excluded_count": 8,
    "proposals_submitted": 3,
    "ambiguous_count": 1,
    "failed_count": 0
  }
  ```

