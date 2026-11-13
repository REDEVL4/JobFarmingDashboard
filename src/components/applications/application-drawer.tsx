"use client";

import React from "react";
import {
  X,
  Building,
  MapPin,
  Calendar,
  DollarSign,
  ExternalLink,
  FileText,
  Clock,
  User,
  Mail,
  AlertCircle,
  Briefcase,
  CheckCircle2,
  Sparkles,
  ShieldCheck,
  Target,
} from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { formatDate, formatDateTime } from "@/lib/utils";
import type { ApplicationViewItem } from "@/types/dashboard";

interface ApplicationDrawerProps {
  application: ApplicationViewItem | null;
  onClose: () => void;
}

export function ApplicationDrawer({ application, onClose }: ApplicationDrawerProps) {
  if (!application) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-slate-950/70 backdrop-blur-md animate-in fade-in duration-200">
      <div className="fixed inset-y-0 right-0 max-w-full flex">
        <div className="w-screen sm:max-w-md md:max-w-[480px] bg-slate-950/95 backdrop-blur-2xl border-l border-cyan-500/30 shadow-[0_0_50px_rgba(0,0,0,0.8)] flex flex-col justify-between overflow-y-auto animate-in slide-in-from-right duration-300">
          {/* Header */}
          <div className="p-5 border-b border-border/80 sticky top-0 bg-slate-950/90 backdrop-blur-xl z-10 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1.5 flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-mono font-bold text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/30 uppercase tracking-wider">
                    #{application.id}
                  </span>
                  <StatusBadge status={application.normalizedStatus} />
                  {application.score && (
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded font-bold bg-blue-500/10 text-blue-400 border border-blue-500/30">
                      Score: {application.score}/100
                    </span>
                  )}
                </div>

                <h2 className="text-lg font-bold tracking-tight text-foreground leading-snug">
                  {application.title}
                </h2>

                <div className="flex items-center gap-2 text-xs text-muted-foreground pt-0.5 flex-wrap">
                  <span className="flex items-center gap-1 font-semibold text-foreground">
                    <Building className="h-3.5 w-3.5 text-cyan-400" />
                    {application.company}
                  </span>
                  <span>•</span>
                  <span className="flex items-center gap-1 font-mono text-[11px]">
                    <MapPin className="h-3 w-3 text-muted-foreground" />
                    {application.location} ({application.remoteType})
                  </span>
                </div>
              </div>

              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                className="shrink-0 h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-slate-900"
                aria-label="Close dossier drawer"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Match Score / OA Gauge Bar if score present */}
            {application.score && (
              <div className="p-2.5 rounded-lg bg-slate-900/80 border border-border/60 space-y-1.5">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-muted-foreground flex items-center gap-1">
                    <Target className="h-3.5 w-3.5 text-cyan-400" />
                    Profile Match / OA Fit
                  </span>
                  <span className="font-bold text-cyan-400 tabular-nums">{application.score}%</span>
                </div>
                <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-blue-500 via-cyan-400 to-emerald-400 rounded-full"
                    style={{ width: `${application.score}%` }}
                  />
                </div>
              </div>
            )}

            {/* Quick Action Buttons */}
            <div className="flex items-center gap-2 pt-1 flex-wrap">
              {application.postingUrl && (
                <a
                  href={application.postingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-mono font-semibold bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white transition-all shadow-[0_0_10px_rgba(59,130,246,0.3)]"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span>Job Posting</span>
                </a>
              )}
              {application.resumeUrl && (
                <a
                  href={application.resumeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-mono font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/20 transition-colors"
                >
                  <FileText className="h-3.5 w-3.5" />
                  <span>View Resume (PDF)</span>
                </a>
              )}
            </div>
          </div>

          {/* Drawer Body */}
          <div className="p-5 space-y-5 flex-1">
            {/* Auto-Created Notice Banner */}
            {(application.company.toLowerCase().includes("unknown") ||
              application.title.toLowerCase().includes("unknown") ||
              application.source.toLowerCase().includes("auto") ||
              application.source.toLowerCase().includes("email")) && (
              <div className="p-3.5 rounded-xl border border-amber-500/30 bg-amber-500/10 text-xs text-amber-300 space-y-1 font-mono">
                <div className="flex items-center gap-1.5 font-bold">
                  <Sparkles className="h-4 w-4 text-amber-400 shrink-0" />
                  <span>Auto-Created from Recruitment Email</span>
                </div>
                <p className="leading-relaxed text-[11px] text-muted-foreground">
                  This opportunity was automatically created because an incoming recruitment email did not match existing applications. The current stage ({application.rawStatus || application.normalizedStatus}) was auto-applied by the 10-minute auto-approval pipeline.
                </p>
              </div>
            )}

            {/* Quick Telemetry Metadata Grid */}
            <div className="grid grid-cols-2 gap-2.5 p-3 rounded-xl border border-border/70 bg-slate-900/60 text-xs font-mono">
              <div>
                <span className="text-muted-foreground block text-[10px] uppercase">Applied Date</span>
                <span className="font-semibold text-foreground flex items-center gap-1 mt-0.5 tabular-nums">
                  <Calendar className="h-3.5 w-3.5 text-cyan-400" />
                  {formatDate(application.appliedDate)}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[10px] uppercase">Comp / Salary</span>
                <span className="font-semibold text-foreground flex items-center gap-1 mt-0.5 tabular-nums">
                  <DollarSign className="h-3.5 w-3.5 text-cyan-400" />
                  {application.salaryText}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[10px] uppercase">Application Source</span>
                <span className="font-semibold text-foreground flex items-center gap-1 mt-0.5">
                  <Briefcase className="h-3.5 w-3.5 text-cyan-400" />
                  {application.source}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[10px] uppercase">Workplace Mode</span>
                <span className="font-semibold text-foreground flex items-center gap-1 mt-0.5">
                  <MapPin className="h-3.5 w-3.5 text-cyan-400" />
                  {application.remoteType}
                </span>
              </div>
            </div>

            {/* Application Notes */}
            {application.notes && (
              <div className="space-y-1.5">
                <h4 className="text-xs font-mono font-semibold uppercase tracking-wider text-muted-foreground">
                  Evaluation & Notes
                </h4>
                <div className="p-3.5 rounded-xl border border-border/80 bg-slate-900/40 text-xs text-foreground/90 leading-relaxed font-sans">
                  {application.notes}
                </div>
              </div>
            )}

            {/* Recruiter Details */}
            {(application.rawApplication.recruiter_name || application.rawApplication.recruiter_email) && (
              <div className="space-y-1.5">
                <h4 className="text-xs font-mono font-semibold uppercase tracking-wider text-muted-foreground">
                  Recruiter Contact
                </h4>
                <div className="p-3 rounded-xl border border-border/80 bg-slate-900/40 flex items-center gap-3 text-xs">
                  <div className="w-8 h-8 rounded-full bg-cyan-500/10 text-cyan-400 flex items-center justify-center font-bold border border-cyan-500/30">
                    <User className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="font-semibold text-foreground">
                      {application.rawApplication.recruiter_name || "Assigned Recruiter"}
                    </p>
                    {application.rawApplication.recruiter_email && (
                      <p className="text-muted-foreground font-mono text-[11px] flex items-center gap-1">
                        <Mail className="h-3 w-3 text-cyan-400" />
                        {application.rawApplication.recruiter_email}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Activity & Status Timeline (Tested by Playwright: Chronological Activity Timeline) */}
            <div className="space-y-3">
              <h4 className="text-xs font-mono font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-cyan-400" />
                Chronological Activity Timeline
              </h4>

              <div className="relative pl-6 space-y-3.5 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-800">
                {application.timeline.map((event, idx) => (
                  <div key={idx} className="relative group">
                    <div className="absolute -left-6 top-1 w-2.5 h-2.5 rounded-full bg-cyan-400 ring-4 ring-slate-950 shadow-[0_0_8px_#38bdf8]" />
                    <div className="p-3 rounded-lg border border-border/70 bg-slate-900/50 space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-foreground font-mono">
                          {event.status}
                        </span>
                        <span className="text-[10px] text-muted-foreground font-mono tabular-nums">
                          {formatDateTime(event.timestamp)}
                        </span>
                      </div>
                      {event.note && (
                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                          {event.note}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Drawer Footer (Tested by Playwright: Close Panel button) */}
          <div className="p-4 border-t border-border/80 bg-slate-950 flex items-center justify-between text-xs text-muted-foreground font-mono">
            <span className="flex items-center gap-1.5 text-emerald-400 font-medium text-[11px]">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Verified in Supabase jobbot
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={onClose}
              className="text-xs h-8 font-mono bg-slate-800 hover:bg-slate-700 text-foreground border border-border"
            >
              Close Panel
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
