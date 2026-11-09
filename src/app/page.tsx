import React from "react";
import Link from "next/link";
import { ArrowRight, RefreshCw, Sparkles, AlertTriangle } from "lucide-react";
import { fetchApplications, computeMetrics } from "@/lib/data-service";
import { KpiGrid } from "@/components/dashboard/kpi-grid";
import { AnalyticsCharts } from "@/components/dashboard/analytics-charts";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const applications = await fetchApplications();
  const metrics = computeMetrics(applications);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Page Title & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            Executive Command Center
            <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-brand-500/10 text-brand-600 dark:text-brand-400 border border-brand-500/20">
              Live Overview
            </span>
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Tracking {metrics.totalApplications} opportunities across recruitment pipelines, email events, and LinkedIn CRM.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Sync Status</span>
          </Button>

          <Button size="sm" className="h-8 gap-1.5 text-xs bg-brand-600 hover:bg-brand-700 text-white" asChild>
            <Link href="/applications">
              <span>View All Applications</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </div>

      {/* 10 Core KPI Cards */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground tracking-tight flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-brand-500" />
            Key Performance Indicators
          </h2>
          <span className="text-[11px] text-muted-foreground">Click any card to filter applications</span>
        </div>
        <KpiGrid metrics={metrics} />
      </section>

      {/* Visual Analytics & Funnels */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground tracking-tight">
          Pipeline Funnel & Conversion Intelligence
        </h2>
        <AnalyticsCharts metrics={metrics} />
      </section>

      {/* Safety Notice Banner */}
      <div className="p-4 rounded-xl border bg-card/60 flex items-start gap-3 text-xs text-muted-foreground">
        <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-semibold text-foreground">Production Safety Policy Active</p>
          <p>
            Connected to Supabase project <code className="bg-muted px-1 py-0.5 rounded font-mono">mldtysploensrrulchdl</code> (schema: <code className="bg-muted px-1 py-0.5 rounded font-mono">jobbot</code>).
            All dashboard operations are strictly read-only. External LinkedIn invitation dispatch and destructive modifications remain disabled.
          </p>
        </div>
      </div>
    </div>
  );
}
