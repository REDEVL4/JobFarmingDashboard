import type { DbApplication, DbJob, DbEmailEvent, DbOutreachContact } from "./database";

export type NormalizedStatus =
  | "all"
  | "applied"
  | "pending"
  | "under_review"
  | "assessment"
  | "interviewing"
  | "offer"
  | "rejected"
  | "withdrawn"
  | "unmapped";

export interface StatusDefinition {
  id: string;
  label: string;
  group: NormalizedStatus;
  aliases: string[];
  description: string;
  isTerminal?: boolean;
}

export interface ApplicationViewItem {
  id: string;
  company: string;
  title: string;
  roleCategory: string;
  employmentType: string;
  location: string;
  remoteType: "Remote" | "Hybrid" | "Onsite" | "Unspecified";
  appliedDate: string | null;
  lastUpdatedDate: string;
  rawStatus: string;
  normalizedStatus: NormalizedStatus;
  score: number | null;
  salaryText: string;
  source: string;
  recruiterContacted: boolean;
  interviewScheduled: boolean;
  requiresFollowUp: boolean;
  notes?: string;
  resumeUrl?: string;
  applicationUrl?: string;
  timeline: {
    status: string;
    timestamp: string;
    note?: string;
  }[];
  rawApplication: DbApplication;
  rawJob?: DbJob | null;
}

export interface ApplicationFilters {
  statuses: NormalizedStatus[];
  searchQuery: string;
  company: string;
  roleCategory: string;
  employmentType: string;
  remoteType: string;
  location: string;
  dateRange: {
    from?: string;
    to?: string;
  };
  salaryMin?: number;
  salaryMax?: number;
  recruiterContactedOnly: boolean;
  interviewScheduledOnly: boolean;
  requiresFollowUpOnly: boolean;
  resumeVersion?: string;
}

export interface DashboardMetrics {
  totalApplications: number;
  submitted: number;
  pending: number;
  underReview: number;
  interviews: number;
  assessments: number;
  rejected: number;
  offers: number;
  recruiterResponses: number;
  actionRequired: number;

  responseRate: number; // percentage
  interviewConversionRate: number; // percentage
  rejectionRate: number; // percentage

  trendsByPeriod: {
    period: string; // date or week
    applied: number;
    responses: number;
    interviews: number;
    offers: number;
    rejections: number;
  }[];

  statusDistribution: {
    status: string;
    count: number;
    color: string;
  }[];

  topCompanies: {
    company: string;
    count: number;
  }[];

  categoryBreakdown: {
    category: string;
    count: number;
  }[];
}

export interface GmailMonitoringStats {
  connectionStatus: "connected" | "disconnected" | "error";
  lastSyncAt: string | null;
  nextScheduledSyncAt: string | null;
  emailsEvaluatedCount: number;
  statusChangesConfirmedCount: number;
  needsReviewCount: number;
  failedSyncAttemptsCount: number;
  events: DbEmailEvent[];
  reviewQueue: DbEmailEvent[];
}

export interface OutreachStats {
  totalProspects: number;
  draftsPendingApproval: number;
  approvedCount: number;
  sentCount: number;
  connectedCount: number;
  inConversationCount: number;
  contacts: DbOutreachContact[];
}

export type DataFetchStatus =
  | "success"
  | "empty"
  | "unauthenticated"
  | "permission_denied"
  | "connection_error";

export interface DataResult<T> {
  data: T;
  status: DataFetchStatus;
  error: string | null;
}

