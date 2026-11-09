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
  Sparkles,
} from "lucide-react";
import { fetchMonitoringStats } from "@/lib/data-service";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function MonitoringPage() {
  const stats = await fetchMonitoringStats();

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Mail className="h-6 w-6 text-sky-500" />
            Recruitment Email Monitoring
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Autonomous ingestion of interview invitations, rejections, assessments, and status transitions from Gmail.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
            <RotateCw className="h-3.5 w-3.5" />
            <span>Poll Inbox Now</span>
          </Button>
        </div>
      </div>

      {/* Sync Health & Engine Status Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-l-4 border-l-emerald-500">
          <CardContent className="p-4 space-y-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground font-semibold">
              <span>Service Health</span>
              <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                Active
              </span>
            </div>
            <div className="text-lg font-bold text-foreground">5-Minute Poller</div>
            <p className="text-[11px] text-muted-foreground">Scheduler enabled & healthy</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-sky-500">
          <CardContent className="p-4 space-y-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground font-semibold">
              <span>Last Confirmed Sync</span>
              <Clock className="h-4 w-4 text-sky-500" />
            </div>
            <div className="text-lg font-bold text-foreground">12m ago</div>
            <p className="text-[11px] text-muted-foreground font-mono">{formatDateTime(stats.lastSyncAt)}</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-purple-500">
          <CardContent className="p-4 space-y-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground font-semibold">
              <span>Emails Evaluated</span>
              <Sparkles className="h-4 w-4 text-purple-500" />
            </div>
            <div className="text-lg font-bold text-foreground">{stats.emailsEvaluatedCount} scanned</div>
            <p className="text-[11px] text-muted-foreground">{stats.statusChangesConfirmedCount} status updates confirmed</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-amber-500">
          <CardContent className="p-4 space-y-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground font-semibold">
              <span>Review Queue</span>
              <AlertTriangle className="h-4 w-4 text-amber-500" />
            </div>
            <div className="text-lg font-bold text-foreground">{stats.needsReviewCount} messages</div>
            <p className="text-[11px] text-muted-foreground">Ambiguous employer matches</p>
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
                  Ambiguous Employer / Application Match Queue
                </CardTitle>
              </div>
              <span className="text-xs px-2 py-0.5 rounded bg-amber-500/20 text-amber-700 dark:text-amber-300 font-semibold">
                Action Required
              </span>
            </div>
            <CardDescription className="text-xs">
              The monitoring LLM flagged these incoming recruiter communications as needing human verification before updating application status.
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
                      {item.from_email}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-600 font-medium">
                      Confidence: {Math.round((item.confidence || 0) * 100)}%
                    </span>
                  </div>
                  <p className="text-muted-foreground">{item.body_excerpt}</p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Button variant="outline" size="sm" className="h-7 text-xs">
                    Confirm Match
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground">
                    Dismiss
                  </Button>
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
              <CardTitle className="text-base font-semibold">Recent Recruitment Ingestion Events</CardTitle>
              <CardDescription className="text-xs">
                History of parsed messages and inferred status updates
              </CardDescription>
            </div>
            <div className="flex items-center gap-1 text-xs">
              <span className="text-muted-foreground">Filter:</span>
              <span className="px-2 py-1 rounded bg-primary text-primary-foreground font-semibold">
                All ({stats.events.length})
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            {stats.events.map((event) => (
              <div key={event.id} className="p-4 hover:bg-muted/30 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs">
                <div className="space-y-1.5 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-foreground text-sm">
                      {event.subject}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-brand-500/10 text-brand-600 dark:text-brand-400">
                      {event.classification}
                    </span>
                  </div>
                  <p className="text-muted-foreground leading-relaxed">
                    {event.body_excerpt}
                  </p>
                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                    <span>From: <strong className="text-foreground">{event.from_email}</strong></span>
                    <span>•</span>
                    <span>Received: {formatDateTime(event.received_at)}</span>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium">
                    {event.action_taken || "Logged"}
                  </span>
                  <span className="text-[10px] font-mono text-muted-foreground">
                    ID: {event.gmail_message_id}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

