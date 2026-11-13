"use client";

import React from "react";
import Link from "next/link";
import {
  FileText,
  Send,
  Clock,
  Search,
  CalendarCheck,
  Code,
  XCircle,
  Trophy,
  MessageSquare,
  AlertCircle,
  ArrowUpRight,
} from "lucide-react";
import { KpiCard } from "./kpi-card";
import type { DashboardMetrics } from "@/types/dashboard";
import { cn } from "@/lib/utils";

interface KpiGridProps {
  metrics: DashboardMetrics;
}

export function KpiGrid({ metrics }: KpiGridProps) {
  // Top 5 High-Signal Hero Metrics
  const heroMetrics = [
    {
      label: "Total Applications",
      value: metrics.totalApplications,
      subtext: "All tracked entries",
      icon: FileText,
      tone: "cyan" as const,
      filterLink: "/applications?status=all",
    },
    {
      label: "Submitted",
      value: metrics.submitted,
      subtext: "Sent to company",
      icon: Send,
      tone: "primary" as const,
      filterLink: "/applications?status=applied",
    },
    {
      label: "Recruiter Responses",
      value: metrics.recruiterResponses,
      subtext: `${metrics.responseRate}% response rate`,
      icon: MessageSquare,
      tone: "emerald" as const,
      filterLink: "/applications?recruiter=true",
    },
    {
      label: "Action Required",
      value: metrics.actionRequired,
      subtext: "Follow-ups & tests",
      icon: AlertCircle,
      tone: "amber" as const,
      filterLink: "/applications?action=required",
    },
    {
      label: "Interviews",
      value: metrics.interviews,
      subtext: "Screen & tech loops",
      icon: CalendarCheck,
      tone: "purple" as const,
      filterLink: "/applications?status=interviewing",
    },
  ];

  // Secondary Statuses rendered in compact swipeable ribbon
  const secondaryMetrics = [
    {
      label: "Assessments",
      value: metrics.assessments,
      subtext: "Coding / OA",
      icon: Code,
      tone: "amber" as const,
      filterLink: "/applications?status=assessment",
      badgeColor: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    },
    {
      label: "Rejected Applications",
      value: metrics.rejected,
      subtext: `${metrics.rejectionRate}% closed`,
      icon: XCircle,
      tone: "rose" as const,
      filterLink: "/applications?status=rejected",
      badgeColor: "text-rose-400 bg-rose-500/10 border-rose-500/20",
    },
    {
      label: "Pending Decision",
      value: metrics.pending,
      subtext: "Evaluated & ready",
      icon: Clock,
      tone: "amber" as const,
      filterLink: "/applications?status=pending",
      badgeColor: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    },
    {
      label: "Under Review",
      value: metrics.underReview,
      subtext: "In active screening",
      icon: Search,
      tone: "info" as const,
      filterLink: "/applications?status=under_review",
      badgeColor: "text-sky-400 bg-sky-500/10 border-sky-500/20",
    },
    {
      label: "Offers Received",
      value: metrics.offers,
      subtext: "Written proposals",
      icon: Trophy,
      tone: "emerald" as const,
      filterLink: "/applications?status=offer",
      badgeColor: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    },
  ];

  return (
    <div className="space-y-4">
      {/* Top 5 Hero Telemetry Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
        {heroMetrics.map((card) => (
          <KpiCard
            key={card.label}
            label={card.label}
            value={card.value}
            subtext={card.subtext}
            icon={card.icon}
            tone={card.tone}
            filterLink={card.filterLink}
            isHero
          />
        ))}
      </div>

      {/* Secondary Status Pill Ribbon (Horizontally swipeable on mobile/tablet) */}
      <div className="relative">
        <div className="flex items-center gap-2.5 overflow-x-auto pb-1 pt-0.5 no-scrollbar sm:grid sm:grid-cols-5 sm:gap-3">
          {secondaryMetrics.map((item) => {
            const Icon = item.icon;
            const isZero = typeof item.value === "number" && item.value === 0;

            return (
              <Link
                key={item.label}
                href={item.filterLink}
                className={cn(
                  "orbital-card rounded-lg p-2.5 sm:p-3 flex items-center justify-between gap-3 min-w-[170px] sm:min-w-0 transition-all duration-200 select-none group",
                  isZero ? "opacity-65 hover:opacity-100" : ""
                )}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className={cn("p-1.5 rounded-md border shrink-0", item.badgeColor)}>
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-[11px] font-mono text-muted-foreground truncate group-hover:text-foreground transition-colors">
                      {item.label}
                    </span>
                    <span className="text-[10px] text-muted-foreground/70 font-mono truncate hidden sm:block">
                      {item.subtext}
                    </span>
                  </div>
                </div>

                <div className="flex items-baseline gap-1 shrink-0">
                  <span
                    className={cn(
                      "font-mono font-bold text-base tabular-nums",
                      isZero ? "text-slate-400" : "text-foreground"
                    )}
                  >
                    {item.value}
                  </span>
                  <ArrowUpRight className="h-3 w-3 text-muted-foreground/60 group-hover:text-cyan-400 transition-colors" />
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
