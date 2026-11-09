/**
 * Loss-Resistant Gmail Synchronization via History API and Full Query Fallback
 * 
 * Invariants:
 * 1. Do not restrict discovery to Inbox/Sent only (include archived messages).
 * 2. Use Gmail history IDs (users.history.list) for incremental syncing.
 * 3. Gracefully recover from expired history (HTTP 404) by falling back to time-bounded search.
 * 4. Paginate safely, bound message counts, and capture the current historyId on full sync.
 */

export class HistoryExpiredError extends Error {
  constructor(message = "Gmail historyId is too old or expired; full resynchronization required.") {
    super(message);
    this.name = "HistoryExpiredError";
  }
}

export class PermanentMessageInaccessibleError extends Error {
  statusCode: number;
  constructor(messageId: string, statusCode = 404) {
    super(`Gmail message ${messageId} is permanently inaccessible (HTTP ${statusCode})`);
    this.name = "PermanentMessageInaccessibleError";
    this.statusCode = statusCode;
  }
}

export class TransientMessageFetchError extends Error {
  statusCode?: number;
  constructor(messageId: string, errorDetail: string, statusCode?: number) {
    super(`Transient error fetching Gmail message ${messageId}: ${errorDetail}`);
    this.name = "TransientMessageFetchError";
    this.statusCode = statusCode;
  }
}

export interface DiscoveredMessageHeader {
  id: string;
  threadId: string;
  historyId?: string;
  labelIds?: string[];
}

export interface HistorySyncResult {
  strategy: "history" | "query_full" | "gap_reconciliation";
  messages: DiscoveredMessageHeader[];
  latestHistoryId: string | null;
  hasMoreBacklog: boolean;
  nextPageToken: string | null;
  historyExpiredRecovered?: boolean;
}

/**
 * Calls Gmail REST API with error inspection.
 */
async function callGmailApi(token: string, path: string): Promise<any> {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });

  if (res.status === 404) {
    throw new HistoryExpiredError(`Gmail API HTTP 404 on ${path.split("?")[0]}`);
  }

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    throw new Error(`Gmail API HTTP ${res.status} on ${path.split("?")[0]}: ${errorText}`);
  }

  return await res.json();
}

/**
 * Fetches mailbox profile to get current historyId.
 */
export async function getMailboxHistoryId(token: string): Promise<string | null> {
  try {
    const profile = await callGmailApi(token, "profile");
    return profile?.historyId ? String(profile.historyId) : null;
  } catch {
    return null;
  }
}

/**
 * Incremental synchronization using Gmail users.history.list.
 * Detects newly added messages as well as label modifications (e.g. archiving/unarchiving).
 */
export async function syncViaGmailHistory(params: {
  token: string;
  startHistoryId: string;
  maxMessages: number;
  pageToken?: string;
}): Promise<{
  messages: DiscoveredMessageHeader[];
  latestHistoryId: string | null;
  hasMoreBacklog: boolean;
  nextPageToken: string | null;
}> {
  const { token, startHistoryId, maxMessages, pageToken } = params;

  const discoveredMap = new Map<string, DiscoveredMessageHeader>();
  let currentPageToken = pageToken || "";
  let highestHistoryId: string | null = null;
  let lastFullyConsumedHistoryRecordId: string | null = null;
  let reachedLimit = false;

  do {
    const queryParams = new URLSearchParams({
      startHistoryId,
      maxResults: "100",
      historyTypes: "messageAdded",
    });
    // Also include labelAdded to track message moves and archive events
    queryParams.append("historyTypes", "labelAdded");

    if (currentPageToken) {
      queryParams.set("pageToken", currentPageToken);
    }

    const historyData = await callGmailApi(token, `history?${queryParams.toString()}`);

    if (historyData.historyId) {
      highestHistoryId = String(historyData.historyId);
    }

    const historyRecords = historyData.history || [];
    for (const record of historyRecords) {
      // Lossless continuation: If already at or above maxMessages threshold, STOP before starting a new record
      if (discoveredMap.size >= maxMessages) {
        reachedLimit = true;
        break;
      }

      if (record.id && (!highestHistoryId || BigInt(record.id) > BigInt(highestHistoryId))) {
        highestHistoryId = String(record.id);
      }

      // 1. Messages added to mailbox
      for (const added of record.messagesAdded || []) {
        if (added.message?.id) {
          discoveredMap.set(added.message.id, {
            id: added.message.id,
            threadId: added.message.threadId || added.message.id,
            labelIds: added.message.labelIds,
          });
        }
      }

      // 2. Labels added (e.g. user moved or re-labeled an existing message)
      for (const labeled of record.labelsAdded || []) {
        if (labeled.message?.id && !discoveredMap.has(labeled.message.id)) {
          discoveredMap.set(labeled.message.id, {
            id: labeled.message.id,
            threadId: labeled.message.threadId || labeled.message.id,
            labelIds: labeled.labelIds,
          });
        }
      }

      // 3. Messages referenced in record
      for (const msg of record.messages || []) {
        if (msg.id && !discoveredMap.has(msg.id)) {
          discoveredMap.set(msg.id, {
            id: msg.id,
            threadId: msg.threadId || msg.id,
            labelIds: msg.labelIds,
          });
        }
      }

      // Mark this history record as fully consumed
      if (record.id) {
        lastFullyConsumedHistoryRecordId = String(record.id);
      }

      // If completing this record reached or exceeded limit, stop cleanly after full record consumption
      if (discoveredMap.size >= maxMessages) {
        reachedLimit = true;
        break;
      }
    }

    currentPageToken = historyData.nextPageToken || "";
    if (reachedLimit) {
      break;
    }
  } while (currentPageToken);

  const hasMoreBacklog = Boolean(currentPageToken) || reachedLimit;

  // Invariant: If stopped with backlog remaining, checkpoint MUST NOT advance past the last
  // fully consumed history record ID, so the next poll resumes strictly without skipped records.
  const resolvedLatestHistoryId = hasMoreBacklog
    ? (lastFullyConsumedHistoryRecordId || startHistoryId)
    : (highestHistoryId || lastFullyConsumedHistoryRecordId || startHistoryId);

  return {
    messages: Array.from(discoveredMap.values()),
    latestHistoryId: resolvedLatestHistoryId,
    hasMoreBacklog,
    nextPageToken: reachedLimit ? null : (currentPageToken || null),
  };
}

/**
 * Loss-resistant full sync fallback using Gmail messages.list.
 * Removes INBOX/SENT restrictions to capture archived and custom-labeled emails.
 * Does not exclude senders via query; sensitive filtering is applied post-discovery.
 */
export async function syncViaGmailFullSearch(params: {
  token: string;
  queryAfterEpoch: number;
  queryBeforeEpoch?: number | null;
  maxMessages: number;
  pageToken?: string;
}): Promise<{
  messages: DiscoveredMessageHeader[];
  latestHistoryId: string | null;
  hasMoreBacklog: boolean;
  nextPageToken: string | null;
}> {
  const { token, queryAfterEpoch, queryBeforeEpoch, maxMessages, pageToken } = params;

  // Build loss-resistant search query without restrictive label:INBOX OR label:SENT
  // and without hardcoded sender exclusions (filtering happens post-discovery)
  let gmailQuery = `after:${queryAfterEpoch}`;
  if (queryBeforeEpoch) {
    gmailQuery += ` before:${queryBeforeEpoch}`;
  }

  const discovered: DiscoveredMessageHeader[] = [];
  let currentPageToken = pageToken || "";
  let reachedLimit = false;

  do {
    const queryParams = new URLSearchParams({
      q: gmailQuery,
      maxResults: "100",
    });
    if (currentPageToken) {
      queryParams.set("pageToken", currentPageToken);
    }

    const page = await callGmailApi(token, `messages?${queryParams.toString()}`);

    for (const m of page.messages || []) {
      discovered.push({
        id: m.id,
        threadId: m.threadId || m.id,
      });
    }

    currentPageToken = page.nextPageToken || "";
    if (discovered.length >= maxMessages) {
      reachedLimit = true;
      break;
    }
  } while (currentPageToken);

  // Retrieve current mailbox historyId to establish new incremental checkpoint
  const currentHistoryId = await getMailboxHistoryId(token);

  const hasMoreBacklog = Boolean(currentPageToken) || reachedLimit;

  return {
    messages: discovered,
    latestHistoryId: currentHistoryId,
    hasMoreBacklog,
    nextPageToken: currentPageToken || null,
  };
}

/**
 * Fetches full message payload with bounded retries and backoff.
 * Differentiates permanent inaccessible messages (404/410) from transient failures (429/5xx).
 */
export async function fetchMessageWithRetry(
  token: string,
  messageId: string,
  options: { maxRetries?: number; initialBackoffMs?: number } = {}
): Promise<any> {
  const maxRetries = options.maxRetries ?? 3;
  const initialBackoffMs = options.initialBackoffMs ?? 300;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      });

      if (res.status === 404 || res.status === 410) {
        throw new PermanentMessageInaccessibleError(messageId, res.status);
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        if (res.status >= 500 || res.status === 429) {
          if (attempt < maxRetries) {
            const delay = initialBackoffMs * Math.pow(2, attempt - 1);
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
        }
        throw new TransientMessageFetchError(messageId, `HTTP ${res.status}: ${text}`, res.status);
      }

      return await res.json();
    } catch (err: any) {
      if (err instanceof PermanentMessageInaccessibleError) {
        throw err;
      }
      if (attempt < maxRetries && (err?.name === "TimeoutError" || err?.message?.includes("fetch failed"))) {
        const delay = initialBackoffMs * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      if (attempt >= maxRetries) {
        throw new TransientMessageFetchError(messageId, err?.message || String(err));
      }
    }
  }
}

/**
 * Orchestrates loss-resistant Gmail synchronization:
 * 1. Attempts incremental History API sync if startHistoryId is known.
 * 2. Seamlessly falls back to time-bounded search if history is expired or uninitialized.
 */
export async function executeGmailSync(params: {
  token: string;
  startHistoryId?: string | null;
  queryAfterEpoch: number;
  queryBeforeEpoch?: number | null;
  maxMessages: number;
  pageToken?: string;
  gapReconciliation?: boolean;
}): Promise<HistorySyncResult> {
  const {
    token,
    startHistoryId,
    queryAfterEpoch,
    queryBeforeEpoch,
    maxMessages,
    pageToken,
    gapReconciliation,
  } = params;

  // 1. Force full search on gap reconciliation
  if (gapReconciliation) {
    const searchRes = await syncViaGmailFullSearch({
      token,
      queryAfterEpoch,
      queryBeforeEpoch,
      maxMessages,
      pageToken,
    });
    return {
      strategy: "gap_reconciliation",
      messages: searchRes.messages,
      latestHistoryId: searchRes.latestHistoryId,
      hasMoreBacklog: searchRes.hasMoreBacklog,
      nextPageToken: searchRes.nextPageToken,
    };
  }

  // 2. Try History API if a startHistoryId exists
  if (startHistoryId && startHistoryId !== "0") {
    try {
      const historyRes = await syncViaGmailHistory({
        token,
        startHistoryId,
        maxMessages,
        pageToken,
      });
      return {
        strategy: "history",
        messages: historyRes.messages,
        latestHistoryId: historyRes.latestHistoryId,
        hasMoreBacklog: historyRes.hasMoreBacklog,
        nextPageToken: historyRes.nextPageToken,
        historyExpiredRecovered: false,
      };
    } catch (err: any) {
      if (err instanceof HistoryExpiredError || err?.message?.includes("404")) {
        console.warn(`Gmail historyId ${startHistoryId} expired. Executing full recovery search fallback.`);
        // Fall back to full search below
      } else {
        throw err;
      }
    }
  }

  // 3. Full search fallback (no historyId or expired historyId)
  const fullRes = await syncViaGmailFullSearch({
    token,
    queryAfterEpoch,
    queryBeforeEpoch,
    maxMessages,
    pageToken,
  });

  return {
    strategy: "query_full",
    messages: fullRes.messages,
    latestHistoryId: fullRes.latestHistoryId,
    hasMoreBacklog: fullRes.hasMoreBacklog,
    nextPageToken: fullRes.nextPageToken,
    historyExpiredRecovered: Boolean(startHistoryId),
  };
}

