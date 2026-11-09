import React from "react";
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
} from "lucide-react";
import { KpiCard } from "./kpi-card";
import type { DashboardMetrics } from "@/types/dashboard";

interface KpiGridProps {
  metrics: DashboardMetrics;
}

export function KpiGrid({ metrics }: KpiGridProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
      <KpiCard
        label="Total Applications"
        value={metrics.totalApplications}
        subtext="All tracked entries"
        icon={FileText}
        tone="neutral"
        filterLink="/applications?status=all"
      />
      <KpiCard
        label="Submitted"
        value={metrics.submitted}
        subtext="Sent to company"
        icon={Send}
        tone="primary"
        filterLink="/applications?status=applied"
      />
      <KpiCard
        label="Pending Decision"
        value={metrics.pending}
        subtext="Evaluated & ready"
        icon={Clock}
        tone="amber"
        filterLink="/applications?status=pending"
      />
      <KpiCard
        label="Under Review"
        value={metrics.underReview}
        subtext="In active screening"
        icon={Search}
        tone="info"
        filterLink="/applications?status=under_review"
      />
      <KpiCard
        label="Interviews"
        value={metrics.interviews}
        subtext="Screen & tech loops"
        icon={CalendarCheck}
        tone="purple"
        filterLink="/applications?status=interviewing"
      />
      <KpiCard
        label="Assessments"
        value={metrics.assessments}
        subtext="Coding / OA assigned"
        icon={Code}
        tone="amber"
        filterLink="/applications?status=assessment"
      />
      <KpiCard
        label="Offers Received"
        value={metrics.offers}
        subtext="Written proposals"
        icon={Trophy}
        tone="emerald"
        filterLink="/applications?status=offer"
      />
      <KpiCard
        label="Rejected"
        value={metrics.rejected}
        subtext="Unsuccessful / closed"
        icon={XCircle}
        tone="rose"
        filterLink="/applications?status=rejected"
      />
      <KpiCard
        label="Recruiter Responses"
        value={metrics.recruiterResponses}
        subtext={`${metrics.responseRate}% response rate`}
        icon={MessageSquare}
        tone="info"
        filterLink="/applications?recruiter=true"
      />
      <KpiCard
        label="Action Required"
        value={metrics.actionRequired}
        subtext="Follow-ups & tests"
        icon={AlertCircle}
        tone="rose"
        filterLink="/applications?action=required"
      />
    </div>
  );
}
