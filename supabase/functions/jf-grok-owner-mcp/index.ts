import 'jsr:@supabase/functions-js@2.4.0/edge-runtime.d.ts';
import { createMcpHandler, McpServer } from 'npm:@modelcontextprotocol/server@2.4.0';
import { pipeline } from 'npm:@supabase/middleware@1.0.0';
import { withOAuthProtectedResource, withSupabase } from 'npm:@supabase/server@1.9.2';
import { z } from 'npm:zod@4.3.6';

import { recordTransportError } from './transport-diagnostic.mjs';
import { recordToolList } from './discovery.mjs';
import { claimFixture, completeFixture, readFixture } from './fixture.mjs';

const DIAGNOSTIC_UNTIL = Date.parse('2026-11-08T22:57:09.877Z');

const ids = { work_id: z.uuidv4(), revision_id: z.uuidv4() };
const claimInput = z.strictObject({ ...ids, request_id: z.uuidv4() });
const completeInput = z.strictObject({ ...ids, claim_id: z.uuidv4() });

function result(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
}
const handler = pipeline(
  [withOAuthProtectedResource(), withSupabase({ auth: 'user' })],
  async (req, ctx) => {
    if (ctx.jwtClaims?.sub !== 'f2729195-5445-4272-ab85-cac5b03b0967' ||
        ctx.jwtClaims.role !== 'authenticated') {
      return Response.json({ error: 'Owner authentication required' }, { status: 403 });
    }
    const message = req.method === 'POST' ? await req.clone().json().catch(() => null) : null;
    const mcp = createMcpHandler(() => {
      const server = new McpServer({ name: 'jf-grok-owner-mcp', version: '0.2.0' });
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
      const rpc = ctx.supabase.rpc.bind(ctx.supabase);
      server.registerTool('claim_work', {
        description: 'Claim the single enrolled synthetic fixture. Never sends or returns recipient details.',
        inputSchema: claimInput,
        annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
      }, async (input) => result(await claimFixture(rpc, readFixture(Deno.env.get('JF_OWNER_FIXTURE')), claimInput.parse(input))));
      server.registerTool('complete_work', {
        description: 'Record a fixed no-delivery receipt for the enrolled synthetic fixture.',
        inputSchema: completeInput,
        annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
      }, async (input) => result(await completeFixture(rpc, readFixture(Deno.env.get('JF_OWNER_FIXTURE')), completeInput.parse(input))));
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
