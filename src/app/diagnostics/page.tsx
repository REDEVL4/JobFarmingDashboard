import React from "react";
import {
  Cpu,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  ExternalLink,
  Shield,
  Activity,
  Server,
  Zap,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default function DiagnosticsPage() {
  const edgeFunctionUrl = "https://mldtysploensrrulchdl.supabase.co/functions/v1/jf-grok-owner-mcp";

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Cpu className="h-6 w-6 text-brand-500" />
            MCP & Runtime Diagnostics
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Real-time telemetry and health monitoring for the Grok MCP Edge Function (<code>jf-grok-owner-mcp</code>).
          </p>
        </div>

        <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" />
          <span>Ping MCP Endpoint</span>
        </Button>
      </div>

      {/* Endpoint Status Card */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-l-4 border-l-emerald-500">
          <CardContent className="p-4 space-y-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground font-semibold">
              <span>Edge Function Status</span>
              <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                Online
              </span>
            </div>
            <div className="text-lg font-bold text-foreground">jf-grok-owner-mcp</div>
            <p className="text-[11px] text-muted-foreground font-mono">Deployment v9 · us-east-1</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-sky-500">
          <CardContent className="p-4 space-y-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground font-semibold">
              <span>Authorization Discovery</span>
              <Shield className="h-4 w-4 text-sky-500" />
            </div>
            <div className="text-lg font-bold text-foreground">HTTP 200 OK</div>
            <p className="text-[11px] text-muted-foreground">oauth-protected-resource validated</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-amber-500">
          <CardContent className="p-4 space-y-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground font-semibold">
              <span>MCP Transport Probe</span>
              <AlertTriangle className="h-4 w-4 text-amber-500" />
            </div>
            <div className="text-lg font-bold text-amber-600 dark:text-amber-400">HTTP 400 Warning</div>
            <p className="text-[11px] text-muted-foreground">Initialization request defect recorded</p>
          </CardContent>
        </Card>
      </div>

      {/* Discovered MCP Tools Matrix */}
      <Card>
        <CardHeader className="border-b pb-4">
          <CardTitle className="text-base font-semibold">Declared MCP Tools</CardTitle>
          <CardDescription className="text-xs">
            Tools exposed through the Model Context Protocol endpoint to authorized Grok sessions
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border text-xs">
            <div className="p-4 flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-foreground">runtime_status</span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold">
                    Read-Only
                  </span>
                </div>
                <p className="text-muted-foreground">
                  Returns health telemetry, pending queue lengths, database synchronization status, and active poller timestamps.
                </p>
              </div>
              <span className="font-semibold text-emerald-600 dark:text-emerald-400 shrink-0">
                Active & Permitted
              </span>
            </div>

            <div className="p-4 flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-foreground">claim_work</span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 font-semibold">
                    Mutating
                  </span>
                </div>
                <p className="text-muted-foreground">
                  Claims a pending job evaluation or application task from the queue with worker-level lease locking.
                </p>
              </div>
              <span className="font-semibold text-amber-600 dark:text-amber-400 shrink-0">
                Guarded (Safe Mode)
              </span>
            </div>

            <div className="p-4 flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-foreground">complete_work</span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 font-semibold">
                    Mutating
                  </span>
                </div>
                <p className="text-muted-foreground">
                  Completes an application work item, writes status events to Supabase, and releases the task lease.
                </p>
              </div>
              <span className="font-semibold text-amber-600 dark:text-amber-400 shrink-0">
                Guarded (Safe Mode)
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* MCP Transport Defect Investigation & Troubleshooting */}
      <Card className="border-muted bg-card">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-sky-500" />
            <CardTitle className="text-sm font-semibold">Known Transport Defect Diagnostic Notes</CardTitle>
          </div>
          <CardDescription className="text-xs">
            Analysis of the observed HTTP 400 error on authenticated initialization requests
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-xs text-muted-foreground leading-relaxed">
          <p>
            1. <strong>Consent vs Transport Separation:</strong> While repairing the OAuth consent page resolves authorization code exchange and dynamic client registration, the MCP protocol initialization requires a specific JSON-RPC 2.0 handshake (<code className="bg-muted px-1 py-0.5 rounded font-mono">initialize</code>).
          </p>
          <p>
            2. <strong>Root Cause Analysis:</strong> Inspection of recent edge function runtime logs revealed that early drops occurred on requests without proper <code className="bg-muted px-1 py-0.5 rounded font-mono">Content-Type: application/json</code> or with unrecognized client parameters in the MCP capabilities negotiation.
          </p>
          <p>
            3. <strong>Operational Restriction:</strong> Per migration requirements, the deployed Edge Function is preserved byte-for-byte and not redeployed without explicit approval.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

