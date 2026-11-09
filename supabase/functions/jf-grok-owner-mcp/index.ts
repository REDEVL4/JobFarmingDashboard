import 'jsr:@supabase/functions-js@2.4.0/edge-runtime.d.ts';
import { createMcpHandler, McpServer } from 'npm:@modelcontextprotocol/server@2.4.0';
import { pipeline } from 'npm:@supabase/middleware@1.0.0';
import { withOAuthProtectedResource, withSupabase } from 'npm:@supabase/server@1.9.2';
import { z } from 'npm:zod@4.3.6';

import { recordTransportError } from './transport-diagnostic.mjs';
import { recordToolList } from './discovery.mjs';

const DIAGNOSTIC_UNTIL = Date.parse('2026-11-08T22:57:09.877Z');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIVE_GROK_CLIENT_ID = '16bdb57f-c2cd-40d8-b6e1-c1a1b17e3f32';
const TRUSTED_CLIENT_IDS = new Set([
  // Primary active Grok connector (historical registrations & Cursor removed for least privilege)
  ACTIVE_GROK_CLIENT_ID,
]);

const handler = pipeline(
  [withOAuthProtectedResource(), withSupabase({ auth: 'user' })],
  async (req, ctx) => {
    // 1. Authenticated owner UUID check
    if (ctx.jwtClaims?.sub !== 'f2729195-5445-4272-ab85-cac5b03b0967') {
      return Response.json({ error: 'Owner authentication required' }, { status: 403 });
    }
    // 2. Authenticated role check
    if (ctx.jwtClaims?.role !== 'authenticated') {
      return Response.json({ error: 'Authenticated role required' }, { status: 403 });
    }
    // 3. Present and valid OAuth client_id check (reject missing, null, empty, malformed)
    const clientId = ctx.jwtClaims?.client_id;
    if (!clientId || typeof clientId !== 'string' || !UUID_REGEX.test(clientId)) {
      return Response.json({ error: 'Present and valid OAuth client_id required' }, { status: 403 });
    }
    // 4. Explicitly approved client ID check (reject unknown / dynamic clients)
    if (!TRUSTED_CLIENT_IDS.has(clientId)) {
      return Response.json({ error: 'Unauthorized OAuth client' }, { status: 403 });
    }
    const message = req.method === 'POST' ? await req.clone().json().catch(() => null) : null;
    // Strictly restrict OAuth callers to read-only runtime_status tool execution
    if (message?.method === 'tools/call') {
      const toolName = message.params?.name;
      if (toolName !== 'runtime_status') {
        return Response.json({
          jsonrpc: '2.0',
          id: message.id,
          error: {
            code: -32601,
            message: `Tool '${toolName}' is disabled for OAuth clients. Only read-only 'runtime_status' is permitted.`,
          },
        }, { status: 403 });
      }
    }
    const mcp = createMcpHandler(() => {
      const server = new McpServer({ name: 'jf-grok-owner-mcp', version: '0.2.0' });
      // Only register read-only runtime_status; do not advertise mutation tools in tools/list
      server.registerTool(
        'runtime_status',
        {
          title: 'Job Farming owner runtime status',
          description: 'Read-only owner-authenticated Job Farming operating flags. Does not process work.',
          inputSchema: z.object({}),
          annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
        },
        async () => {
          const { data, error } = await ctx.supabase.rpc('jf_owner_runtime_status');
          if (error) throw new Error('Owner-authenticated status unavailable');
          return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        },
      );
      return server;
    });
    const response = await mcp.fetch(req);
    if (Date.now() < DIAGNOSTIC_UNTIL && req.method === 'POST' && response.status === 400) {
      try {
        EdgeRuntime.waitUntil(recordTransportError(req.headers, message, response.clone()).catch(() => {}));
      } catch {
        // Diagnostics must not change the response.
      }
    }
    if (message?.method === 'tools/list' && response.ok) {
      EdgeRuntime.waitUntil(recordToolList(response.clone(), message.id));
    }
    return response;
  },
);

Deno.serve((req) => handler(req));
