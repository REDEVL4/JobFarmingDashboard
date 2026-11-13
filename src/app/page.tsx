import React from "react";
import Link from "next/link";
import { ArrowRight, RefreshCw, Sparkles, AlertTriangle, ShieldAlert, Activity } from "lucide-react";
import { fetchApplications, computeMetrics } from "@/lib/data-service";
import { KpiGrid } from "@/components/dashboard/kpi-grid";
import { AnalyticsCharts } from "@/components/dashboard/analytics-charts";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const result = await fetchApplications();
  const applications = result.data;
  const metrics = computeMetrics(applications);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Page Title & Operational Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-3 border-b border-border/60">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            Executive Command Center
            <span className="text-xs px-2.5 py-0.5 rounded-full font-mono font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 flex items-center gap-1.5 shadow-[0_0_10px_rgba(6,182,212,0.2)]">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
              Live Overview
            </span>
          </h1>
          <p className="text-xs text-muted-foreground font-mono mt-1">
            Telemetry stream tracking <span className="text-cyan-400 font-bold tabular-nums">{metrics.totalApplications}</span> opportunities across recruitment pipelines, email events, and LinkedIn CRM.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs font-mono border-border/80 bg-slate-900/40 text-muted-foreground hover:text-cyan-400 hover:border-cyan-500/40"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Sync Status</span>
          </Button>

          <Button
            size="sm"
            className="h-8 gap-1.5 text-xs font-mono bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white shadow-[0_0_15px_rgba(59,130,246,0.35)]"
            asChild
          >
            <Link href="/applications">
              <span>View All Applications</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </div>

      {/* Honest Error / Unauthenticated State */}
      {result.status !== "success" && result.status !== "empty" && (
        <div className="p-4 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-400 space-y-1.5 font-mono text-xs">
          <div className="flex items-center gap-2 font-bold text-sm">
            <ShieldAlert className="h-5 w-5 shrink-0 text-rose-400" />
            <span>
              {result.status === "unauthenticated"
                ? "Owner Authentication Required"
                : result.status === "permission_denied"
                ? "Database Query Permission Denied (RLS Boundary)"
                : "Database Connection Failure"}
            </span>
          </div>
          <p className="leading-relaxed">{result.error}</p>
        </div>
      )}

      {/* Empty Database State */}
      {result.status === "empty" && (
        <div className="p-12 text-center orbital-card rounded-xl space-y-2">
          <p className="text-base font-semibold text-foreground font-mono">Zero Applications In Database</p>
          <p className="text-xs text-muted-foreground font-mono">The job_applications table is currently empty.</p>
        </div>
      )}

      {/* 10 Core KPI Cards */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-mono font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5 text-cyan-400" />
            Key Performance Indicators & Telemetry
          </h2>
          <span className="text-[11px] font-mono text-muted-foreground">Click any card to filter applications</span>
        </div>
        <KpiGrid metrics={metrics} />
      </section>

      {/* Visual Analytics & Funnels */}
      <section className="space-y-3">
        <h2 className="text-xs font-mono font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
          Pipeline Funnel & Conversion Intelligence
        </h2>
        <AnalyticsCharts metrics={metrics} />
      </section>

      {/* Production Safety Policy Notice Banner */}
      <div className="orbital-card p-4 rounded-xl flex items-start gap-3 text-xs text-muted-foreground">
        <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
        <div className="space-y-1 font-mono">
          <p className="font-semibold text-foreground">Production Safety Policy Active</p>
          <p className="text-[11px] leading-relaxed">
            Connected to Supabase project <code className="bg-slate-900/80 px-1 py-0.5 rounded text-cyan-300 font-mono">mldtysploensrrulchdl</code> (schema: <code className="bg-slate-900/80 px-1 py-0.5 rounded text-cyan-300 font-mono">jobbot</code>).
            All dashboard operations are strictly read-only. External LinkedIn invitation dispatch and destructive modifications remain disabled.
          </p>
        </div>
      </div>
    </div>
  );
}
