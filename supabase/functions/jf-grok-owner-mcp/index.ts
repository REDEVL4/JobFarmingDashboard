import 'jsr:@supabase/functions-js@2.4.0/edge-runtime.d.ts';
import { createMcpHandler, McpServer } from 'npm:@modelcontextprotocol/server@2.4.0';
import { pipeline } from 'npm:@supabase/middleware@1.0.0';
import { withOAuthProtectedResource, withSupabase } from 'npm:@supabase/server@1.9.2';
import { z } from 'npm:zod@4.3.6';

import { recordTransportError } from './transport-diagnostic.mjs';
import { recordToolList } from './discovery.mjs';
import { fetchAndSanitizeQueuedEmail } from './gmail-fetcher.ts';

const DIAGNOSTIC_UNTIL = Date.parse('2026-11-13T00:00:00.000Z');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ALLOWED_TOOLS = new Set([
  'runtime_status',
  'list_pending_recruitment_emails',
  'get_recruitment_email_details',
  'find_candidate_applications',
  'submit_classification_proposal',
]);

const VALID_CLASSIFICATIONS = [
  'application_confirmation',
  'rejection',
  'interview_invitation',
  'assessment',
  'recruiter_follow_up',
  'offer',
  'other_uncertain',
  'irrelevant_exclusion',
] as const;

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
    // 4. Database-enforced client validation: single source of truth
    // Verifies registered client, approved Grok callback URI, owner authentication, and active owner consent
    const { data: isClientAuthorized, error: valError } = await ctx.supabase.rpc('jf_validate_grok_oauth_client', {
      p_client_id: clientId,
    });
    if (valError || !isClientAuthorized) {
      return Response.json({ error: 'Unauthorized OAuth client' }, { status: 403 });
    }

    const message = req.method === 'POST' ? await req.clone().json().catch(() => null) : null;

    // Strictly restrict OAuth callers to approved recruitment intelligence tools
    if (message?.method === 'tools/call') {
      const toolName = message.params?.name;
      if (!ALLOWED_TOOLS.has(toolName)) {
        return Response.json({
          jsonrpc: '2.0',
          id: message.id,
          error: {
            code: -32601,
            message: `Tool '${toolName}' is disabled for OAuth clients. Only approved recruitment intelligence tools are permitted.`,
          },
        }, { status: 403 });
      }
    }

    const mcp = createMcpHandler(
      () => {
        const server = new McpServer({ name: 'jf-grok-owner-mcp', version: '0.3.0' });

      // Tool 1: Runtime Status (read-only)
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
          if (error) throw new Error(`Owner-authenticated status unavailable: ${error.message}`);
          return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        },
      );

      // Tool 2: List pending recruitment emails (bounded pagination)
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
          const { data, error } = await ctx.supabase.rpc('jf_grok_list_pending_emails', {
            p_limit: limit ?? 10,
            p_after_id: after_id ?? null,
          });
          if (error) throw new Error(`Failed to list pending emails: ${error.message}`);
          return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        },
      );

      // Tool 3: Get sanitized recruitment email details with on-demand Gmail fetch
      server.registerTool(
        'get_recruitment_email_details',
        {
          title: 'Get recruitment email details',
          description: 'Validates queue ownership and fetches sanitized message content on-demand from Gmail using server-side credentials.',
          inputSchema: z.object({
            queue_id: z.string().uuid(),
          }),
          annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
        },
        async ({ queue_id }) => {
          // 1. Validate queue record existence and ownership via RPC
          const { data: queueRec, error: queueError } = await ctx.supabase.rpc('jf_grok_get_email_details', {
            p_queue_id: queue_id,
          });
          if (queueError || !queueRec) {
            throw new Error(`Queue record not found or inaccessible: ${queueError?.message || 'Not found'}`);
          }

          // 2. Fetch and sanitize message on-demand using server-side OAuth credentials
          try {
            const sanitized = await fetchAndSanitizeQueuedEmail(ctx.supabase, queueRec);
            return { content: [{ type: 'text', text: JSON.stringify(sanitized) }] };
          } catch (fetchErr: any) {
            // Fallback gracefully to queue record metadata if external Gmail API fails temporarily
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  ...queueRec,
                  fetch_status: 'fetch_failed',
                  fetch_error: fetchErr?.message || String(fetchErr),
                }),
              }],
            };
          }
        },
      );

      // Tool 4: Find candidate applications matching company/title
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
          const { data, error } = await ctx.supabase.rpc('jf_grok_find_candidate_applications', {
            p_query: query,
            p_limit: limit ?? 5,
          });
          if (error) throw new Error(`Failed to find candidate applications: ${error.message}`);
          return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        },
      );

      // Tool 5: Submit classification proposal (writes only to review queue, never to applications)
      server.registerTool(
        'submit_classification_proposal',
        {
          title: 'Submit classification proposal',
          description: 'Submits a structured email classification proposal to the owner review queue. Never mutates application status.',
          inputSchema: z.object({
            queue_id: z.string().uuid(),
            classification: z.enum(VALID_CLASSIFICATIONS),
            confidence: z.number().min(0).max(1),
            application_id: z.string().uuid().optional(),
            proposed_stage: z.string().max(50).optional(),
            evidence_summary: z.string().max(1000),
            ambiguity_notes: z.string().max(1000).optional(),
            idempotency_key: z.string().uuid().optional(),
            disposition: z.enum(['proposal', 'exclude']).optional().default('proposal'),
          }),
          annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
        },
        async (params) => {
          if (params.disposition === 'exclude' || params.classification === 'irrelevant_exclusion') {
            const { data, error } = await ctx.supabase.rpc('jf_grok_exclude_irrelevant_email', {
              p_queue_id: params.queue_id,
              p_reason: params.evidence_summary || params.ambiguity_notes || 'Excluded as irrelevant notification',
              p_confidence: params.confidence,
              p_idempotency_key: params.idempotency_key ?? null,
            });
            if (error) throw new Error(`Failed to exclude email: ${error.message}`);
            return { content: [{ type: 'text', text: JSON.stringify(data) }] };
          }

          const { data, error } = await ctx.supabase.rpc('jf_grok_submit_classification_proposal', {
            p_queue_id: params.queue_id,
            p_classification: params.classification,
            p_confidence: params.confidence,
            p_application_id: params.application_id ?? null,
            p_proposed_stage: params.proposed_stage ?? null,
            p_evidence_summary: params.evidence_summary,
            p_ambiguity_notes: params.ambiguity_notes ?? null,
            p_idempotency_key: params.idempotency_key ?? null,
          });
          if (error) throw new Error(`Failed to submit proposal: ${error.message}`);
          return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        },
      );

      return server;
    },
    {
      onerror: (error: any) => {
        console.warn('jf_owner_mcp_error ' + JSON.stringify({
          message: error?.message,
          name: error?.name,
        }));
      },
    });

    const response = await mcp.fetch(req, {
      parsedBody: req.method === 'POST' ? message : undefined,
    });
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
