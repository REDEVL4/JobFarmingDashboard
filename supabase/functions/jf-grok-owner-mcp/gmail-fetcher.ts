import { checkSensitiveMessage, sanitizeText } from "./sensitive-filter.ts";

export interface SanitizedEmailResult {
  queue_id: string;
  message_id: string;
  thread_id: string;
  message_timestamp: string;
  sender_clean: string;
  subject_clean: string;
  is_sensitive: boolean;
  exclusion_reason?: string;
  body_text: string;
  snippet: string;
}

/**
 * Retrieves Gmail OAuth credentials via direct server-role PostgREST RPC call.
 * Uses native fetch in-memory so credentials are never accessible to client sessions or logged.
 */
async function getGmailFetchCredentials(): Promise<{ client_id: string; client_secret: string; refresh_token: string }> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Server-side configuration error: missing service environment variables");
  }

  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/jf_get_gmail_fetch_credentials`, {
    method: "POST",
    headers: {
      "apikey": serviceRoleKey,
      "Authorization": `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Gmail credentials retrieval failed (HTTP ${res.status}): ${errText}`);
  }

  const creds = await res.json();
  if (!creds?.client_id || !creds?.client_secret || !creds?.refresh_token) {
    throw new Error("Gmail OAuth credentials unavailable in Vault");
  }
  return creds;
}

function extractBodyFromParts(payload: any): string {
  if (!payload) return "";

  // Direct body data
  if (payload.body?.data) {
    try {
      return atob(payload.body.data.replace(/-/g, "+").replace(/_/g, "/"));
    } catch {
      // Ignore decode error
    }
  }

  // Multipart
  if (Array.isArray(payload.parts)) {
    // Prefer text/plain
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        try {
          return atob(part.body.data.replace(/-/g, "+").replace(/_/g, "/"));
        } catch {
          // Ignore
        }
      }
    }
    // Fall back to text/html
    for (const part of payload.parts) {
      if (part.mimeType === "text/html" && part.body?.data) {
        try {
          return atob(part.body.data.replace(/-/g, "+").replace(/_/g, "/"));
        } catch {
          // Ignore
        }
      }
    }
  }

  return "";
}

/**
 * Fetches and sanitizes a message on-demand using server-side credentials from Vault.
 * Uses service_role client in-memory so credentials are never accessible to client sessions.
 * Never logs or returns tokens or secrets.
 */
export async function fetchAndSanitizeQueuedEmail(
  _userScopedSupabase: any,
  queueRecord: {
    id: string;
    message_id: string;
    thread_id: string;
    message_timestamp: string;
    subject_clean: string;
    sender_clean: string;
  }
): Promise<SanitizedEmailResult> {
  // 1. Retrieve credentials via server-role PostgREST RPC call (server-side only, never exposed to user)
  const creds = await getGmailFetchCredentials();

  // 2. Exchange refresh token for short-lived access token
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      refresh_token: creds.refresh_token,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(10_000),
  });

  const tokenData = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokenData.access_token) {
    throw new Error(`Google token exchange failed (HTTP ${tokenRes.status})`);
  }

  const accessToken = tokenData.access_token;

  // 3. Fetch message from Gmail REST API
  const msgRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${queueRecord.message_id}?format=full`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(12_000),
    }
  );

  if (!msgRes.ok) {
    throw new Error(`Gmail API error (HTTP ${msgRes.status}) while fetching message`);
  }

  const msgData = await msgRes.json();

  // 4. Extract headers and text body
  const headers = msgData.payload?.headers || [];
  const subjectHeader = headers.find((h: any) => h.name?.toLowerCase() === "subject")?.value || queueRecord.subject_clean || "";
  const fromHeader = headers.find((h: any) => h.name?.toLowerCase() === "from")?.value || queueRecord.sender_clean || "";
  const snippet = msgData.snippet || "";
  const rawBody = extractBodyFromParts(msgData.payload) || snippet;

  // 5. Sensitive check
  const sensitiveCheck = checkSensitiveMessage({
    from: fromHeader,
    subject: subjectHeader,
    snippet,
  });

  if (sensitiveCheck.isSensitive) {
    return {
      queue_id: queueRecord.id,
      message_id: queueRecord.message_id,
      thread_id: queueRecord.thread_id,
      message_timestamp: queueRecord.message_timestamp,
      sender_clean: sanitizeText(fromHeader, 200),
      subject_clean: sanitizeText(subjectHeader, 200),
      is_sensitive: true,
      exclusion_reason: sensitiveCheck.reason,
      body_text: "[REDACTED: Sensitive authentication or security message]",
      snippet: "[REDACTED]",
    };
  }

  // 6. Return sanitized recruitment email
  return {
    queue_id: queueRecord.id,
    message_id: queueRecord.message_id,
    thread_id: queueRecord.thread_id,
    message_timestamp: queueRecord.message_timestamp,
    sender_clean: sanitizeText(fromHeader, 200),
    subject_clean: sanitizeText(subjectHeader, 200),
    is_sensitive: false,
    body_text: sanitizeText(rawBody, 2500),
    snippet: sanitizeText(snippet, 500),
  };
}
