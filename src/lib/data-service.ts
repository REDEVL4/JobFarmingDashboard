import { getAuthenticatedOwner } from "./supabase/server";
import { normalizeStatus } from "./normalization/status-map";
import type {
  ApplicationViewItem,
  DashboardMetrics,
  GmailMonitoringStats,
  OutreachStats,
  OutreachProposal,
  OutreachInteraction,
  OutreachConversationItem,
  OutreachSettings,
  DataResult,
} from "@/types/dashboard";
import type {
  DbJobApplication,
  DbJobOpportunity,
  DbRecruitmentReviewItem,
  DbOutreachContact,
  DbSyncLog,
} from "@/types/database";

/**
 * Server-Side Data Service.
 * STRICT POLICY:
 * 1. Uses authenticated server-side Supabase client with active owner session.
 * 2. Distinguishes: success, empty, unauthenticated, permission_denied, connection_error.
 * 3. Never falls back to mock records or fake application counts.
 * 4. Never displays zero applications when the actual problem is a failed query.
 */

export async function fetchApplications(): Promise<DataResult<ApplicationViewItem[]>> {
  try {
    const auth = await getAuthenticatedOwner();

    if (!auth.success) {
      if (auth.reason === "unauthenticated") {
        return {
          data: [],
          status: "unauthenticated",
          error: "Authentication required: Please sign in as the designated owner to access Job Farming data.",
        };
      }
      if (auth.reason === "unauthorized_owner") {
        return {
          data: [],
          status: "permission_denied",
          error: auth.error,
        };
      }
      return {
        data: [],
        status: "connection_error",
        error: auth.error,
      };
    }

    // Execute authenticated query with owner session RLS
    const [appsRes, oppsRes, docsRes] = await Promise.all([
      auth.client
        .from("jf_applications")
        .select("*")
        .order("created_at", { ascending: false }),
      auth.client
        .from("jf_opportunities")
        .select(
          "id, company, job_title, requisition_id, posting_url, application_url, salary_text, work_mode, employment_type, hire_type, fit_score, fit_explanation, discovery_source, location"
        ),
      auth.client
        .from("jf_documents")
        .select("id, application_id, doc_type, original_filename, storage_path, mime_type"),
    ]);

    if (appsRes.error) {
      console.error("Supabase query error for jf_applications:", appsRes.error.message);
      const isPermission =
        appsRes.error.code === "42501" ||
        appsRes.error.message.toLowerCase().includes("permission") ||
        appsRes.error.message.toLowerCase().includes("policy") ||
        appsRes.error.message.toLowerCase().includes("rls");

      return {
        data: [],
        status: isPermission ? "permission_denied" : "connection_error",
        error: `Database query failed: ${appsRes.error.message} (${appsRes.error.code || "UNKNOWN"})`,
      };
    }

    const data = appsRes.data;
    if (!data || data.length === 0) {
      return {
        data: [],
        status: "empty",
        error: null,
      };
    }

    const oppsMap = new Map<string, DbJobOpportunity>(
      ((oppsRes.data || []) as DbJobOpportunity[]).map((o) => [o.id, o])
    );

    const docsByAppMap = new Map<string, any[]>();
    const docsByIdMap = new Map<string, any>();
    ((docsRes.data || []) as any[]).forEach((doc) => {
      docsByIdMap.set(doc.id, doc);
      if (doc.application_id) {
        const existing = docsByAppMap.get(doc.application_id) || [];
        existing.push(doc);
        docsByAppMap.set(doc.application_id, existing);
      }
    });

    const applications: ApplicationViewItem[] = (data as DbJobApplication[]).map((item) => {
      const rawStatus = item.application_status || item.status || "Applied";
      const hiringStage = item.hiring_stage;
      const { normalized } = normalizeStatus(rawStatus, hiringStage);
      const opp = item.opportunity_id ? oppsMap.get(item.opportunity_id) : undefined;

      const appDocs = docsByAppMap.get(item.id) || [];
      const resumeDoc =
        appDocs.find((d) => d.doc_type === "resume") ||
        (item.resume_document_id ? docsByIdMap.get(item.resume_document_id) : undefined);
      const coverLetterDoc =
        appDocs.find((d) => d.doc_type === "cover_letter") ||
        (item.cover_letter_document_id ? docsByIdMap.get(item.cover_letter_document_id) : undefined);

      const resumeUrl = resumeDoc ? `/api/documents/${resumeDoc.id}` : undefined;
      const resumeFileName = resumeDoc?.original_filename || "Tailored Resume (PDF)";
      const coverLetterUrl = coverLetterDoc ? `/api/documents/${coverLetterDoc.id}` : undefined;

      const postingUrl = item.posting_url || opp?.posting_url || undefined;
      const applicationUrl = item.application_url || opp?.application_url || undefined;

      const mappedDocuments = appDocs.map((d) => ({
        id: d.id,
        name: d.original_filename || (d.doc_type === "resume" ? "Resume (PDF)" : "Cover Letter (PDF)"),
        type: d.doc_type,
        url: `/api/documents/${d.id}`,
      }));

      const salaryText = opp?.salary_text || "Not disclosed";

      let remoteType: "Remote" | "Hybrid" | "Onsite" = "Hybrid";
      if (opp?.work_mode) {
        const wm = opp.work_mode.toLowerCase();
        if (wm.includes("remote")) remoteType = "Remote";
        else if (wm.includes("onsite") || wm.includes("in-person")) remoteType = "Onsite";
        else remoteType = "Hybrid";
      }

      let employmentType = "Full-Time";
      if (opp?.employment_type) {
        const et = opp.employment_type.toLowerCase();
        if (et.includes("contract")) employmentType = "Contract";
        else if (et.includes("intern")) employmentType = "Internship";
        else if (et.includes("part")) employmentType = "Part-Time";
      }

      return {
        id: String(item.id),
        company: item.company || opp?.company || "Unknown Company",
        title: item.job_title || opp?.job_title || "Software Engineer",
        roleCategory: opp?.hire_type || "Software Engineering",
        employmentType,
        location: opp?.location || "United States",
        remoteType,
        appliedDate: item.applied_at || item.created_at,
        lastUpdatedDate: item.updated_at || item.created_at,
        rawStatus: hiringStage ? `${rawStatus} (${hiringStage})` : rawStatus,
        normalizedStatus: normalized,
        score:
          typeof opp?.fit_score === "number"
            ? opp.fit_score
            : opp?.fit_score
            ? parseFloat(String(opp.fit_score))
            : null,
        salaryText,
        source: opp?.discovery_source || "Online",
        recruiterContacted: Boolean(item.confirmation_email_ref),
        interviewScheduled: normalized === "interviewing",
        requiresFollowUp:
          item.application_status === "Submission Pending" ||
          item.verification_status === "unverified",
        notes: item.notes || opp?.fit_explanation || "",
        postingUrl,
        applicationUrl,
        resumeUrl,
        resumeFileName,
        coverLetterUrl,
        documents: mappedDocuments,
        timeline: [
          { status: rawStatus, timestamp: item.created_at, note: "Initial entry" },
          ...(hiringStage
            ? [{ status: hiringStage, timestamp: item.updated_at, note: "Stage update" }]
            : []),
        ],
        rawApplication: item,
        rawJob: opp,
      };
    });

    return {
      data: applications,
      status: "success",
      error: null,
    };
  } catch (err: any) {
    console.error("fetchApplications exception:", err?.message || err);
    return {
      data: [],
      status: "connection_error",
      error: `Service connection error: ${err?.message || "Failed to query database"}`,
    };
  }
}

/**
 * Derives dashboard analytics strictly from real records.
 * Calculates dynamic weekly trends from application dates (UTC-safe).
 * Does not fabricate interview counts or trends.
 */
export function computeMetrics(applications: ApplicationViewItem[]): DashboardMetrics {
  const total = applications.length;
  let submitted = 0;
  let pending = 0;
  let underReview = 0;
  let interviews = 0;
  let assessments = 0;
  let rejected = 0;
  let offers = 0;
  let actionRequired = 0;

  const companyMap = new Map<string, number>();
  const categoryMap = new Map<string, number>();
  const weeklyMap = new Map<
    string,
    {
      applied: number;
      responses: number;
      rejections: number;
      assessments: number;
      interviews: number;
      offers: number;
    }
  >();

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
        break;
      case "interviewing":
        interviews++;
        break;
      case "assessment":
        assessments++;
        break;
      case "rejected":
        rejected++;
        break;
      case "offer":
        offers++;
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

    // Dynamic weekly trends aggregation from real applied dates (UTC-safe)
    if (app.appliedDate) {
      try {
        const datePart = app.appliedDate.split("T")[0];
        const [y, m, d] = datePart.split("-").map(Number);
        if (y && m && d) {
          const dt = new Date(Date.UTC(y, m - 1, d));
          const day = dt.getUTCDay();
          const diff = dt.getUTCDate() - day + (day === 0 ? -6 : 1);
          const monday = new Date(Date.UTC(y, m - 1, diff));
          const weekKey = `${monday.getUTCFullYear()}-${String(monday.getUTCMonth() + 1).padStart(
            2,
            "0"
          )}-${String(monday.getUTCDate()).padStart(2, "0")}`;

          if (!weeklyMap.has(weekKey)) {
            weeklyMap.set(weekKey, {
              applied: 0,
              responses: 0,
              rejections: 0,
              assessments: 0,
              interviews: 0,
              offers: 0,
            });
          }

          const bucket = weeklyMap.get(weekKey)!;
          bucket.applied++;
          if (app.normalizedStatus === "rejected") {
            bucket.rejections++;
            bucket.responses++;
          } else if (app.normalizedStatus === "assessment") {
            bucket.assessments++;
            bucket.responses++;
          } else if (app.normalizedStatus === "interviewing") {
            bucket.interviews++;
            bucket.responses++;
          } else if (app.normalizedStatus === "offer") {
            bucket.offers++;
            bucket.responses++;
          }
        }
      } catch {
        // Ignore unparseable dates
      }
    }
  });

  // Employer responses = total definite updates from recruiters/companies (rejected + assessments + interviews + offers)
  const recruiterResponses = rejected + assessments + interviews + offers;
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
    { status: "Under Review", count: underReview, color: "#0ea5e9" },
    { status: "Rejected", count: rejected, color: "#f43f5e" },
    { status: "Assessment", count: assessments, color: "#f97316" },
    { status: "Pending", count: pending, color: "#f59e0b" },
    { status: "Interviewing", count: interviews, color: "#a855f7" },
    { status: "Offers", count: offers, color: "#10b981" },
  ].filter((s) => s.count > 0);

  // Sorted dynamic weekly trends
  const trendsByPeriod = Array.from(weeklyMap.entries())
    .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
    .map(([date, data]) => {
      const parts = date.split("-");
      const label = parts.length === 3 ? `Week of ${parts[1]}/${parts[2]}` : date;
      return {
        period: label,
        applied: data.applied,
        responses: data.responses,
        rejections: data.rejections,
        interviews: data.interviews,
        offers: data.offers,
      };
    });

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

/**
 * Fetches real telemetry from `jobbot.sync_logs` and `jobbot.recruitment_review_items`.
 * Reflects verified hourly polling schedule.
 */
export async function fetchMonitoringStats(): Promise<DataResult<GmailMonitoringStats>> {
  const emptyStats: GmailMonitoringStats = {
    connectionStatus: "disconnected",
    lastSyncAt: null,
    nextScheduledSyncAt: null,
    schedulerStatus: "ready_pending_verification",
    schedulerCron: "49 * * * *",
    dryRunEnabled: true,
    emailsEvaluatedCount: 0,
    statusChangesConfirmedCount: 0,
    needsReviewCount: 0,
    failedSyncAttemptsCount: 0,
    lastErrorDetail: null,
    classificationBreakdown: {
      rejections: 0,
      interviews: 0,
      assessments: 0,
      offers: 0,
      acknowledgments: 0,
    },
    events: [],
    reviewQueue: [],
  };

  try {
    const auth = await getAuthenticatedOwner();

    if (!auth.success) {
      return {
        data: emptyStats,
        status: auth.reason === "unauthenticated" ? "unauthenticated" : "permission_denied",
        error: auth.error,
      };
    }

    const [syncRes, reviewRes] = await Promise.all([
      auth.client
        .from("jf_recruitment_health")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(20),
      auth.client
        .from("jf_recruitment_review")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    if (syncRes.error) {
      return {
        data: emptyStats,
        status: "connection_error",
        error: `Failed to load sync logs: ${syncRes.error.message}`,
      };
    }

    const syncLogs = (syncRes.data || []) as DbSyncLog[];
    const reviewItems = (reviewRes.data || []) as DbRecruitmentReviewItem[];

    const latestSync = syncLogs.length > 0 ? syncLogs[0] : null;

    // Real cumulative evaluations from sync_logs
    const totalScanned = syncLogs.reduce(
      (acc, log) =>
        acc + (log.created_count || 0) + (log.updated_count || 0) + (log.skipped_count || 0),
      0
    );
    const totalConfirmed = syncLogs.reduce((acc, log) => acc + (log.updated_count || 0), 0);

    const mappedEvents = reviewItems.map((item) => {
      const candidates = Array.isArray(item.candidate_applications)
        ? item.candidate_applications
        : [];
      const primaryCandidate = candidates[0];
      return {
        id: item.id,
        gmail_message_id: item.message_id,
        thread_id: item.thread_id,
        receivedAt: item.created_at,
        created_at: item.created_at,
        sender: item.mailbox,
        from_email: item.mailbox,
        subject: item.evidence_summary || `Message ID: ${item.message_id.slice(0, 12)}`,
        evidence_summary: item.evidence_summary,
        classification: (item.reason_code || item.proposed_stage?.toLowerCase() || "acknowledgement") as any,
        proposed_stage: item.proposed_stage || "Applied Confirmed",
        confidence: primaryCandidate?.confidence ?? 0.95,
        matched_application_id: item.resolved_application_id || primaryCandidate?.id || null,
        candidate_applications: candidates,
        state: item.state,
        reason_code: item.reason_code,
        actionTaken: item.state === "open" ? "queued_for_review" : item.state,
      };
    });

    const lastSyncTime = latestSync?.completed_at || latestSync?.started_at || null;
    const nextSyncTime = lastSyncTime
      ? new Date(new Date(lastSyncTime).getTime() + 60 * 60 * 1000).toISOString()
      : null;

    const latestError = syncLogs.find(
      (l) => Array.isArray(l.errors) && l.errors.length > 0
    );
    const lastErrorDetail = latestError?.errors?.[0]?.detail || latestError?.errors?.[0]?.code || null;

    // Tally proposed stages from open review items and sync logs
    let rejections = 0;
    let interviews = 0;
    let assessments = 0;
    let offers = 0;
    let acknowledgments = 0;

    reviewItems.forEach((item) => {
      const stage = (item.proposed_stage || "").toLowerCase();
      if (stage.includes("reject")) rejections++;
      else if (stage.includes("interview")) interviews++;
      else if (stage.includes("assessment")) assessments++;
      else if (stage.includes("offer")) offers++;
      else acknowledgments++;
    });

    return {
      data: {
        connectionStatus: latestSync ? "connected" : "disconnected",
        lastSyncAt: lastSyncTime,
        nextScheduledSyncAt: nextSyncTime,
        schedulerStatus: "ready_pending_verification",
        schedulerCron: "49 * * * *",
        dryRunEnabled: true,
        emailsEvaluatedCount: totalScanned,
        statusChangesConfirmedCount: totalConfirmed,
        needsReviewCount: reviewItems.filter((i) => i.state === "open").length,
        failedSyncAttemptsCount: syncLogs.filter(
          (l) => Array.isArray(l.errors) && l.errors.length > 0
        ).length,
        lastErrorDetail,
        classificationBreakdown: {
          rejections,
          interviews,
          assessments,
          offers,
          acknowledgments,
        },
        events: mappedEvents,
        reviewQueue: mappedEvents.filter((e) => e.classification === "acknowledgement"),
      },
      status: "success",
      error: null,
    };
  } catch (err: any) {
    console.error("fetchMonitoringStats failed:", err?.message || err);
    return {
      data: emptyStats,
      status: "connection_error",
      error: err?.message || "Failed to load monitoring stats",
    };
  }
}

/**
 * Fetches real outreach contacts from `jobbot.outreach_contacts`.
 * Does not fallback to mock objects.
 */
export async function fetchOutreachStats(): Promise<DataResult<OutreachStats>> {
  const emptyStats: OutreachStats = {
    totalProspects: 0,
    draftsPendingApproval: 0,
    approvedCount: 0,
    sentCount: 0,
    connectedCount: 0,
    inConversationCount: 0,
    contacts: [],
  };

  try {
    const auth = await getAuthenticatedOwner();

    if (!auth.success) {
      return {
        data: emptyStats,
        status: auth.reason === "unauthenticated" ? "unauthenticated" : "permission_denied",
        error: auth.error,
      };
    }

    const { data, error } = await auth.client
      .from("jf_outreach_contacts")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Supabase query error for jf_outreach_contacts:", error.message);
      const isPermission =
        error.code === "42501" ||
        error.message.toLowerCase().includes("permission") ||
        error.message.toLowerCase().includes("policy") ||
        error.message.toLowerCase().includes("rls");

      return {
        data: emptyStats,
        status: isPermission ? "permission_denied" : "connection_error",
        error: `Database query failed: ${error.message}`,
      };
    }

    if (!data || data.length === 0) {
      return {
        data: emptyStats,
        status: "empty",
        error: null,
      };
    }

    const contacts: DbOutreachContact[] = (data as DbOutreachContact[]).map((item) => ({
      id: item.id,
      name: item.full_name || item.name || "Contact",
      company: item.company || "Unknown Company",
      role: item.professional_title || item.role || "Recruiter",
      contact_type: item.category || item.contact_type || "recruiter",
      status: (item.connection_stage || item.status || "draft_pending_approval") as any,
      score:
        typeof item.relevance_score === "number" ? item.relevance_score : item.score || 90,
      linkedin_url: item.linkedin_url || "",
      connection_note:
        item.personalization_context ||
        item.connection_note ||
        "Hi, I noticed your team's work and would love to connect.",
      created_at: item.created_at,
      updated_at: item.updated_at || item.created_at,
    }));

    return {
      data: {
        totalProspects: contacts.length,
        draftsPendingApproval: contacts.filter((c) => c.status === "draft_pending_approval").length,
        approvedCount: contacts.filter((c) => c.status === "approved").length,
        sentCount: contacts.filter((c) => c.status === "sent").length,
        connectedCount: contacts.filter((c) => c.status === "connected").length,
        inConversationCount: contacts.filter((c) => c.status === "in_conversation").length,
        contacts,
      },
      status: "success",
      error: null,
    };
  } catch (err: any) {
    console.error("fetchOutreachStats failed:", err?.message || err);
    return {
      data: emptyStats,
      status: "connection_error",
      error: err?.message || "Failed to load outreach contacts",
    };
  }
}

/**
 * Fetches real outreach proposals from `jobbot.outreach_proposals`.
 * Query jobbot.outreach_proposals where state in ('pending_approval', 'draft_ready', 'queued', 'sent'), order by created_at desc.
 * Uses the same Supabase client and error handling pattern as fetchOutreachStats.
 */
export async function fetchOutreachProposals(): Promise<DataResult<OutreachProposal[]>> {
  try {
    const auth = await getAuthenticatedOwner();

    if (!auth.success) {
      return {
        data: [],
        status: auth.reason === "unauthenticated" ? "unauthenticated" : "permission_denied",
        error: auth.error,
      };
    }

    // Query outreach_proposals via public view jf_outreach_proposals or outreach_proposals
    let { data, error } = await auth.client
      .from("jf_outreach_proposals")
      .select("*")
      .in("state", ["pending_approval", "draft_ready", "queued", "sent"])
      .order("created_at", { ascending: false });

    if (error && error.code === "42P01") {
      const fallback = await auth.client
        .from("outreach_proposals")
        .select("*")
        .in("state", ["pending_approval", "draft_ready", "queued", "sent"])
        .order("created_at", { ascending: false });
      data = fallback.data;
      error = fallback.error;
    }

    if (error) {
      console.error("Supabase query error for outreach_proposals:", error.message);
      const isPermission =
        error.code === "42501" ||
        error.message.toLowerCase().includes("permission") ||
        error.message.toLowerCase().includes("policy") ||
        error.message.toLowerCase().includes("rls");

      return {
        data: [],
        status: isPermission ? "permission_denied" : "connection_error",
        error: `Database query failed: ${error.message}`,
      };
    }

    if (!data || data.length === 0) {
      return {
        data: [],
        status: "empty",
        error: null,
      };
    }

    return {
      data: data as OutreachProposal[],
      status: "success",
      error: null,
    };
  } catch (err: any) {
    console.error("fetchOutreachProposals exception:", err?.message || err);
    return {
      data: [],
      status: "connection_error",
      error: `Service connection error: ${err?.message || "Failed to load outreach proposals"}`,
    };
  }
}

/**
 * Fetches a single outreach proposal by ID.
 */
export async function fetchOutreachProposalById(
  proposalId: string
): Promise<DataResult<OutreachProposal | null>> {
  try {
    const auth = await getAuthenticatedOwner();
    if (!auth.success) {
      return {
        data: null,
        status: auth.reason === "unauthenticated" ? "unauthenticated" : "permission_denied",
        error: auth.error,
      };
    }

    let { data, error } = await auth.client
      .from("jf_outreach_proposals")
      .select("*")
      .eq("id", proposalId)
      .maybeSingle();

    if (error && error.code === "42P01") {
      const fallback = await auth.client
        .from("outreach_proposals")
        .select("*")
        .eq("id", proposalId)
        .maybeSingle();
      data = fallback.data;
      error = fallback.error;
    }

    if (error) {
      console.error("Supabase query error for outreach proposal by ID:", error.message);
      return {
        data: null,
        status: "connection_error",
        error: error.message,
      };
    }

    return {
      data: (data as OutreachProposal) || null,
      status: "success",
      error: null,
    };
  } catch (err: any) {
    console.error("fetchOutreachProposalById exception:", err?.message || err);
    return {
      data: null,
      status: "connection_error",
      error: err?.message || "Failed to load outreach proposal",
    };
  }
}

/**
 * Resolves an outreach proposal by approving or rejecting it.
 * Updates the row in jobbot.outreach_proposals via Supabase.
 */
export async function resolveOutreachProposal(
  proposalId: string,
  action: "approve" | "reject",
  approvedText?: string
): Promise<{ success: boolean; data?: OutreachProposal; error?: string }> {
  try {
    const auth = await getAuthenticatedOwner();
    if (!auth.success) {
      return { success: false, error: auth.error };
    }

    // 1. Fetch current proposal to determine channel and action_type
    let fetchRes = await auth.client
      .from("jf_outreach_proposals")
      .select("*")
      .eq("id", proposalId)
      .maybeSingle();

    if (fetchRes.error && fetchRes.error.code === "42P01") {
      fetchRes = await auth.client
        .from("outreach_proposals")
        .select("*")
        .eq("id", proposalId)
        .maybeSingle();
    }

    if (fetchRes.error || !fetchRes.data) {
      return {
        success: false,
        error: fetchRes.error?.message || "Proposal not found.",
      };
    }

    const current = fetchRes.data as OutreachProposal;
    const now = new Date().toISOString();
    let updates: Partial<OutreachProposal>;

    if (action === "approve") {
      const channel = (current.channel || "").toLowerCase();
      const actionType = (current.action_type || "").toLowerCase();

      let targetState = "approved_for_send";
      if (channel === "gmail") {
        targetState = "queued";
      } else if (channel === "linkedin") {
        targetState = "approved_for_send";
      } else if (actionType === "handoff_to_job_bot") {
        targetState = "draft_ready";
      }

      updates = {
        approved_text: approvedText !== undefined ? approvedText : current.proposed_text,
        approved_at: now,
        state: targetState,
        updated_at: now,
      };
    } else {
      updates = {
        state: "rejected",
        updated_at: now,
      };
    }

    let updateRes = await auth.client
      .from("jf_outreach_proposals")
      .update(updates)
      .eq("id", proposalId)
      .select()
      .maybeSingle();

    if (updateRes.error && updateRes.error.code === "42P01") {
      updateRes = await auth.client
        .from("outreach_proposals")
        .update(updates)
        .eq("id", proposalId)
        .select()
        .maybeSingle();
    }

    if (updateRes.error) {
      console.error("[resolveOutreachProposal] Update error:", updateRes.error);
      return { success: false, error: updateRes.error.message };
    }

    return {
      success: true,
      data: updateRes.data as OutreachProposal,
    };
  } catch (err: any) {
    console.error("[resolveOutreachProposal] Exception:", err);
    return { success: false, error: err?.message || "Failed to update outreach proposal" };
  }
}

/**
 * Resolves an open recruitment review item atomically.
 * Actions: 'approve', 'reject', 'ignore', 'needs_review'.
 * Only designated owner can resolve; third-party OAuth tokens are rejected.
 */
export async function resolveRecruitmentReview(
  reviewItemId: string,
  action: "approve" | "reject" | "ignore" | "needs_review",
  notes?: string,
  targetApplicationId?: string
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const auth = await getAuthenticatedOwner();
    if (!auth.success) {
      return { success: false, error: auth.error };
    }

    const { data, error } = await auth.client.rpc("jf_owner_resolve_recruitment_review", {
      p_review_item_id: reviewItemId,
      p_action: action,
      p_notes: notes ?? null,
      p_target_application_id: targetApplicationId ?? null,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data };
  } catch (err: any) {
    return { success: false, error: err?.message || "Failed to resolve review item" };
  }
}

export interface ContactThreadData {
  contact: DbOutreachContact | null;
  interactions: OutreachInteraction[];
  proposals: OutreachProposal[];
}

/**
 * Fetches contact details, interactions, and open proposals for /outreach/[contactId].
 * - contact from jobbot.outreach_contacts
 * - interactions from jobbot.outreach_interactions for contact_id ordered by event_at
 * - proposals from jobbot.outreach_proposals for contact_id where state in ('pending_approval', 'approved_for_send')
 */
export async function fetchContactOutreachThread(
  contactId: string
): Promise<DataResult<ContactThreadData>> {
  const emptyResult: ContactThreadData = {
    contact: null,
    interactions: [],
    proposals: [],
  };

  try {
    const auth = await getAuthenticatedOwner();
    if (!auth.success) {
      return {
        data: emptyResult,
        status: auth.reason === "unauthenticated" ? "unauthenticated" : "permission_denied",
        error: auth.error,
      };
    }

    // 1. Fetch contact
    const contactRes = await auth.client
      .from("jf_outreach_contacts")
      .select("*")
      .eq("id", contactId)
      .maybeSingle();

    if (contactRes.error) {
      console.error("[fetchContactOutreachThread] contact query error:", contactRes.error);
      return {
        data: emptyResult,
        status: "connection_error",
        error: contactRes.error.message,
      };
    }

    if (!contactRes.data) {
      return {
        data: emptyResult,
        status: "empty",
        error: "Contact not found.",
      };
    }

    const contact: DbOutreachContact = {
      id: contactRes.data.id,
      name: contactRes.data.full_name || contactRes.data.name || "Contact",
      full_name: contactRes.data.full_name,
      company: contactRes.data.company || "Unknown Company",
      role: contactRes.data.professional_title || contactRes.data.role || "Recruiter",
      professional_title: contactRes.data.professional_title,
      category: contactRes.data.category || contactRes.data.contact_type || "recruiter",
      contact_type: contactRes.data.category || contactRes.data.contact_type || "recruiter",
      status: contactRes.data.connection_stage || contactRes.data.status || "draft_pending_approval",
      connection_stage: contactRes.data.connection_stage,
      score: typeof contactRes.data.relevance_score === "number" ? contactRes.data.relevance_score : contactRes.data.score || 90,
      linkedin_url: contactRes.data.linkedin_url || "",
      connection_note: contactRes.data.personalization_context || contactRes.data.connection_note || "",
      notes: contactRes.data.notes,
      created_at: contactRes.data.created_at,
      updated_at: contactRes.data.updated_at || contactRes.data.created_at,
    };

    // 2. Fetch interactions for contact, ordered by event_at ASC
    const interactionsRes = await auth.client
      .from("jf_outreach_interactions")
      .select("*")
      .eq("contact_id", contactId)
      .order("event_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });

    const interactions: OutreachInteraction[] = (interactionsRes.data || []) as OutreachInteraction[];

    // 3. Fetch proposals for contact where state in ('pending_approval', 'approved_for_send')
    const proposalsRes = await auth.client
      .from("jf_outreach_proposals")
      .select("*")
      .eq("contact_id", contactId)
      .in("state", ["pending_approval", "approved_for_send"])
      .order("created_at", { ascending: true });

    const proposals: OutreachProposal[] = (proposalsRes.data || []) as OutreachProposal[];

    return {
      data: {
        contact,
        interactions,
        proposals,
      },
      status: "success",
      error: null,
    };
  } catch (err: any) {
    console.error("[fetchContactOutreachThread] exception:", err);
    return {
      data: emptyResult,
      status: "connection_error",
      error: err?.message || "Failed to load contact thread",
    };
  }
}

/**
 * Fetches the conversation inbox list from jobbot.outreach_contacts
 * ordered by last_interaction_at desc (nulls last), then name.
 * Includes latest interaction snippet and pending_approval proposal badge.
 */
export async function fetchOutreachConversations(): Promise<DataResult<OutreachConversationItem[]>> {
  try {
    const auth = await getAuthenticatedOwner();
    if (!auth.success) {
      return {
        data: [],
        status: auth.reason === "unauthenticated" ? "unauthenticated" : "permission_denied",
        error: auth.error,
      };
    }

    const [contactsRes, interactionsRes, proposalsRes] = await Promise.all([
      auth.client
        .from("jf_outreach_contacts")
        .select("*")
        .order("last_interaction_at", { ascending: false, nullsFirst: false }),
      auth.client
        .from("jf_outreach_interactions")
        .select("id, contact_id, message_summary, event_at, created_at")
        .order("event_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false }),
      auth.client
        .from("jf_outreach_proposals")
        .select("id, contact_id, state")
        .eq("state", "pending_approval"),
    ]);

    if (contactsRes.error) {
      console.error("[fetchOutreachConversations] contacts error:", contactsRes.error);
      return {
        data: [],
        status: "connection_error",
        error: contactsRes.error.message,
      };
    }

    const rawContacts = contactsRes.data || [];
    if (rawContacts.length === 0) {
      return {
        data: [],
        status: "empty",
        error: null,
      };
    }

    // Map contacts with pending proposals
    const pendingProposalSet = new Set<string>();
    for (const p of proposalsRes.data || []) {
      if (p.contact_id) {
        pendingProposalSet.add(p.contact_id);
      }
    }

    // Map latest interaction per contact
    const latestInteractions = new Map<string, { summary: string; time: string | null }>();
    for (const inter of interactionsRes.data || []) {
      if (!inter.contact_id) continue;
      if (!latestInteractions.has(inter.contact_id)) {
        latestInteractions.set(inter.contact_id, {
          summary: inter.message_summary || "",
          time: inter.event_at || inter.created_at || null,
        });
      }
    }

    // Build conversation items
    const conversations: OutreachConversationItem[] = rawContacts.map((c: any) => {
      const latest = latestInteractions.get(c.id);
      const effectiveLastTime = c.last_interaction_at || latest?.time || null;
      return {
        id: c.id,
        full_name: c.full_name || c.name || "Contact",
        professional_title: c.professional_title || c.role || null,
        company: c.company || null,
        connection_stage: c.connection_stage || c.status || "unknown",
        linkedin_url: c.linkedin_url || null,
        last_interaction_at: effectiveLastTime,
        last_message_preview: latest?.summary || null,
        has_pending_proposal: pendingProposalSet.has(c.id),
      };
    });

    // Order by last_interaction_at desc nulls last, then full_name asc
    conversations.sort((a, b) => {
      const timeA = a.last_interaction_at ? new Date(a.last_interaction_at).getTime() : 0;
      const timeB = b.last_interaction_at ? new Date(b.last_interaction_at).getTime() : 0;
      if (timeB !== timeA) {
        return timeB - timeA;
      }
      return (a.full_name || "").localeCompare(b.full_name || "");
    });

    return {
      data: conversations,
      status: "success",
      error: null,
    };
  } catch (err: any) {
    console.error("[fetchOutreachConversations] exception:", err);
    return {
      data: [],
      status: "connection_error",
      error: err?.message || "Failed to load conversations",
    };
  }
}

/**
 * Reads all outreach settings from rpc jf_outreach_settings for the signed-in owner.
 * Returns { outreach_mode, auto_connection_requests, auto_accept_connections }.
 */
export async function fetchOutreachSettings(): Promise<DataResult<OutreachSettings>> {
  try {
    const auth = await getAuthenticatedOwner();
    if (!auth.success) {
      return {
        data: {
          outreach_mode: "review",
          auto_connection_requests: false,
          auto_accept_connections: false,
        },
        status: auth.reason === "unauthenticated" ? "unauthenticated" : "permission_denied",
        error: auth.error,
      };
    }

    // 1. Try RPC jf_outreach_settings
    const { data: rpcData, error: rpcError } = await auth.client.rpc("jf_outreach_settings");
    if (!rpcError && rpcData) {
      const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
      if (row) {
        return {
          data: {
            outreach_mode: (row.outreach_mode || "review").toLowerCase() === "auto" ? "auto" : "review",
            auto_connection_requests: Boolean(row.auto_connection_requests),
            auto_accept_connections: Boolean(row.auto_accept_connections),
          },
          status: "success",
          error: null,
        };
      }
    }

    // 2. Fallback to querying jf_outreach_settings view/table directly
    const { data, error } = await auth.client
      .from("jf_outreach_settings")
      .select("outreach_mode, auto_connection_requests, auto_accept_connections")
      .eq("owner_id", auth.user.id)
      .maybeSingle();

    if (error) {
      console.error("[fetchOutreachSettings] error:", error);
      return {
        data: {
          outreach_mode: "review",
          auto_connection_requests: false,
          auto_accept_connections: false,
        },
        status: "connection_error",
        error: error.message,
      };
    }

    return {
      data: {
        outreach_mode: (data?.outreach_mode || "review").toLowerCase() === "auto" ? "auto" : "review",
        auto_connection_requests: Boolean(data?.auto_connection_requests),
        auto_accept_connections: Boolean(data?.auto_accept_connections),
      },
      status: "success",
      error: null,
    };
  } catch (err: any) {
    console.error("[fetchOutreachSettings] exception:", err);
    return {
      data: {
        outreach_mode: "review",
        auto_connection_requests: false,
        auto_accept_connections: false,
      },
      status: "connection_error",
      error: err?.message || "Failed to load outreach settings",
    };
  }
}

/**
 * Reads the current outreach mode from public.jf_outreach_settings for the signed-in owner.
 * Returns "review" | "auto" (defaults to "review").
 */
export async function fetchOutreachMode(): Promise<DataResult<"review" | "auto">> {
  const result = await fetchOutreachSettings();
  return {
    data: result.data?.outreach_mode || "review",
    status: result.status,
    error: result.error,
  };
}

/**
 * Updates outreach mode by invoking public.set_outreach_mode RPC.
 */
export async function setOutreachMode(
  mode: "review" | "auto"
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!["review", "auto"].includes(mode)) {
      return { success: false, error: "Invalid outreach mode. Must be 'review' or 'auto'." };
    }

    const auth = await getAuthenticatedOwner();
    if (!auth.success) {
      return { success: false, error: auth.error };
    }

    const { error } = await auth.client.rpc("set_outreach_mode", { p_mode: mode });
    if (error) {
      console.error("[setOutreachMode] RPC error:", error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err: any) {
    console.error("[setOutreachMode] exception:", err);
    return { success: false, error: err?.message || "Failed to set outreach mode" };
  }
}

/**
 * Updates auto_connection_requests by invoking public.jf_set_auto_connection_requests RPC.
 */
export async function setAutoConnectionRequests(
  enabled: boolean
): Promise<{ success: boolean; error?: string }> {
  try {
    const auth = await getAuthenticatedOwner();
    if (!auth.success) {
      return { success: false, error: auth.error };
    }

    const { error } = await auth.client.rpc("jf_set_auto_connection_requests", {
      p_enabled: enabled,
    });
    if (error) {
      console.error("[setAutoConnectionRequests] RPC error:", error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err: any) {
    console.error("[setAutoConnectionRequests] exception:", err);
    return { success: false, error: err?.message || "Failed to set auto connection requests" };
  }
}

/**
 * Updates auto_accept_connections by invoking public.jf_set_auto_accept_connections RPC.
 */
export async function setAutoAcceptConnections(
  enabled: boolean
): Promise<{ success: boolean; error?: string }> {
  try {
    const auth = await getAuthenticatedOwner();
    if (!auth.success) {
      return { success: false, error: auth.error };
    }

    const { error } = await auth.client.rpc("jf_set_auto_accept_connections", {
      p_enabled: enabled,
    });
    if (error) {
      console.error("[setAutoAcceptConnections] RPC error:", error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err: any) {
    console.error("[setAutoAcceptConnections] exception:", err);
    return { success: false, error: err?.message || "Failed to set auto-accept connections" };
  }
}
