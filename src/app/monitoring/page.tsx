import React from "react";
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
} from "lucide-react";
import { fetchMonitoringStats } from "@/lib/data-service";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

function getRelativeTime(isoString?: string | null): string {
  if (!isoString) return "No sync recorded";
  try {
    const diffMs = Date.now() - new Date(isoString).getTime();
    if (diffMs < 0) return "Just now";
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  } catch {
    return "Recently";
  }
}

export default async function MonitoringPage() {
  const result = await fetchMonitoringStats();
  const stats = result.data;

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
            Telemetry and human-in-the-loop review for automated recruitment email ingestion (Hourly Poller).
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs px-2.5 py-1 rounded-full bg-muted font-medium text-muted-foreground flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
            Read-Only Telemetry View
          </span>
        </div>
      </div>

      {/* Honest Error Notice */}
      {result.status !== "success" && (
        <div className="p-4 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400 space-y-1.5">
          <div className="flex items-center gap-2 font-bold text-sm">
            <ShieldAlert className="h-5 w-5 shrink-0" />
            <span>
              {result.status === "unauthenticated"
                ? "Owner Authentication Required"
                : result.status === "permission_denied"
                ? "Telemetry Query Permission Denied (RLS Boundary)"
                : "Database Connection Failure"}
            </span>
          </div>
          <p className="text-xs leading-relaxed">{result.error}</p>
        </div>
      )}

      {/* Sync Health & Engine Status Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-l-4 border-l-emerald-500">
          <CardContent className="p-4 space-y-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground font-semibold">
              <span>Engine Status</span>
              <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                {stats.connectionStatus === "connected" ? "Synchronized" : "Idle"}
              </span>
            </div>
            <div className="text-lg font-bold text-foreground">Hourly Poller</div>
            <p className="text-[11px] text-muted-foreground">Configured scheduled incremental run</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-sky-500">
          <CardContent className="p-4 space-y-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground font-semibold">
              <span>Last Confirmed Sync</span>
              <Clock className="h-4 w-4 text-sky-500" />
            </div>
            <div className="text-lg font-bold text-foreground">{getRelativeTime(stats.lastSyncAt)}</div>
            <p className="text-[11px] text-muted-foreground font-mono">{formatDateTime(stats.lastSyncAt)}</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-purple-500">
          <CardContent className="p-4 space-y-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground font-semibold">
              <span>Evaluated Messages</span>
              <Sparkles className="h-4 w-4 text-purple-500" />
            </div>
            <div className="text-lg font-bold text-foreground">{stats.emailsEvaluatedCount} inspected</div>
            <p className="text-[11px] text-muted-foreground">{stats.statusChangesConfirmedCount} updates recorded</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-amber-500">
          <CardContent className="p-4 space-y-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground font-semibold">
              <span>Review Queue</span>
              <AlertTriangle className="h-4 w-4 text-amber-500" />
            </div>
            <div className="text-lg font-bold text-foreground">{stats.needsReviewCount} items</div>
            <p className="text-[11px] text-muted-foreground">Ambiguous employer correspondence</p>
          </CardContent>
        </Card>
      </div>

      {/* Ambiguous Review Queue Banner */}
      {stats.reviewQueue.length > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                <CardTitle className="text-sm font-bold text-foreground">
                  Ambiguous Employer Correspondence Review Queue
                </CardTitle>
              </div>
              <span className="text-xs px-2 py-0.5 rounded bg-amber-500/20 text-amber-700 dark:text-amber-300 font-semibold">
                Action Required ({stats.reviewQueue.length})
              </span>
            </div>
            <CardDescription className="text-xs">
              Incoming correspondence requiring human confirmation before updating application state.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {stats.reviewQueue.map((item) => (
              <div
                key={item.id}
                className="p-3.5 rounded-lg border bg-card text-xs flex flex-col md:flex-row md:items-center justify-between gap-3"
              >
                <div className="space-y-1 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-foreground">{item.subject}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">
                      {item.sender || item.from_email || "Mailbox Item"}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-600 font-medium">
                      Confidence: {Math.round((item.confidence || 0.95) * 100)}%
                    </span>
                  </div>
                  {item.body_excerpt && (
                    <p className="text-muted-foreground">{item.body_excerpt}</p>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[11px] text-muted-foreground font-medium px-2 py-1 rounded bg-muted">
                    Read-Only Review
                  </span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Recruitment Email Events Stream */}
      <Card>
        <CardHeader className="border-b pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base font-semibold">Recruitment Ingestion Records</CardTitle>
              <CardDescription className="text-xs">
                History of parsed messages and inferred status updates from the database
              </CardDescription>
            </div>
            <div className="flex items-center gap-1 text-xs">
              <span className="text-muted-foreground">Total logged:</span>
              <span className="px-2 py-0.5 rounded bg-primary text-primary-foreground font-semibold">
                {stats.events.length}
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {stats.events.length === 0 ? (
            <div className="p-12 text-center space-y-2">
              <Inbox className="h-8 w-8 text-muted-foreground mx-auto" />
              <p className="text-sm font-semibold text-foreground">No Ingestion Records Found</p>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                No recent correspondence events were returned from the sync logs.
              </p>
            </div>
          ) : (
            <div className="divide-y text-xs">
              {stats.events.map((event) => (
                <div
                  key={event.id}
                  className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:bg-muted/40 transition-colors"
                >
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-foreground">{event.subject}</span>
                      <span className="text-[11px] text-muted-foreground">
                        via {event.sender || event.from_email}
                      </span>
                    </div>
                    {event.body_excerpt && (
                      <p className="text-muted-foreground line-clamp-1">{event.body_excerpt}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-3 shrink-0 text-muted-foreground">
                    <span className="capitalize font-medium text-foreground bg-muted px-2 py-0.5 rounded text-[11px]">
                      {event.classification}
                    </span>
                    <span className="font-mono text-[11px]">
                      {formatDateTime(event.receivedAt || event.received_at)}
                    </span>
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
