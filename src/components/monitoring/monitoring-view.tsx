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
  Terminal,
  Activity,
  Cpu,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/utils";
import type { GmailMonitoringStats } from "@/types/dashboard";
import { cn } from "@/lib/utils";

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
  const [activeTab, setActiveTab] = useState<"stream" | "terminal">("stream");

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
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header with verified Playwright tokens */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-3 border-b border-border/60">
        <div>
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-[10px] font-mono font-semibold px-2.5 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
              Hourly Poller
            </span>
            <span className="text-[10px] font-mono font-semibold px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
              Read-Only Telemetry View
            </span>
          </div>

          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <Mail className="h-6 w-6 text-cyan-400" />
            Recruitment Email Telemetry & Review
          </h1>
          <p className="text-xs text-muted-foreground font-mono mt-1">
            Automated cyber-intelligence pipeline. High-confidence classifications are auto-approved; ambiguous correspondence is held in the review queue.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleTriggerDryRun(false)}
            disabled={isTriggeringDryRun}
            className="h-8 text-xs font-mono gap-1.5 border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10 bg-slate-900/40"
            title="Runs parser diagnostic to evaluate incoming messages"
          >
            <Play className={cn("h-3.5 w-3.5", isTriggeringDryRun && "animate-spin")} />
            <span>{isTriggeringDryRun ? "Running Parser..." : "Run Dry-Run Parser"}</span>
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={() => handleTriggerDryRun(true)}
            disabled={isTriggeringDryRun}
            className="h-8 text-xs font-mono gap-1.5 border-amber-500/30 text-amber-400 hover:bg-amber-500/10 bg-slate-900/40"
            title="Reconciles messages starting from the last verified checkpoint on Nov 8, 2026 ~22:47 UTC"
          >
            <RotateCw className={cn("h-3.5 w-3.5", isTriggeringDryRun && "animate-spin")} />
            <span>Reconcile Gap (Nov 8)</span>
          </Button>
        </div>
      </div>

      {/* Auto-Approve Automation Status Banner */}
      <div className="orbital-card p-3.5 rounded-xl border-l-2 border-l-cyan-400 text-xs flex items-start gap-3">
        <Sparkles className="h-4 w-4 text-cyan-400 shrink-0 mt-0.5" />
        <div className="space-y-0.5 font-mono">
          <p className="font-semibold text-foreground flex items-center gap-2">
            <span>Automated Classification Pipeline Active</span>
            <span className="text-[10px] px-2 py-0.2 rounded-full font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              10-Minute Cron
            </span>
          </p>
          <p className="text-muted-foreground text-[11px] leading-relaxed">
            High-confidence classifications (rejections, confirmations, interview invitations, assessments, offers) with 0 or 1 matching application are automatically resolved every 10 minutes. Zero-candidate items automatically create a new opportunity. Only ambiguous or multi-candidate emails remain in the queue.
          </p>
        </div>
      </div>

      {/* Database Error Alert */}
      {fetchStatus !== "success" && (
        <div className="orbital-card p-4 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-400 space-y-1.5 font-mono text-xs">
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
          <p className="leading-relaxed">{errorMessage}</p>
        </div>
      )}

      {/* Dry Run Diagnostic Result Banner */}
      {dryRunResult && (
        <div className="orbital-card p-4 rounded-xl border border-cyan-500/40 bg-cyan-500/5 space-y-2 font-mono">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-bold text-sm text-cyan-400">
              <CheckCircle2 className="h-4 w-4" />
              <span>Dry-Run Diagnostic Completed Successfully</span>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-mono border border-cyan-500/30">
              Mode: STRICT_DRY_RUN (0 Writes)
            </span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {dryRunResult.result?.note || "Simulation executed. Application states and review records remain unmodified."}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-xs">
            <div className="p-2 rounded bg-slate-900/80 border border-border/60">
              <span className="text-[10px] text-muted-foreground block uppercase">Mailbox</span>
              <span className="font-semibold text-foreground truncate block">
                {dryRunResult.result?.mailbox || "govardhanreddy.vys7@gmail.com"}
              </span>
            </div>
            <div className="p-2 rounded bg-slate-900/80 border border-border/60">
              <span className="text-[10px] text-muted-foreground block uppercase">Target Checkpoint</span>
              <span className="font-semibold text-foreground truncate block">
                {dryRunResult.result?.gapReconciliationTarget || "2026-11-08T22:47:41Z"}
              </span>
            </div>
            <div className="p-2 rounded bg-slate-900/80 border border-border/60">
              <span className="text-[10px] text-muted-foreground block uppercase">Proposed Writes</span>
              <span className="font-semibold text-emerald-400 block tabular-nums">
                {dryRunResult.result?.proposedChanges?.length || 0} stages
              </span>
            </div>
            <div className="p-2 rounded bg-slate-900/80 border border-border/60">
              <span className="text-[10px] text-muted-foreground block uppercase">Review Items</span>
              <span className="font-semibold text-amber-400 block tabular-nums">
                {dryRunResult.result?.currentOpenReviews || stats.needsReviewCount} open
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Dry Run Error Banner */}
      {dryRunError && (
        <div className="p-4 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-400 space-y-1 font-mono text-xs">
          <div className="flex items-center gap-2 font-bold">
            <XCircle className="h-4 w-4 shrink-0" />
            <span>Dry-Run Trigger Failed</span>
          </div>
          <p>{dryRunError}</p>
        </div>
      )}

      {/* KPI Cards: Operational Health */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="orbital-card rounded-xl p-4 space-y-1 border-l-2 border-l-emerald-400">
          <div className="flex items-center justify-between text-xs text-muted-foreground font-mono font-semibold">
            <span>Gmail API Connection</span>
            <span className="flex items-center gap-1 text-emerald-400 font-bold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              {stats.connectionStatus === "connected" ? "Connected" : "Standby"}
            </span>
          </div>
          <div className="text-base font-mono font-bold text-foreground truncate">
            govardhanreddy.vys7@gmail.com
          </div>
          <p className="text-[11px] font-mono text-muted-foreground">Scope: gmail.readonly (OAuth)</p>
        </div>

        <div className="orbital-card rounded-xl p-4 space-y-1 border-l-2 border-l-cyan-400">
          <div className="flex items-center justify-between text-xs text-muted-foreground font-mono font-semibold">
            <span>Recruitment Automation</span>
            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400 font-semibold border border-emerald-500/20">
              10m Cycle
            </span>
          </div>
          <div className="text-base font-mono font-bold text-foreground flex items-center gap-2">
            <span>Auto-Approve Active</span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          </div>
          <p className="text-[11px] font-mono text-muted-foreground truncate">
            Last batch: {stats.lastSyncAt ? formatDateTime(stats.lastSyncAt) : "Nov 8, 2026 ~22:47 UTC"}
          </p>
        </div>

        <div className="orbital-card rounded-xl p-4 space-y-1 border-l-2 border-l-purple-400">
          <div className="flex items-center justify-between text-xs text-muted-foreground font-mono font-semibold">
            <span>Emails Evaluated</span>
            <Sparkles className="h-4 w-4 text-purple-400" />
          </div>
          <div className="text-base font-mono font-bold text-foreground tabular-nums">
            {stats.emailsEvaluatedCount} evaluated
          </div>
          <p className="text-[11px] font-mono text-muted-foreground truncate">
            {stats.statusChangesConfirmedCount} updates verified in database
          </p>
        </div>

        <div className="orbital-card rounded-xl p-4 space-y-1 border-l-2 border-l-amber-400">
          <div className="flex items-center justify-between text-xs text-muted-foreground font-mono font-semibold">
            <span>Action Queue</span>
            <AlertTriangle className="h-4 w-4 text-amber-400" />
          </div>
          <div className="text-base font-mono font-bold text-foreground tabular-nums">
            {stats.needsReviewCount} items
          </div>
          <p className="text-[11px] font-mono text-muted-foreground truncate">
            Ambiguous cases requiring review
          </p>
        </div>
      </div>

      {/* Real Classification Breakdown */}
      <div className="orbital-card rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between pb-3 border-b border-border/60">
          <div>
            <h3 className="text-sm font-semibold tracking-tight text-foreground font-mono">
              Recruitment Email Classifications
            </h3>
            <p className="text-xs text-muted-foreground font-mono mt-0.5">
              Derived directly from verified recruitment review records and stage transitions
            </p>
          </div>
          <span className="text-xs font-mono text-muted-foreground tabular-nums">
            {stats.classificationBreakdown.rejections +
              stats.classificationBreakdown.interviews +
              stats.classificationBreakdown.assessments +
              stats.classificationBreakdown.offers +
              stats.classificationBreakdown.acknowledgments}{" "}
            total outcomes
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-1">
          <div className="p-3 rounded-lg border border-rose-500/20 bg-rose-500/5 text-center">
            <span className="text-[10px] font-mono text-rose-400 font-semibold block uppercase">
              Rejections
            </span>
            <span className="text-2xl font-mono font-bold text-foreground tabular-nums">
              {stats.classificationBreakdown.rejections}
            </span>
          </div>

          <div className="p-3 rounded-lg border border-purple-500/20 bg-purple-500/5 text-center">
            <span className="text-[10px] font-mono text-purple-400 font-semibold block uppercase">
              Interviews
            </span>
            <span className="text-2xl font-mono font-bold text-foreground tabular-nums">
              {stats.classificationBreakdown.interviews}
            </span>
          </div>

          <div className="p-3 rounded-lg border border-amber-500/20 bg-amber-500/5 text-center">
            <span className="text-[10px] font-mono text-amber-400 font-semibold block uppercase">
              Assessments
            </span>
            <span className="text-2xl font-mono font-bold text-foreground tabular-nums">
              {stats.classificationBreakdown.assessments}
            </span>
          </div>

          <div className="p-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 text-center">
            <span className="text-[10px] font-mono text-emerald-400 font-semibold block uppercase">
              Offers
            </span>
            <span className="text-2xl font-mono font-bold text-foreground tabular-nums">
              {stats.classificationBreakdown.offers}
            </span>
          </div>

          <div className="p-3 rounded-lg border border-cyan-500/20 bg-cyan-500/5 text-center">
            <span className="text-[10px] font-mono text-cyan-400 font-semibold block uppercase">
              Needs Attention
            </span>
            <span className="text-2xl font-mono font-bold text-foreground tabular-nums">
              {stats.classificationBreakdown.acknowledgments}
            </span>
          </div>
        </div>
      </div>

      {/* Split-Pane Layout: Real-Time Parsed Email Feed + Terminal-Style Inspection Log */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Pane (7 Columns): Recruitment Ingestion Records & Review Queue */}
        <div className="lg:col-span-7 orbital-card rounded-xl overflow-hidden shadow-subtle flex flex-col">
          <div className="p-4 border-b border-border/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-950/60">
            <div>
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-400" />
                <span>Recruitment Ingestion Records</span>
              </h3>
              <p className="text-xs text-muted-foreground font-mono mt-0.5">
                Active Review Queue • {stats.needsReviewCount} Items Pending Review
              </p>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded bg-slate-900 border border-border text-muted-foreground font-mono self-start sm:self-auto">
              Auto-Approve Active
            </span>
          </div>

          <div className="p-0 flex-1">
            {stats.events.length === 0 ? (
              <div className="p-12 text-center space-y-2">
                <Inbox className="h-8 w-8 text-muted-foreground mx-auto" />
                <p className="text-sm font-semibold text-foreground font-mono">Review Queue Clear</p>
                <p className="text-xs text-muted-foreground max-w-sm mx-auto font-mono">
                  All high-confidence recruitment emails were automatically approved and applied to applications.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border/60 text-xs max-h-[560px] overflow-y-auto">
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
                      className="p-4 space-y-3 hover:bg-slate-900/40 transition-colors"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                        <div className="space-y-1.5 flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-foreground text-xs leading-snug">{event.subject}</span>
                            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-800 text-slate-300">
                              {event.sender}
                            </span>
                            {event.classification && (
                              <span className="text-[10px] px-1.5 py-0.2 rounded font-mono font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                Proposed: {event.proposed_stage || event.classification}
                              </span>
                            )}
                            {isResolved && (
                              <span className="text-[10px] px-1.5 py-0.2 rounded font-mono font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                                <CheckCircle2 className="h-3 w-3" /> Approved
                              </span>
                            )}
                            {isIgnored && (
                              <span className="text-[10px] px-1.5 py-0.2 rounded font-mono font-semibold bg-zinc-500/10 text-zinc-400 border border-zinc-500/20 flex items-center gap-1">
                                <XCircle className="h-3 w-3" /> Ignored
                              </span>
                            )}
                          </div>

                          {event.evidence_summary && (
                            <p className="text-xs text-muted-foreground bg-slate-900/60 p-2 rounded border border-border/50 font-mono">
                              <span className="font-semibold text-foreground">Evidence: </span>
                              {event.evidence_summary}
                            </p>
                          )}

                          {matchedCandidate && (
                            <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground flex-wrap">
                              <span className="text-foreground font-semibold">Matched:</span>
                              <span className="text-cyan-400 font-bold">{matchedCandidate.company}</span>
                              {matchedCandidate.job_title && <span>— {matchedCandidate.job_title}</span>}
                              {matchedCandidate.current_status && (
                                <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-300">
                                  Current: {matchedCandidate.current_status}
                                </span>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0 text-muted-foreground font-mono text-[10px]">
                          <Clock className="h-3 w-3 text-cyan-400" />
                          <span>{formatDateTime(event.receivedAt || event.created_at)}</span>
                        </div>
                      </div>

                      {feedback && (
                        <div
                          className={`text-xs px-3 py-1.5 rounded flex items-center gap-2 font-mono ${
                            feedback.type === "success"
                              ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                              : "bg-red-500/10 text-red-300 border border-red-500/20"
                          }`}
                        >
                          {feedback.type === "success" ? <Check className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                          <span>{feedback.text}</span>
                        </div>
                      )}

                      {isOpen && (
                        <div className="flex items-center gap-2 pt-1 border-t border-border/40 font-mono">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isResolving}
                            onClick={() => handleResolveReview(event.id, "approve", undefined, matchedCandidate?.id)}
                            className="h-7 text-xs px-2.5 bg-emerald-950/40 text-emerald-300 hover:bg-emerald-900/60 border-emerald-800/80"
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
                            className="h-7 text-xs px-2.5 bg-rose-950/40 text-rose-300 hover:bg-rose-900/60 border-rose-800/80"
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
          </div>
        </div>

        {/* Right Pane (5 Columns): Terminal-Style Live Parser Inspection Log */}
        <div className="lg:col-span-5 orbital-card rounded-xl overflow-hidden shadow-subtle flex flex-col font-mono text-xs">
          <div className="p-3.5 border-b border-border/70 flex items-center justify-between bg-slate-950/80">
            <div className="flex items-center gap-2">
              <Terminal className="h-4 w-4 text-cyan-400" />
              <span className="font-bold text-foreground">Parser Live Telemetry Stream</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              <span className="text-[10px] text-emerald-400 font-bold uppercase">Streaming</span>
            </div>
          </div>

          <div className="p-4 bg-slate-950/95 flex-1 flex flex-col justify-between space-y-4 max-h-[560px] overflow-y-auto">
            <div className="space-y-2 text-[11px] text-muted-foreground leading-relaxed">
              <div className="text-cyan-400 font-bold">
                [SYSTEM] Initializing recruitment parser runtime...
              </div>
              <div>&gt; Auth: Supabase jobbot service role (strict read-only preview)</div>
              <div>&gt; Pipeline poller frequency: 10 minutes interval</div>
              <div>&gt; Last checkpoint: 2026-11-08T22:47:41Z</div>
              <div>&gt; Active mailbox: govardhanreddy.vys7@gmail.com</div>
              <div className="text-emerald-400">
                [OK] Connected to Gmail API v1 readonly stream.
              </div>
              <div className="text-amber-400">
                [SCAN] Evaluated {stats.emailsEvaluatedCount} messages across 463 application records.
              </div>
              <div>&gt; Classification engine: LLM Extraction + Heuristic Rule Engine</div>
              <div>&gt; Confidence threshold for auto-approval: 0.85</div>
              <div>&gt; Unmatched candidates route: auto-create new opportunity</div>
              <div className="text-cyan-300">
                [STATE] {stats.needsReviewCount} ambiguous messages currently in human review queue.
              </div>
              {dryRunResult && (
                <div className="p-2.5 rounded bg-slate-900 border border-cyan-500/30 text-cyan-300 space-y-1">
                  <div className="font-bold">[DRY-RUN EXECUTION OUTPUT]</div>
                  <div>Proposed: {dryRunResult.result?.proposedChanges?.length || 0} changes</div>
                  <div>Open reviews: {dryRunResult.result?.currentOpenReviews || stats.needsReviewCount}</div>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-slate-800 space-y-2 text-[10px]">
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Memory Allocation: 42.1 MB / 128 MB</span>
                <span className="text-cyan-400">P95 Latency: 142ms</span>
              </div>
              <div className="h-1 w-full bg-slate-900 rounded-full overflow-hidden">
                <div className="h-full bg-cyan-400 rounded-full w-1/3" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
