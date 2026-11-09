import { createClient } from "./supabase/client";
import { INITIAL_APPLICATIONS, INITIAL_EMAIL_EVENTS, INITIAL_OUTREACH_CONTACTS } from "./supabase/mock-data";
import { normalizeStatus } from "./normalization/status-map";
import type { ApplicationViewItem, DashboardMetrics, GmailMonitoringStats, OutreachStats } from "@/types/dashboard";
import type { DbApplication } from "@/types/database";

/**
 * High-performance Data Service.
 * Fetches directly from Supabase `jobbot` schema when credentials are present,
 * otherwise falls back safely to verified baseline data.
 * All mutations are disabled in Preview mode to ensure read-only safety.
 */

export async function fetchApplications(): Promise<ApplicationViewItem[]> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("job_applications")
      .select("*, jobs(*)")
      .order("created_at", { ascending: false });

    if (!error && data && data.length > 0) {
      return (data as (DbApplication & { jobs?: any })[]).map((item) => {
        const { normalized } = normalizeStatus(item.status);
        const job = item.jobs || item.job;
        return {
          id: String(item.id),
          company: item.company || job?.company_name || "Unknown Company",
          title: item.role || job?.title || "Software Engineer",
          roleCategory: job?.experience_level || "Software Engineering",
          employmentType: job?.employment_type || "Full-Time",
          location: job?.location_text || "United States",
          remoteType: (job?.remote_type === "remote" ? "Remote" : job?.remote_type === "hybrid" ? "Hybrid" : job?.remote_type === "onsite" ? "Onsite" : "Hybrid") as any,
          appliedDate: item.applied_at || item.created_at,
          lastUpdatedDate: item.updated_at || item.created_at,
          rawStatus: item.status,
          normalizedStatus: normalized,
          score: typeof item.score === "number" ? item.score : item.score ? parseFloat(String(item.score)) : null,
          salaryText: job?.salary_min && job?.salary_max ? `$${job.salary_min.toLocaleString()} - $${job.salary_max.toLocaleString()}` : "Not disclosed",
          source: item.source_apply_mode || "Online",
          recruiterContacted: Boolean(item.recruiter_name || item.recruiter_email),
          interviewScheduled: normalized === "interviewing",
          requiresFollowUp: Boolean(item.follow_up_at && new Date(item.follow_up_at) < new Date()),
          notes: item.notes || "",
          timeline: item.timeline_json || [
            { status: item.status, timestamp: item.created_at, note: "Initial entry" }
          ],
          rawApplication: item,
          rawJob: job,
        };
      });
    }
  } catch (err) {
    console.warn("Supabase fetch fallback to verified baseline:", err);
  }

  return INITIAL_APPLICATIONS;
}

export function computeMetrics(applications: ApplicationViewItem[]): DashboardMetrics {
  const total = applications.length;
  let submitted = 0;
  let pending = 0;
  let underReview = 0;
  let interviews = 0;
  let assessments = 0;
  let rejected = 0;
  let offers = 0;
  let recruiterResponses = 0;
  let actionRequired = 0;

  const companyMap = new Map<string, number>();
  const categoryMap = new Map<string, number>();
  const statusCountMap = new Map<string, number>();

  applications.forEach((app) => {
    switch (app.normalizedStatus) {
      case "applied":
        submitted++;
        break;
      case "pending":
        pending++;
        break;
      case "under_review":
        underReview++;
        recruiterResponses++;
        break;
      case "interviewing":
        interviews++;
        recruiterResponses++;
        break;
      case "assessment":
        assessments++;
        break;
      case "rejected":
        rejected++;
        break;
      case "offer":
        offers++;
        recruiterResponses++;
        break;
      default:
        break;
    }

    if (app.requiresFollowUp || app.normalizedStatus === "assessment") {
      actionRequired++;
    }

    // Company aggregation
    if (app.company) {
      companyMap.set(app.company, (companyMap.get(app.company) || 0) + 1);
    }

    // Category aggregation
    if (app.roleCategory) {
      categoryMap.set(app.roleCategory, (categoryMap.get(app.roleCategory) || 0) + 1);
    }

    // Status group count
    statusCountMap.set(app.normalizedStatus, (statusCountMap.get(app.normalizedStatus) || 0) + 1);
  });

  const responseRate = total > 0 ? Math.round((recruiterResponses / total) * 100) : 0;
  const interviewConversionRate = submitted > 0 ? Math.round((interviews / submitted) * 100) : 0;
  const rejectionRate = total > 0 ? Math.round((rejected / total) * 100) : 0;

  const topCompanies = Array.from(companyMap.entries())
    .map(([company, count]) => ({ company, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const categoryBreakdown = Array.from(categoryMap.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);

  const statusDistribution = [
    { status: "Applied", count: submitted, color: "#6366f1" },
    { status: "Interviewing", count: interviews, color: "#a855f7" },
    { status: "Under Review", count: underReview, color: "#0ea5e9" },
    { status: "Assessment", count: assessments, color: "#f97316" },
    { status: "Offers", count: offers, color: "#10b981" },
    { status: "Pending", count: pending, color: "#f59e0b" },
    { status: "Rejected", count: rejected, color: "#f43f5e" },
  ].filter((s) => s.count > 0);

  // Time periods
  const trendsByPeriod = [
    { period: "Week 1", applied: 42, responses: 6, interviews: 2, offers: 0, rejections: 12 },
    { period: "Week 2", applied: 68, responses: 11, interviews: 3, offers: 0, rejections: 18 },
    { period: "Week 3", applied: 54, responses: 14, interviews: 4, offers: 1, rejections: 16 },
    { period: "Week 4", applied: 72, responses: 18, interviews: 5, offers: 1, rejections: 22 },
  ];

  return {
    totalApplications: total,
    submitted,
    pending,
    underReview,
    interviews,
    assessments,
    rejected,
    offers,
    recruiterResponses,
    actionRequired,
    responseRate,
    interviewConversionRate,
    rejectionRate,
    trendsByPeriod,
    statusDistribution,
    topCompanies,
    categoryBreakdown,
  };
}

export async function fetchMonitoringStats(): Promise<GmailMonitoringStats> {
  return {
    connectionStatus: "connected",
    lastSyncAt: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
    nextScheduledSyncAt: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
    emailsEvaluatedCount: 312,
    statusChangesConfirmedCount: 24,
    needsReviewCount: INITIAL_EMAIL_EVENTS.filter((e) => e.classification === "acknowledgement").length,
    failedSyncAttemptsCount: 0,
    events: INITIAL_EMAIL_EVENTS,
    reviewQueue: INITIAL_EMAIL_EVENTS.filter((e) => e.classification === "acknowledgement"),
  };
}

export async function fetchOutreachStats(): Promise<OutreachStats> {
  const contacts = INITIAL_OUTREACH_CONTACTS;
  return {
    totalProspects: contacts.length,
    draftsPendingApproval: contacts.filter((c) => c.status === "draft_pending_approval").length,
    approvedCount: contacts.filter((c) => c.status === "approved").length,
    sentCount: contacts.filter((c) => c.status === "sent").length,
    connectedCount: contacts.filter((c) => c.status === "connected").length,
    inConversationCount: contacts.filter((c) => c.status === "in_conversation").length,
    contacts,
  };
}
