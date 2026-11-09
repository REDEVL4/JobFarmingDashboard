"use client";

import React, { useState } from "react";
import {
  Mail,
  CheckCircle2,
  Clock,
  AlertTriangle,
  RotateCw,
  Search,
  ExternalLink,
  ShieldCheck,
  ShieldAlert,
  Sparkles,
  Inbox,
  Play,
  Check,
  XCircle,
  FileText,
  Calendar,
  Layers,
  Info,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/utils";
import type { GmailMonitoringStats } from "@/types/dashboard";

interface MonitoringViewProps {
  initialStats: GmailMonitoringStats;
  fetchStatus: string;
  errorMessage: string | null;
}

export function MonitoringView({ initialStats, fetchStatus, errorMessage }: MonitoringViewProps) {
  const [stats, setStats] = useState<GmailMonitoringStats>(initialStats);
  const [isTriggeringDryRun, setIsTriggeringDryRun] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<any | null>(null);
  const [dryRunError, setDryRunError] = useState<string | null>(null);

  const handleTriggerDryRun = async (gapReconciliation = false) => {
    setIsTriggeringDryRun(true);
    setDryRunError(null);
    try {
      const res = await fetch("/api/monitoring/dry-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gap_reconciliation: gapReconciliation }),
      });
      const data = await res.json();
      if (!res.ok) {
        setDryRunError(data.error || "Failed to trigger dry-run");
      } else {
        setDryRunResult(data);
      }
    } catch (err: any) {
      setDryRunError(err?.message || "Network request failed");
    } finally {
      setIsTriggeringDryRun(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Mail className="h-6 w-6 text-sky-500" />
            Recruitment Email Telemetry & Review
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Independent Supabase monitoring service replacing ChatGPT Status Agent. Real-time telemetry, classification breakdown, and human review queue.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleTriggerDryRun(false)}
            disabled={isTriggeringDryRun}
            className="h-8 text-xs gap-1.5 border-sky-500/30 text-sky-600 dark:text-sky-400 hover:bg-sky-500/10"
          >
            <Play className={`h-3.5 w-3.5 ${isTriggeringDryRun ? "animate-spin" : ""}`} />
            <span>{isTriggeringDryRun ? "Running Dry-Run..." : "Test Dry-Run"}</span>
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={() => handleTriggerDryRun(true)}
            disabled={isTriggeringDryRun}
            className="h-8 text-xs gap-1.5 border-amber-500/30 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
            title="Reconciles messages starting from the last verified checkpoint on Nov 8, 2026 ~22:47 UTC"
          >
            <RotateCw className={`h-3.5 w-3.5 ${isTriggeringDryRun ? "animate-spin" : ""}`} />
            <span>Reconcile Gap (Nov 8)</span>
          </Button>
        </div>
      </div>

      {/* Database Error Alert */}
      {fetchStatus !== "success" && (
        <div className="p-4 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400 space-y-1.5">
          <div className="flex items-center gap-2 font-bold text-sm">
            <ShieldAlert className="h-5 w-5 shrink-0" />
            <span>
              {fetchStatus === "unauthenticated"
                ? "Owner Authentication Required"
                : fetchStatus === "permission_denied"
                ? "Telemetry Query Permission Denied (RLS Boundary)"
                : "Database Connection Failure"}
            </span>
          </div>
          <p className="text-xs leading-relaxed">{errorMessage}</p>
        </div>
      )}

      {/* Dry Run Diagnostic Result Banner */}
      {dryRunResult && (
        <div className="p-4 rounded-xl border border-sky-500/30 bg-sky-500/5 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-bold text-sm text-sky-700 dark:text-sky-400">
              <CheckCircle2 className="h-4 w-4" />
              <span>Dry-Run Diagnostic Completed Successfully</span>
            </div>
            <span className="text-[11px] px-2 py-0.5 rounded bg-sky-500/20 text-sky-800 dark:text-sky-300 font-mono">
              Mode: STRICT_DRY_RUN (0 Writes)
            </span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {dryRunResult.result?.note || "Simulation executed. Application states and review records remain unmodified."}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-xs font-mono">
            <div className="p-2 rounded bg-background border">
              <span className="text-[10px] text-muted-foreground block">Mailbox</span>
              <span className="font-semibold text-foreground truncate block">
                {dryRunResult.result?.mailbox || "govardhanreddy.vys7@gmail.com"}
              </span>
            </div>
            <div className="p-2 rounded bg-background border">
              <span className="text-[10px] text-muted-foreground block">Target Checkpoint</span>
              <span className="font-semibold text-foreground truncate block">
                {dryRunResult.result?.gapReconciliationTarget || "2026-11-08T22:47:41Z"}
              </span>
            </div>
            <div className="p-2 rounded bg-background border">
              <span className="text-[10px] text-muted-foreground block">Proposed Writes</span>
              <span className="font-semibold text-emerald-600 block">
                {dryRunResult.result?.proposedChanges?.length || 0} stages
              </span>
            </div>
            <div className="p-2 rounded bg-background border">
              <span className="text-[10px] text-muted-foreground block">Review Queue Items</span>
              <span className="font-semibold text-amber-600 block">
                {dryRunResult.result?.currentOpenReviews || stats.needsReviewCount} open
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Dry Run Error Banner */}
      {dryRunError && (
        <div className="p-4 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400 space-y-1">
          <div className="flex items-center gap-2 font-bold text-xs">
            <XCircle className="h-4 w-4 shrink-0" />
            <span>Dry-Run Trigger Failed</span>
          </div>
          <p className="text-xs">{dryRunError}</p>
        </div>
      )}

      {/* KPI Cards: Health & Operational Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Connection Status */}
        <Card className="border-l-4 border-l-emerald-500">
          <CardContent className="p-4 space-y-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground font-semibold">
              <span>Gmail API Connection</span>
              <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-bold">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                {stats.connectionStatus === "connected" ? "Connected" : "Standby"}
              </span>
            </div>
            <div className="text-lg font-bold text-foreground truncate">
              govardhanreddy.vys7@gmail.com
            </div>
            <p className="text-[11px] text-muted-foreground">Scope: gmail.readonly (OAuth)</p>
          </CardContent>
        </Card>

        {/* Scheduler Status */}
        <Card className="border-l-4 border-l-sky-500">
          <CardContent className="p-4 space-y-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground font-semibold">
              <span>Hourly Scheduler</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-600 font-semibold">
                {stats.schedulerCron}
              </span>
            </div>
            <div className="text-lg font-bold text-foreground">
              {stats.dryRunEnabled ? "Dry-Run Active" : "Scheduled"}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Last batch: {stats.lastSyncAt ? formatDateTime(stats.lastSyncAt) : "Nov 8, 2026 ~22:47 UTC"}
            </p>
          </CardContent>
        </Card>

        {/* Evaluated & Updates Recorded */}
        <Card className="border-l-4 border-l-purple-500">
          <CardContent className="p-4 space-y-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground font-semibold">
              <span>Emails Evaluated</span>
              <Sparkles className="h-4 w-4 text-purple-500" />
            </div>
            <div className="text-lg font-bold text-foreground">
              {stats.emailsEvaluatedCount} evaluated
            </div>
            <p className="text-[11px] text-muted-foreground">
              {stats.statusChangesConfirmedCount} updates verified in database
            </p>
          </CardContent>
        </Card>

        {/* Review Queue Items */}
        <Card className="border-l-4 border-l-amber-500">
          <CardContent className="p-4 space-y-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground font-semibold">
              <span>Review Queue</span>
              <AlertTriangle className="h-4 w-4 text-amber-500" />
            </div>
            <div className="text-lg font-bold text-foreground">{stats.needsReviewCount} items</div>
            <p className="text-[11px] text-muted-foreground">
              Ambiguous employer correspondence
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Real Classification Breakdown */}
      <Card>
        <CardHeader className="pb-3 border-b">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base font-semibold">Recruitment Email Classifications</CardTitle>
              <CardDescription className="text-xs">
                Derived directly from verified recruitment review and status change records
              </CardDescription>
            </div>
            <span className="text-xs font-mono text-muted-foreground">
              {stats.classificationBreakdown.rejections +
                stats.classificationBreakdown.interviews +
                stats.classificationBreakdown.assessments +
                stats.classificationBreakdown.offers +
                stats.classificationBreakdown.acknowledgments}{" "}
              total outcomes
            </span>
          </div>
        </CardHeader>
        <CardContent className="p-4">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="p-3 rounded-lg border bg-rose-500/5 border-rose-500/20 text-center">
              <span className="text-[11px] text-rose-600 dark:text-rose-400 font-semibold block">
                Rejections
              </span>
              <span className="text-2xl font-bold text-foreground">
                {stats.classificationBreakdown.rejections}
              </span>
            </div>

            <div className="p-3 rounded-lg border bg-purple-500/5 border-purple-500/20 text-center">
              <span className="text-[11px] text-purple-600 dark:text-purple-400 font-semibold block">
                Interviews
              </span>
              <span className="text-2xl font-bold text-foreground">
                {stats.classificationBreakdown.interviews}
              </span>
            </div>

            <div className="p-3 rounded-lg border bg-amber-500/5 border-amber-500/20 text-center">
              <span className="text-[11px] text-amber-600 dark:text-amber-400 font-semibold block">
                Assessments
              </span>
              <span className="text-2xl font-bold text-foreground">
                {stats.classificationBreakdown.assessments}
              </span>
            </div>

            <div className="p-3 rounded-lg border bg-emerald-500/5 border-emerald-500/20 text-center">
              <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold block">
                Offers
              </span>
              <span className="text-2xl font-bold text-foreground">
                {stats.classificationBreakdown.offers}
              </span>
            </div>

            <div className="p-3 rounded-lg border bg-sky-500/5 border-sky-500/20 text-center">
              <span className="text-[11px] text-sky-600 dark:text-sky-400 font-semibold block">
                Awaiting Review
              </span>
              <span className="text-2xl font-bold text-foreground">
                {stats.classificationBreakdown.acknowledgments}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Review Queue Items Stream */}
      <Card>
        <CardHeader className="border-b pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                Active Review Queue ({stats.needsReviewCount} Items)
              </CardTitle>
              <CardDescription className="text-xs">
                Real records from `jobbot.recruitment_review_items` requiring manual confirmation
              </CardDescription>
            </div>
            <span className="text-[11px] px-2.5 py-1 rounded bg-muted text-muted-foreground font-mono">
              Status: Safe / Stage Unchanged
            </span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {stats.events.length === 0 ? (
            <div className="p-12 text-center space-y-2">
              <Inbox className="h-8 w-8 text-muted-foreground mx-auto" />
              <p className="text-sm font-semibold text-foreground">Review Queue Empty</p>
              <p className="text-xs text-muted-foreground">All correspondence has been processed.</p>
            </div>
          ) : (
            <div className="divide-y text-xs max-h-[500px] overflow-y-auto">
              {stats.events.slice(0, 30).map((event) => (
                <div
                  key={event.id}
                  className="p-4 flex flex-col md:flex-row md:items-start justify-between gap-3 hover:bg-muted/40 transition-colors"
                >
                  <div className="space-y-1.5 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-foreground">{event.subject}</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                        {event.sender}
                      </span>
                      {event.classification && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                          Proposed: {event.classification}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 text-muted-foreground font-mono text-[11px]">
                    <Clock className="h-3.5 w-3.5" />
                    <span>{formatDateTime(event.receivedAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
