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

  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolutionFeedback, setResolutionFeedback] = useState<{ id: string; type: "success" | "error"; text: string } | null>(null);

  const handleResolveReview = async (
    itemId: string,
    action: "approve" | "reject" | "needs_review",
    notes?: string,
    targetApplicationId?: string
  ) => {
    setResolvingId(itemId);
    setResolutionFeedback(null);
    try {
      const res = await fetch("/api/recruitment/resolve-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewItemId: itemId, action, notes, targetApplicationId }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setResolutionFeedback({ id: itemId, type: "error", text: data.error || "Failed to resolve review item." });
      } else {
        setResolutionFeedback({
          id: itemId,
          type: "success",
          text:
            action === "approve"
              ? "Proposal approved. Application updated atomically."
              : action === "reject"
              ? "Proposal rejected and queue item marked ignored."
              : "Flagged for owner review with updated notes.",
        });
        setStats((prev) => ({
          ...prev,
          needsReviewCount: Math.max(0, prev.needsReviewCount - (action === "approve" || action === "reject" ? 1 : 0)),
          events: prev.events.map((e) =>
            e.id === itemId
              ? {
                  ...e,
                  state: action === "approve" ? "resolved" : action === "reject" ? "ignored" : "open",
                  actionTaken: action === "approve" ? "approved" : action === "reject" ? "ignored" : "needs_review",
                }
              : e
          ),
        }));
      }
    } catch (err: any) {
      setResolutionFeedback({ id: itemId, type: "error", text: err?.message || "Network error occurred." });
    } finally {
      setResolvingId(null);
    }
  };

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
            Automated recruitment intelligence pipeline. Clear high-confidence classifications are auto-approved every 10 minutes; ambiguous correspondence is held in the review queue.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleTriggerDryRun(false)}
            disabled={isTriggeringDryRun}
            className="h-8 text-xs gap-1.5 border-sky-500/30 text-sky-600 dark:text-sky-400 hover:bg-sky-500/10"
            title="Runs ingestion diagnostic to evaluate incoming messages"
          >
            <Play className={`h-3.5 w-3.5 ${isTriggeringDryRun ? "animate-spin" : ""}`} />
            <span>{isTriggeringDryRun ? "Running Diagnostic..." : "Test Ingestion"}</span>
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

      {/* Auto-Approve Automation Status Banner */}
      <div className="p-3.5 rounded-xl border border-sky-500/30 bg-sky-500/5 text-xs flex items-start gap-3">
        <Sparkles className="h-4 w-4 text-sky-500 shrink-0 mt-0.5" />
        <div className="space-y-0.5">
          <p className="font-semibold text-foreground flex items-center gap-2">
            <span>Automated Classification Pipeline Active</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full font-mono font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              10-Minute Cron
            </span>
          </p>
          <p className="text-muted-foreground leading-relaxed">
            High-confidence classifications (rejections, confirmations, interview invitations, assessments, offers) with 0 or 1 matching application are automatically resolved every 10 minutes. Zero-candidate items automatically create a new opportunity and application with the applied stage. Only ambiguous or multi-candidate emails remain in the queue below for human decision.
          </p>
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
              <span>Recruitment Automation</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold border border-emerald-500/20">
                10m Cycle
              </span>
            </div>
            <div className="text-lg font-bold text-foreground flex items-center gap-2">
              <span>Auto-Approve Active</span>
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
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
              {stats.statusChangesConfirmedCount} updates verified & auto-applied in database
            </p>
          </CardContent>
        </Card>

        {/* Review Queue Items */}
        <Card className="border-l-4 border-l-amber-500">
          <CardContent className="p-4 space-y-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground font-semibold">
              <span>Action Queue</span>
              <AlertTriangle className="h-4 w-4 text-amber-500" />
            </div>
            <div className="text-lg font-bold text-foreground">{stats.needsReviewCount} items</div>
            <p className="text-[11px] text-muted-foreground">
              Ambiguous / low-confidence cases needing review
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
                Derived directly from verified recruitment review records and auto-approved hiring stage updates
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
                Needs Attention
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
                Active Review Queue — Ambiguous & Low-Confidence ({stats.needsReviewCount} Items)
              </CardTitle>
              <CardDescription className="text-xs">
                Clear high-confidence cases are auto-approved every 10 minutes. Only items with multiple candidate matches or low confidence require human disambiguation.
              </CardDescription>
            </div>
            <span className="text-[11px] px-2.5 py-1 rounded bg-muted text-muted-foreground font-mono">
              Auto-Approve Active • Manual Selection Only
            </span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {stats.events.length === 0 ? (
            <div className="p-12 text-center space-y-2">
              <Inbox className="h-8 w-8 text-muted-foreground mx-auto" />
              <p className="text-sm font-semibold text-foreground">Review Queue Clear</p>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                All high-confidence recruitment emails were automatically approved and applied to applications. Only ambiguous correspondence requiring human selection will appear here.
              </p>
            </div>
          ) : (
            <div className="divide-y text-xs max-h-[550px] overflow-y-auto">
              {stats.events.slice(0, 30).map((event) => {
                const candidates = Array.isArray(event.candidate_applications) ? event.candidate_applications : [];
                const matchedCandidate = candidates[0];
                const isResolving = resolvingId === event.id;
                const feedback = resolutionFeedback?.id === event.id ? resolutionFeedback : null;
                const isResolved = event.state === "resolved" || event.actionTaken === "approved";
                const isIgnored = event.state === "ignored" || event.actionTaken === "ignored";
                const isOpen = !isResolved && !isIgnored;

                return (
                  <div
                    key={event.id}
                    className="p-4 space-y-3 hover:bg-muted/40 transition-colors"
                  >
                    <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
                      <div className="space-y-1.5 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-foreground text-sm">{event.subject}</span>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                            {event.sender}
                          </span>
                          {event.classification && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                              Proposed: {event.proposed_stage || event.classification}
                            </span>
                          )}
                          {isResolved && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                              <CheckCircle2 className="h-3 w-3" /> Approved & Updated
                            </span>
                          )}
                          {isIgnored && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border border-zinc-500/20 flex items-center gap-1">
                              <XCircle className="h-3 w-3" /> Ignored
                            </span>
                          )}
                        </div>

                        {event.evidence_summary && (
                          <p className="text-xs text-muted-foreground bg-muted/30 p-2 rounded border border-border/50">
                            <span className="font-medium text-foreground">Evidence: </span>
                            {event.evidence_summary}
                          </p>
                        )}

                        {matchedCandidate && (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="font-medium text-foreground">Matched Application:</span>
                            <span className="font-semibold text-foreground">{matchedCandidate.company}</span>
                            {matchedCandidate.job_title && <span>— {matchedCandidate.job_title}</span>}
                            {matchedCandidate.current_status && (
                              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted">
                                Current: {matchedCandidate.current_status}
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0 text-muted-foreground font-mono text-[11px]">
                        <Clock className="h-3.5 w-3.5" />
                        <span>{formatDateTime(event.receivedAt || event.created_at)}</span>
                      </div>
                    </div>

                    {feedback && (
                      <div
                        className={`text-xs px-3 py-1.5 rounded flex items-center gap-2 ${
                          feedback.type === "success"
                            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20"
                            : "bg-red-500/10 text-red-700 dark:text-red-300 border border-red-500/20"
                        }`}
                      >
                        {feedback.type === "success" ? <Check className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                        <span>{feedback.text}</span>
                      </div>
                    )}

                    {isOpen && (
                      <div className="flex items-center gap-2 pt-1 border-t border-border/40">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isResolving}
                          onClick={() => handleResolveReview(event.id, "approve", undefined, matchedCandidate?.id)}
                          className="h-7 text-xs px-2.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-900/60 border-emerald-200 dark:border-emerald-800"
                        >
                          {isResolving ? (
                            <RotateCw className="h-3 w-3 animate-spin mr-1" />
                          ) : (
                            <Check className="h-3 w-3 mr-1" />
                          )}
                          Approve Transition
                        </Button>

                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isResolving}
                          onClick={() => handleResolveReview(event.id, "reject")}
                          className="h-7 text-xs px-2.5 bg-rose-50 text-rose-700 hover:bg-rose-100 hover:text-rose-800 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-900/60 border-rose-200 dark:border-rose-800"
                        >
                          <XCircle className="h-3 w-3 mr-1" />
                          Reject / Ignore
                        </Button>

                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={isResolving}
                          onClick={() => handleResolveReview(event.id, "needs_review", "Requires manual owner review")}
                          className="h-7 text-xs px-2 text-muted-foreground hover:text-foreground"
                        >
                          <Info className="h-3 w-3 mr-1" />
                          Needs Review
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

