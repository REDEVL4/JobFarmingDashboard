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
    <div className="fixed inset-0 z-50 overflow-hidden bg-background/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-xl bg-card border-l shadow-2xl flex flex-col justify-between overflow-y-auto">
          {/* Header */}
          <div className="p-6 border-b sticky top-0 bg-card/95 backdrop-blur z-10">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                    {application.id}
                  </span>
                  <StatusBadge status={application.normalizedStatus} />
                  {application.score && (
                    <span className="text-xs px-2 py-0.5 rounded font-bold bg-brand-500/10 text-brand-600 dark:text-brand-400 border border-brand-500/20">
                      Score: {application.score}/5
                    </span>
                  )}
                </div>
                <h2 className="text-xl font-bold tracking-tight text-foreground">
                  {application.title}
                </h2>
                <div className="flex items-center gap-3 text-sm text-muted-foreground pt-0.5">
                  <span className="flex items-center gap-1 font-medium text-foreground">
                    <Building className="h-4 w-4 text-muted-foreground" />
                    {application.company}
                  </span>
                  <span>•</span>
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                    {application.location} ({application.remoteType})
                  </span>
                </div>
              </div>

              <Button variant="ghost" size="icon" onClick={onClose} className="shrink-0">
                <X className="h-5 w-5" />
              </Button>
            </div>
          </div>

          {/* Drawer Body */}
          <div className="p-6 space-y-6 flex-1">
            {/* Quick Metadata Bar */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-3.5 rounded-xl border bg-muted/30 text-xs">
              <div>
                <span className="text-muted-foreground block text-[11px]">Applied Date</span>
                <span className="font-semibold text-foreground flex items-center gap-1 mt-0.5">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                  {formatDate(application.appliedDate)}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[11px]">Comp / Salary</span>
                <span className="font-semibold text-foreground flex items-center gap-1 mt-0.5">
                  <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
                  {application.salaryText}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[11px]">Application Mode</span>
                <span className="font-semibold text-foreground flex items-center gap-1 mt-0.5">
                  <Briefcase className="h-3.5 w-3.5 text-muted-foreground" />
                  {application.source}
                </span>
              </div>
            </div>

            {/* Application Notes */}
            {application.notes && (
              <div className="space-y-1.5">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Evaluation & Notes
                </h4>
                <div className="p-3.5 rounded-xl border bg-card text-xs text-foreground/90 leading-relaxed font-sans">
                  {application.notes}
                </div>
              </div>
            )}

            {/* Recruiter Details */}
            {(application.rawApplication.recruiter_name || application.rawApplication.recruiter_email) && (
              <div className="space-y-1.5">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Recruiter Contact
                </h4>
                <div className="p-3 rounded-xl border bg-card flex items-center gap-3 text-xs">
                  <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold">
                    <User className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="font-semibold text-foreground">
                      {application.rawApplication.recruiter_name || "Assigned Recruiter"}
                    </p>
                    {application.rawApplication.recruiter_email && (
                      <p className="text-muted-foreground flex items-center gap-1">
                        <Mail className="h-3 w-3" />
                        {application.rawApplication.recruiter_email}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Activity & Status Timeline */}
            <div className="space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                Chronological Activity Timeline
              </h4>

              <div className="relative pl-6 space-y-4 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-border">
                {application.timeline.map((event, idx) => (
                  <div key={idx} className="relative group">
                    <div className="absolute -left-6 top-1 w-2.5 h-2.5 rounded-full bg-primary ring-4 ring-background" />
                    <div className="p-3 rounded-lg border bg-card shadow-subtle space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-foreground">
                          {event.status}
                        </span>
                        <span className="text-[11px] text-muted-foreground font-mono">
                          {formatDateTime(event.timestamp)}
                        </span>
                      </div>
                      {event.note && (
                        <p className="text-xs text-muted-foreground">
                          {event.note}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Associated Documents */}
            <div className="space-y-2 pt-2 border-t">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Documents & Links
              </h4>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                  <FileText className="h-3.5 w-3.5 text-brand-500" />
                  <span>Tailored Resume (PDF)</span>
                </Button>
                {application.applicationUrl && (
                  <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" asChild>
                    <a href={application.applicationUrl} target="_blank" rel="noreferrer">
                      <span>Posting Portal</span>
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Drawer Footer */}
          <div className="p-4 border-t bg-muted/20 flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Verified in Supabase jobbot
            </span>
            <Button variant="secondary" size="sm" onClick={onClose} className="text-xs h-8">
              Close Panel
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

