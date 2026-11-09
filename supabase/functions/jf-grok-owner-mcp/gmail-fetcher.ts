import { createClient } from "npm:@supabase/supabase-js@2.49.1";
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

// Internal service-role client initialized in-memory strictly for Vault credential retrieval
let cachedAdminClient: any = null;
function getAdminClient() {
  if (!cachedAdminClient) {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Server-side configuration error: missing service environment variables");
    }
    cachedAdminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cachedAdminClient;
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
  // 1. Retrieve credentials via service_role admin client (not user-scoped client)
  const adminClient = getAdminClient();
  const { data: creds, error: credsError } = await adminClient.rpc("get_gmail_fetch_credentials");
  if (credsError || !creds?.client_id || !creds?.client_secret || !creds?.refresh_token) {
    throw new Error("Gmail OAuth credentials unavailable in Vault");
  }

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
