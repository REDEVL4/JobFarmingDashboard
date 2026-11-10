const methods = new Set(['initialize', 'notifications/initialized', 'tools/list', 'tools/call']);
const categories = [
  [/protocol version/i, 'protocol_version'],
  [/session/i, 'session'],
  [/_meta|envelope/i, 'envelope'],
  [/content.type/i, 'content_type'],
  [/accept.*header/i, 'accept'],
  [/parse error|invalid json|not a valid json-rpc/i, 'parse'],
  [/invalid request|invalid parameters|invalid params/i, 'invalid_request'],
];

export async function recordTransportError(headers, message, response) {
  const error = (await response.json().catch(() => null))?.error;
  const reason = typeof error?.message === 'string'
    ? categories.find(([pattern]) => pattern.test(error.message))?.[1] ?? 'other'
    : 'absent';
  const accept = (headers.get('Accept') ?? '').toLowerCase().split(',').map((value) => value.trim().split(';')[0]);
  const acceptsJson = accept.includes('application/json');
  const acceptsEvents = accept.includes('text/event-stream');
  const contentType = (headers.get('Content-Type') ?? '').toLowerCase().split(';')[0].trim();
  console.info('jf_owner_mcp_transport_diag ' + JSON.stringify({
    method: methods.has(message?.method) ? message.method : 'other',
    status: response.status,
    rpc_code: Number.isSafeInteger(error?.code) ? error.code : null,
    reason,
    error_message: typeof error?.message === 'string' ? error.message.slice(0, 100) : null,
    protocol_header_present: headers.has('MCP-Protocol-Version'),
    session_header_present: headers.has('MCP-Session-Id'),
    accept: acceptsJson && acceptsEvents ? 'json_and_sse' : acceptsJson ? 'json' : acceptsEvents ? 'sse' : 'other',
    content_type: contentType === 'application/json' ? 'json' : contentType ? 'other' : 'absent',
  }));
}
