import test from 'node:test';
import assert from 'node:assert/strict';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

const DESIGNATED_OWNER_UUID = 'f2729195-5445-4272-ab85-cac5b03b0967';
const ACTIVE_GROK_CLIENT_ID = 'fe569d8d-0593-46ff-84ee-745862b111cc';
const GROK_CALLBACK_URI = 'https://grok.com/connectors-oauth-exchange-code/';

// Simulate the bufferRequest proxy behavior of @supabase/middleware@1.0.0
function bufferRequest(req) {
  let buffer;
  const arrayBuffer = () => (buffer ??= req.arrayBuffer());
  const text = async () => new TextDecoder().decode(await arrayBuffer());
  const cached = {
    arrayBuffer,
    text,
    json: async () => JSON.parse(await text()),
    bytes: async () => new Uint8Array(await arrayBuffer()),
    blob: async () => new Blob([await arrayBuffer()]),
  };
  const BUFFERED_METHODS = new Set(['arrayBuffer', 'text', 'json', 'bytes', 'blob']);
  const handler = {
    get(target, prop) {
      if (typeof prop === 'string' && BUFFERED_METHODS.has(prop)) return cached[prop];
      if (prop === 'clone') return () => new Proxy(target, handler);
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  };
  return new Proxy(req, handler);
}

// Build standard test MCP server with the exact 5 tools registered in index.ts
function buildMcpHandler(mockRpcContext) {
  return createMcpHandler(
    () => {
      const server = new McpServer({ name: 'jf-grok-owner-mcp', version: '0.3.0' });

      // Tool 1: runtime_status
      server.registerTool(
        'runtime_status',
        {
          title: 'Job Farming owner runtime status',
          description: 'Read-only owner-authenticated Job Farming operating flags. Does not process work.',
          inputSchema: z.object({}),
          annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
        },
        async () => {
          const res = await mockRpcContext.rpc('jf_owner_runtime_status');
          return { content: [{ type: 'text', text: JSON.stringify(res.data) }] };
        },
      );

      // Tool 2: list_pending_recruitment_emails
      server.registerTool(
        'list_pending_recruitment_emails',
        {
          title: 'List pending recruitment emails',
          description: 'Retrieves a bounded page of pending emails from the queue for classification analysis.',
          inputSchema: z.object({
            limit: z.number().int().min(1).max(25).optional().default(10),
            after_id: z.string().uuid().optional(),
          }),
          annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
        },
        async ({ limit, after_id }) => {
          const res = await mockRpcContext.rpc('jf_grok_list_pending_emails', { limit, after_id });
          return { content: [{ type: 'text', text: JSON.stringify(res.data) }] };
        },
      );

      // Tool 3: get_recruitment_email_details
      server.registerTool(
        'get_recruitment_email_details',
        {
          title: 'Get recruitment email details',
          description: 'Validates queue ownership and fetches sanitized message content on-demand from Gmail.',
          inputSchema: z.object({
            queue_id: z.string().uuid(),
          }),
          annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
        },
        async ({ queue_id }) => {
          const res = await mockRpcContext.rpc('jf_grok_get_email_details', { queue_id });
          return { content: [{ type: 'text', text: JSON.stringify(res.data) }] };
        },
      );

      // Tool 4: find_candidate_applications
      server.registerTool(
        'find_candidate_applications',
        {
          title: 'Find candidate applications',
          description: 'Searches existing job applications to match against an email sender or company name.',
          inputSchema: z.object({
            query: z.string().min(1).max(100),
            limit: z.number().int().min(1).max(10).optional().default(5),
          }),
          annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
        },
        async ({ query, limit }) => {
          const res = await mockRpcContext.rpc('jf_grok_find_candidate_applications', { query, limit });
          return { content: [{ type: 'text', text: JSON.stringify(res.data) }] };
        },
      );

      // Tool 5: submit_classification_proposal
      server.registerTool(
        'submit_classification_proposal',
        {
          title: 'Submit classification proposal',
          description: 'Submits a structured email classification proposal to the owner review queue.',
          inputSchema: z.object({
            queue_id: z.string().uuid(),
            classification: z.enum([
              'application_confirmation',
              'rejection',
              'interview_invitation',
              'assessment',
              'recruiter_follow_up',
              'offer',
              'other_uncertain',
            ]),
            confidence: z.number().min(0).max(1),
            application_id: z.string().uuid().optional(),
            proposed_stage: z.string().max(50).optional(),
            evidence_summary: z.string().max(1000),
            ambiguity_notes: z.string().max(1000).optional(),
            idempotency_key: z.string().uuid().optional(),
          }),
          annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
        },
        async (params) => {
          const res = await mockRpcContext.rpc('jf_grok_submit_classification_proposal', params);
          return { content: [{ type: 'text', text: JSON.stringify(res.data) }] };
        },
      );

      return server;
    },
    {
      onerror: (error) => {
        // Safe logging test
      },
    },
  );
}

// Simulate the Edge Function pipeline and handler with the fixed mcp.fetch(req, { parsedBody: ... })
async function executeEdgeFunction(rawRequest, jwtClaims, options = { applyFix: true }) {
  // 1. Authenticated owner UUID check
  if (jwtClaims?.sub !== DESIGNATED_OWNER_UUID) {
    return new Response(JSON.stringify({ error: 'Owner authentication required' }), { status: 403 });
  }
  // 2. Authenticated role check
  if (jwtClaims?.role !== 'authenticated') {
    return new Response(JSON.stringify({ error: 'Authenticated role required' }), { status: 403 });
  }
  // 3. Client ID check
  const clientId = jwtClaims?.client_id;
  if (!clientId || typeof clientId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId)) {
    return new Response(JSON.stringify({ error: 'Present and valid OAuth client_id required' }), { status: 403 });
  }
  // 4. Client authorization check
  if (clientId !== ACTIVE_GROK_CLIENT_ID) {
    return new Response(JSON.stringify({ error: 'Unauthorized OAuth client' }), { status: 403 });
  }

  // Middleware wraps req with bufferRequest
  const req = bufferRequest(rawRequest);

  // Line 58: read message
  const message = req.method === 'POST' ? await req.clone().json().catch(() => null) : null;

  // Tool whitelisting check
  const ALLOWED_TOOLS = new Set([
    'runtime_status',
    'list_pending_recruitment_emails',
    'get_recruitment_email_details',
    'find_candidate_applications',
    'submit_classification_proposal',
  ]);
  if (message?.method === 'tools/call') {
    const toolName = message.params?.name;
    if (!ALLOWED_TOOLS.has(toolName)) {
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: message.id,
        error: {
          code: -32601,
          message: `Tool '${toolName}' is disabled for OAuth clients. Only approved recruitment intelligence tools are permitted.`,
        },
      }), { status: 403, headers: { 'content-type': 'application/json' } });
    }
  }

  const mockRpcContext = {
    rpc: async (name, args) => {
      if (name === 'jf_owner_runtime_status') {
        return {
          data: {
            auth_mode: 'designated_owner_oauth_verified',
            owner_uuid: DESIGNATED_OWNER_UUID,
            cron_active: true,
            status_writes_enabled: false,
          },
        };
      }
      if (name === 'jf_grok_list_pending_emails') {
        return {
          data: [
            {
              id: 'd1111111-1111-1111-1111-111111111111',
              sender: 'recruiter@company.com',
              subject: 'Interview Schedule',
              received_at: '2026-11-10T00:00:00Z',
            },
          ],
        };
      }
      return { data: {} };
    },
  };

  const mcp = buildMcpHandler(mockRpcContext);

  if (options.applyFix) {
    return mcp.fetch(req, {
      parsedBody: req.method === 'POST' ? message : undefined,
    });
  } else {
    // Unfixed: calls mcp.fetch(req) without parsedBody
    return mcp.fetch(req);
  }
}

// Helper to parse SSE or JSON response
async function parseMcpResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();
  if (contentType.includes('text/event-stream')) {
    const dataLines = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim());
    return dataLines.map((l) => JSON.parse(l));
  }
  return text.length > 0 ? [JSON.parse(text)] : [];
}

test('Grok Protocol Flow: Unfixed behavior reproduces HTTP 400 Bad Request', async () => {
  const rawReq = new Request('http://localhost', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'accept': 'text/event-stream, application/json',
      'user-agent': 'grok-connectors-manager/0.1.0',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'grok', version: '0.1.0' } },
    }),
  });

  const claims = { sub: DESIGNATED_OWNER_UUID, role: 'authenticated', client_id: ACTIVE_GROK_CLIENT_ID };
  const res = await executeEdgeFunction(rawReq, claims, { applyFix: false });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.error.code, -32700);
  assert.match(data.error.message, /Parse error: the request body could not be read/i);
});

test('Grok Protocol Flow: Complete 5-step sequence with parsedBody fix', async () => {
  const claims = { sub: DESIGNATED_OWNER_UUID, role: 'authenticated', client_id: ACTIVE_GROK_CLIENT_ID };
  const grokHeaders = {
    'content-type': 'application/json',
    'accept': 'text/event-stream, application/json',
    'user-agent': 'grok-connectors-manager/0.1.0',
  };

  // Step 1: initialize
  const initReq = new Request('http://localhost', {
    method: 'POST',
    headers: grokHeaders,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'grok-connectors-manager', version: '0.1.0' },
      },
    }),
  });
  const initRes = await executeEdgeFunction(initReq, claims, { applyFix: true });
  assert.equal(initRes.status, 200);
  const initEvents = await parseMcpResponse(initRes);
  assert.equal(initEvents.length, 1);
  assert.equal(initEvents[0].id, 1);
  assert.equal(initEvents[0].result.serverInfo.name, 'jf-grok-owner-mcp');
  assert.equal(initEvents[0].result.serverInfo.version, '0.3.0');

  // Step 2: notifications/initialized
  const notifyReq = new Request('http://localhost', {
    method: 'POST',
    headers: grokHeaders,
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    }),
  });
  const notifyRes = await executeEdgeFunction(notifyReq, claims, { applyFix: true });
  assert.equal(notifyRes.status, 202); // 202 Accepted for notifications

  // Step 3: tools/list
  const listReq = new Request('http://localhost', {
    method: 'POST',
    headers: grokHeaders,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    }),
  });
  const listRes = await executeEdgeFunction(listReq, claims, { applyFix: true });
  assert.equal(listRes.status, 200);
  const listEvents = await parseMcpResponse(listRes);
  assert.equal(listEvents.length, 1);
  assert.equal(listEvents[0].id, 2);
  const tools = listEvents[0].result.tools;
  assert.equal(tools.length, 5);
  const toolNames = tools.map((t) => t.name).sort();
  assert.deepEqual(toolNames, [
    'find_candidate_applications',
    'get_recruitment_email_details',
    'list_pending_recruitment_emails',
    'runtime_status',
    'submit_classification_proposal',
  ]);

  // Step 4: tools/call runtime_status
  const callStatusReq = new Request('http://localhost', {
    method: 'POST',
    headers: grokHeaders,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'runtime_status',
        arguments: {},
      },
    }),
  });
  const statusRes = await executeEdgeFunction(callStatusReq, claims, { applyFix: true });
  assert.equal(statusRes.status, 200);
  const statusEvents = await parseMcpResponse(statusRes);
  assert.equal(statusEvents.length, 1);
  assert.equal(statusEvents[0].id, 3);
  const statusResult = JSON.parse(statusEvents[0].result.content[0].text);
  assert.equal(statusResult.auth_mode, 'designated_owner_oauth_verified');
  assert.equal(statusResult.owner_uuid, DESIGNATED_OWNER_UUID);

  // Step 5: tools/call list_pending_recruitment_emails with limit 5
  const callListReq = new Request('http://localhost', {
    method: 'POST',
    headers: grokHeaders,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'list_pending_recruitment_emails',
        arguments: {
          limit: 5,
        },
      },
    }),
  });
  const listEmailsRes = await executeEdgeFunction(callListReq, claims, { applyFix: true });
  assert.equal(listEmailsRes.status, 200);
  const listEmailsEvents = await parseMcpResponse(listEmailsRes);
  assert.equal(listEmailsEvents.length, 1);
  assert.equal(listEmailsEvents[0].id, 4);
  const emailsResult = JSON.parse(listEmailsEvents[0].result.content[0].text);
  assert.equal(emailsResult.length, 1);
  assert.equal(emailsResult[0].subject, 'Interview Schedule');
});

test('Grok Protocol Flow: OAuth security safeguards remain intact', async () => {
  const grokHeaders = {
    'content-type': 'application/json',
    'accept': 'text/event-stream, application/json',
  };

  // Reject wrong owner UUID
  const wrongOwnerReq = new Request('http://localhost', {
    method: 'POST',
    headers: grokHeaders,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  const wrongOwnerRes = await executeEdgeFunction(wrongOwnerReq, {
    sub: '00000000-0000-0000-0000-000000000000',
    role: 'authenticated',
    client_id: ACTIVE_GROK_CLIENT_ID,
  });
  assert.equal(wrongOwnerRes.status, 403);

  // Reject unauthorized tool call
  const badToolReq = new Request('http://localhost', {
    method: 'POST',
    headers: grokHeaders,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 99,
      method: 'tools/call',
      params: { name: 'admin_delete_database', arguments: {} },
    }),
  });
  const badToolRes = await executeEdgeFunction(badToolReq, {
    sub: DESIGNATED_OWNER_UUID,
    role: 'authenticated',
    client_id: ACTIVE_GROK_CLIENT_ID,
  });
  assert.equal(badToolRes.status, 403);
  const badToolData = await badToolRes.json();
  assert.equal(badToolData.error.code, -32601);
});
