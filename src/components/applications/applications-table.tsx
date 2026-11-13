"use client";

import React, { useState, useMemo, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Search,
  Download,
  RotateCcw,
  ChevronsUpDown,
  Building,
  MapPin,
  Calendar,
  X,
  ExternalLink,
  FileText,
  Bookmark,
  Check,
  Sparkles,
  Target,
  SlidersHorizontal,
} from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/utils";
import { ApplicationDrawer } from "./application-drawer";
import type { ApplicationViewItem, NormalizedStatus } from "@/types/dashboard";
import { cn } from "@/lib/utils";

interface ApplicationsTableProps {
  initialApplications: ApplicationViewItem[];
}

const STATUS_TABS: { label: string; value: NormalizedStatus | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Applied", value: "applied" },
  { label: "Pending", value: "pending" },
  { label: "Under Review", value: "under_review" },
  { label: "Assessment", value: "assessment" },
  { label: "Interviewing", value: "interviewing" },
  { label: "Offer", value: "offer" },
  { label: "Rejected", value: "rejected" },
  { label: "Withdrawn", value: "withdrawn" },
];

const SAVED_VIEWS = [
  { name: "Default View", statuses: ["all"] as (NormalizedStatus | "all")[], autoCreatedOnly: false, todayOnly: false },
  { name: "Today's Jobs", statuses: ["all"] as (NormalizedStatus | "all")[], autoCreatedOnly: false, todayOnly: true },
  { name: "Interviews Active", statuses: ["interviewing"] as (NormalizedStatus | "all")[], autoCreatedOnly: false, todayOnly: false },
  { name: "Awaiting Response", statuses: ["applied", "under_review"] as (NormalizedStatus | "all")[], autoCreatedOnly: false, todayOnly: false },
  { name: "Action Required", statuses: ["assessment", "pending"] as (NormalizedStatus | "all")[], autoCreatedOnly: false, todayOnly: false },
  { name: "Rejected / Closed", statuses: ["rejected", "withdrawn"] as (NormalizedStatus | "all")[], autoCreatedOnly: false, todayOnly: false },
  { name: "Auto-Created", statuses: ["all"] as (NormalizedStatus | "all")[], autoCreatedOnly: true, todayOnly: false },
];

export const isApplicationFromToday = (app: ApplicationViewItem) => {
  if (!app.appliedDate) return false;
  const applied = new Date(app.appliedDate);
  if (isNaN(applied.getTime())) return false;
  const now = new Date();
  const isSameDay =
    applied.getFullYear() === now.getFullYear() &&
    applied.getMonth() === now.getMonth() &&
    applied.getDate() === now.getDate();
  const utcMatch = app.appliedDate.slice(0, 10) === now.toISOString().slice(0, 10);
  return isSameDay || utcMatch;
};

export const isAutoCreatedApplication = (app: ApplicationViewItem) => {
  const company = (app.company || "").toLowerCase();
  const title = (app.title || "").toLowerCase();
  const source = (app.source || "").toLowerCase();
  return (
    company.includes("unknown") ||
    title.includes("unknown") ||
    source.includes("email") ||
    source.includes("auto")
  );
};

export function ApplicationsTable({ initialApplications }: ApplicationsTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Selected statuses (supports multiple simultaneous selections)
  const [selectedStatuses, setSelectedStatuses] = useState<(NormalizedStatus | "all")[]>(["all"]);
  const [searchQuery, setSearchQuery] = useState("");
  const [roleCategoryFilter, setRoleCategoryFilter] = useState("all");
  const [remoteFilter, setRemoteFilter] = useState("all");
  const [recruiterContactedOnly, setRecruiterContactedOnly] = useState(false);
  const [followUpOnly, setFollowUpOnly] = useState(false);
  const [autoCreatedOnly, setAutoCreatedOnly] = useState(false);
  const [todayOnly, setTodayOnly] = useState(false);

  // Sorting
  const [sortField, setSortField] = useState<keyof ApplicationViewItem>("appliedDate");
  const [sortAsc, setSortAsc] = useState(false);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Drawer modal
  const [activeApplication, setActiveApplication] = useState<ApplicationViewItem | null>(null);

  // Sync initial query params on mount
  useEffect(() => {
    const statusParam = searchParams.get("status");
    if (statusParam) {
      if (statusParam === "all") {
        setSelectedStatuses(["all"]);
      } else {
        const statuses = statusParam.split(",") as NormalizedStatus[];
        setSelectedStatuses(statuses);
      }
    }

    if (searchParams.get("recruiter") === "true") {
      setRecruiterContactedOnly(true);
    }
    if (searchParams.get("action") === "required") {
      setFollowUpOnly(true);
    }
  }, [searchParams]);

  // Status toggle handler (multi-select)
  const toggleStatus = (status: NormalizedStatus | "all") => {
    if (status === "all") {
      setSelectedStatuses(["all"]);
      router.push("/applications");
      return;
    }

    let next: (NormalizedStatus | "all")[];
    if (selectedStatuses.includes("all")) {
      next = [status];
    } else if (selectedStatuses.includes(status)) {
      next = selectedStatuses.filter((s) => s !== status);
      if (next.length === 0) next = ["all"];
    } else {
      next = [...selectedStatuses, status];
    }

    setSelectedStatuses(next);
    setCurrentPage(1);

    if (next.includes("all")) {
      router.push("/applications");
    } else {
      router.push(`/applications?status=${next.join(",")}`);
    }
  };

  // Reset all filters
  const resetFilters = () => {
    setSelectedStatuses(["all"]);
    setSearchQuery("");
    setRoleCategoryFilter("all");
    setRemoteFilter("all");
    setRecruiterContactedOnly(false);
    setFollowUpOnly(false);
    setAutoCreatedOnly(false);
    setTodayOnly(false);
    setCurrentPage(1);
    router.push("/applications");
  };

  // Filtered applications
  const filteredApplications = useMemo(() => {
    return initialApplications.filter((app) => {
      // Status filter
      if (!selectedStatuses.includes("all")) {
        if (!selectedStatuses.includes(app.normalizedStatus)) {
          return false;
        }
      }

      // Today's jobs filter
      if (todayOnly && !isApplicationFromToday(app)) {
        return false;
      }

      // Auto-created / Needs details filter
      if (autoCreatedOnly && !isAutoCreatedApplication(app)) {
        return false;
      }

      // Search query (company, title, notes, id)
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matches =
          app.company.toLowerCase().includes(q) ||
          app.title.toLowerCase().includes(q) ||
          app.id.toLowerCase().includes(q) ||
          (app.notes && app.notes.toLowerCase().includes(q));
        if (!matches) return false;
      }

      // Role category
      if (roleCategoryFilter !== "all" && app.roleCategory !== roleCategoryFilter) {
        return false;
      }

      // Remote filter
      if (remoteFilter !== "all" && app.remoteType.toLowerCase() !== remoteFilter.toLowerCase()) {
        return false;
      }

      // Recruiter contacted
      if (recruiterContactedOnly && !app.recruiterContacted) {
        return false;
      }

      // Follow up required
      if (followUpOnly && !app.requiresFollowUp && app.normalizedStatus !== "assessment") {
        return false;
      }

      return true;
    });
  }, [
    initialApplications,
    selectedStatuses,
    searchQuery,
    roleCategoryFilter,
    remoteFilter,
    recruiterContactedOnly,
    followUpOnly,
    autoCreatedOnly,
    todayOnly,
  ]);

  const autoCreatedCount = useMemo(() => {
    return initialApplications.filter(isAutoCreatedApplication).length;
  }, [initialApplications]);

  const todayCount = useMemo(() => {
    return initialApplications.filter(isApplicationFromToday).length;
  }, [initialApplications]);

  // Sorted applications
  const sortedApplications = useMemo(() => {
    return [...filteredApplications].sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];

      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return sortAsc ? 1 : -1;
      if (bVal == null) return sortAsc ? -1 : 1;

      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }

      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortAsc ? aVal - bVal : bVal - aVal;
      }

      return 0;
    });
  }, [filteredApplications, sortField, sortAsc]);

  // Paginated applications
  const paginatedApplications = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedApplications.slice(start, start + pageSize);
  }, [sortedApplications, currentPage, pageSize]);

  const totalPages = Math.ceil(sortedApplications.length / pageSize) || 1;

  // Sorting helper
  const handleSort = (field: keyof ApplicationViewItem) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  // CSV Export
  const exportToCsv = () => {
    const headers = ["ID", "Company", "Title", "Status", "Score", "Applied Date", "Location", "Remote", "Salary"];
    const rows = filteredApplications.map((app) => [
      `"${app.id}"`,
      `"${app.company.replace(/"/g, '""')}"`,
      `"${app.title.replace(/"/g, '""')}"`,
      `"${app.rawStatus}"`,
      app.score ?? "",
      app.appliedDate ?? "",
      `"${app.location}"`,
      `"${app.remoteType}"`,
      `"${app.salaryText}"`,
    ]);

    const csvContent = [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `job-farming-applications-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const hasActiveFilters =
    !selectedStatuses.includes("all") ||
    searchQuery.trim().length > 0 ||
    roleCategoryFilter !== "all" ||
    remoteFilter !== "all" ||
    recruiterContactedOnly ||
    followUpOnly ||
    autoCreatedOnly ||
    todayOnly;

  return (
    <div className="space-y-5">
      {/* Saved Views Pills */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
        <span className="text-muted-foreground font-mono font-semibold flex items-center gap-1 shrink-0 text-[11px] uppercase tracking-wider">
          <Bookmark className="h-3.5 w-3.5 text-cyan-400" />
          Views:
        </span>
        {SAVED_VIEWS.map((view) => {
          const isSelected =
            view.statuses.length === selectedStatuses.length &&
            view.statuses.every((s) => selectedStatuses.includes(s)) &&
            Boolean(view.autoCreatedOnly) === autoCreatedOnly &&
            Boolean(view.todayOnly) === todayOnly;
          return (
            <button
              key={view.name}
              onClick={() => {
                setSelectedStatuses(view.statuses);
                setAutoCreatedOnly(Boolean(view.autoCreatedOnly));
                setTodayOnly(Boolean(view.todayOnly));
                setCurrentPage(1);
              }}
              className={cn(
                "px-3 py-1 rounded-full font-mono text-xs font-medium transition-all shrink-0 border",
                isSelected
                  ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/40 shadow-[0_0_10px_rgba(6,182,212,0.2)]"
                  : "bg-slate-900/60 text-muted-foreground hover:bg-slate-800 border-border/70 hover:text-foreground"
              )}
            >
              {view.name}
            </button>
          );
        })}
      </div>

      {/* Primary Status Tabs (Clickable Segmented Controls) */}
      <div className="orbital-card rounded-xl p-1.5 shadow-subtle">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
          {STATUS_TABS.map((tab) => {
            const isSelected = selectedStatuses.includes(tab.value);
            return (
              <button
                key={tab.value}
                onClick={() => toggleStatus(tab.value)}
                className={cn(
                  "px-3.5 py-1.5 rounded-lg text-xs font-mono font-semibold transition-all shrink-0 select-none flex items-center gap-1.5",
                  isSelected
                    ? "bg-gradient-to-r from-blue-600 to-cyan-600 text-white shadow-[0_0_12px_rgba(59,130,246,0.35)]"
                    : "text-muted-foreground hover:bg-slate-800/60 hover:text-foreground"
                )}
              >
                {isSelected && tab.value !== "all" && <Check className="h-3 w-3" />}
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Sticky Filter and Search Toolbar */}
      <div className="orbital-card rounded-xl p-3 sm:p-4 space-y-3">
        <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
          {/* Search Input */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Search by company, role title, or notes..."
              className="pl-9 text-xs h-9 font-mono bg-slate-900/70 border-border/80 focus:border-cyan-500/50"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Secondary Filter Controls */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Remote Dropdown */}
            <select
              value={remoteFilter}
              onChange={(e) => {
                setRemoteFilter(e.target.value);
                setCurrentPage(1);
              }}
              className="h-9 px-3 rounded-lg border border-border/80 bg-slate-900/70 text-xs font-mono text-foreground focus:outline-none focus:border-cyan-500/50"
            >
              <option value="all">All Workplaces</option>
              <option value="remote">Remote Only</option>
              <option value="hybrid">Hybrid</option>
              <option value="onsite">Onsite</option>
            </select>

            {/* Quick Toggle Chips */}
            <Button
              variant={recruiterContactedOnly ? "default" : "outline"}
              size="sm"
              onClick={() => setRecruiterContactedOnly(!recruiterContactedOnly)}
              className={cn(
                "h-9 text-xs font-mono gap-1",
                recruiterContactedOnly
                  ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/40"
                  : "border-border/80 text-muted-foreground hover:text-foreground"
              )}
            >
              <span>Recruiter Contacted</span>
            </Button>

            <Button
              variant={followUpOnly ? "default" : "outline"}
              size="sm"
              onClick={() => setFollowUpOnly(!followUpOnly)}
              className={cn(
                "h-9 text-xs font-mono gap-1",
                followUpOnly
                  ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                  : "border-border/80 text-muted-foreground hover:text-foreground"
              )}
            >
              <span>Action Required</span>
            </Button>

            <Button
              variant={autoCreatedOnly ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setAutoCreatedOnly(!autoCreatedOnly);
                setCurrentPage(1);
              }}
              className={cn(
                "h-9 text-xs font-mono gap-1.5",
                autoCreatedOnly
                  ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                  : "border-border/80 text-muted-foreground hover:text-foreground"
              )}
            >
              <Sparkles className="h-3 w-3 text-amber-400" />
              <span>Auto-Created {autoCreatedCount > 0 ? `(${autoCreatedCount})` : ""}</span>
            </Button>

            <Button
              variant={todayOnly ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setTodayOnly(!todayOnly);
                setCurrentPage(1);
              }}
              className={cn(
                "h-9 text-xs font-mono gap-1.5",
                todayOnly
                  ? "bg-blue-500/20 text-blue-300 border-blue-500/40"
                  : "border-border/80 text-muted-foreground hover:text-foreground"
              )}
            >
              <Calendar className="h-3 w-3 text-cyan-400" />
              <span>Today&apos;s Jobs {todayCount > 0 ? `(${todayCount})` : ""}</span>
            </Button>

            {/* Clear Filters Button */}
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={resetFilters}
                className="h-9 text-xs font-mono gap-1 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Clear Filters</span>
              </Button>
            )}

            {/* CSV Export */}
            <Button
              variant="outline"
              size="sm"
              onClick={exportToCsv}
              className="h-9 text-xs font-mono gap-1.5 ml-auto border-border/80 bg-slate-900/40 text-muted-foreground hover:text-cyan-400"
              title="Export filtered records to CSV"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Export CSV</span>
            </Button>
          </div>
        </div>

        {/* Active Filter Indicators */}
        {hasActiveFilters && (
          <div className="flex items-center gap-2 flex-wrap text-xs font-mono text-muted-foreground pt-1 border-t border-border/50">
            <span className="font-semibold text-foreground">Active Filters:</span>
            {todayOnly && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                Filter: Today&apos;s Jobs
                <button onClick={() => setTodayOnly(false)}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
            {autoCreatedOnly && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                Filter: Auto-Created
                <button onClick={() => setAutoCreatedOnly(false)}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
            {!selectedStatuses.includes("all") &&
              selectedStatuses.map((s) => (
                <span
                  key={s}
                  className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                >
                  Status: {s}
                  <button onClick={() => toggleStatus(s)}>
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            {searchQuery && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-slate-800 text-foreground border border-border">
                Query: &quot;{searchQuery}&quot;
                <button onClick={() => setSearchQuery("")}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
            <span className="ml-auto font-mono text-muted-foreground text-[11px]">
              Showing <span className="text-cyan-400 font-bold tabular-nums">{sortedApplications.length}</span> of {initialApplications.length} records
            </span>
          </div>
        )}
      </div>

      {/* Desktop Data Table (>=768px) with 2-Line Smart Wrap (Zero Clipped Titles) */}
      <div className="orbital-card rounded-xl overflow-hidden shadow-subtle hidden md:block">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-border/80 bg-slate-950/60 text-muted-foreground font-mono font-semibold">
              <th
                onClick={() => handleSort("company")}
                className="py-3 px-4 cursor-pointer hover:text-cyan-400 transition-colors"
              >
                <div className="flex items-center gap-1.5">
                  <span>Company & Position</span>
                  <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground/60" />
                </div>
              </th>
              <th
                onClick={() => handleSort("normalizedStatus")}
                className="py-3 px-4 cursor-pointer hover:text-cyan-400 transition-colors"
              >
                <div className="flex items-center gap-1.5">
                  <span>Status</span>
                  <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground/60" />
                </div>
              </th>
              <th
                onClick={() => handleSort("score")}
                className="py-3 px-4 cursor-pointer hover:text-cyan-400 transition-colors"
              >
                <div className="flex items-center gap-1.5">
                  <span>Fit Score</span>
                  <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground/60" />
                </div>
              </th>
              <th
                onClick={() => handleSort("appliedDate")}
                className="py-3 px-4 cursor-pointer hover:text-cyan-400 transition-colors"
              >
                <div className="flex items-center gap-1.5">
                  <span>Date Applied</span>
                  <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground/60" />
                </div>
              </th>
              <th className="py-3 px-4">Location / Remote</th>
              <th className="py-3 px-4">Salary Range</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {paginatedApplications.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-muted-foreground font-mono">
                  <div className="max-w-xs mx-auto space-y-2">
                    <p className="font-semibold text-foreground">No applications match your filters</p>
                    <p className="text-[11px]">Try adjusting your search query, status filters, or clear all filters.</p>
                    <Button variant="outline" size="sm" onClick={resetFilters} className="mt-2 text-xs font-mono">
                      Reset Filters
                    </Button>
                  </div>
                </td>
              </tr>
            ) : (
              paginatedApplications.map((app) => (
                <tr
                  key={app.id}
                  onClick={() => setActiveApplication(app)}
                  className="hover:bg-slate-900/60 transition-colors cursor-pointer group select-none"
                >
                  {/* Company & Position with 2-Line Smart Wrap (No clipping) */}
                  <td className="py-3 px-4 max-w-sm lg:max-w-md">
                    <div className="space-y-1">
                      <div className="font-semibold text-foreground flex items-center gap-2 group-hover:text-cyan-400 transition-colors flex-wrap">
                        <span className="font-medium">{app.company}</span>
                        <span className="text-[10px] font-mono text-muted-foreground">#{app.id}</span>
                        {isAutoCreatedApplication(app) && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded font-mono font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20 inline-flex items-center gap-1">
                            <Sparkles className="h-2.5 w-2.5" />
                            Auto-Created
                          </span>
                        )}
                      </div>
                      {/* 2-line smart wrap replaces single-line truncate */}
                      <div className="text-muted-foreground text-xs line-clamp-2 leading-snug">
                        {app.title}
                      </div>
                    </div>
                  </td>

                  {/* Status Badge */}
                  <td className="py-3 px-4">
                    <div className="space-y-0.5">
                      <StatusBadge status={app.normalizedStatus} />
                      {isAutoCreatedApplication(app) && app.rawStatus && (
                        <span className="text-[10px] text-muted-foreground block font-mono">
                          Auto: {app.rawStatus}
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Fit Score */}
                  <td className="py-3 px-4 font-mono">
                    {app.score ? (
                      <div className="space-y-1">
                        <span className="font-bold text-cyan-400 tabular-nums">
                          {app.score} <span className="text-muted-foreground font-normal text-[10px]">/ 100</span>
                        </span>
                        <div className="h-1 w-16 bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 rounded-full"
                            style={{ width: `${app.score}%` }}
                          />
                        </div>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>

                  {/* Date Applied */}
                  <td className="py-3 px-4 text-muted-foreground font-mono tabular-nums">
                    {formatDate(app.appliedDate)}
                  </td>

                  {/* Location / Remote */}
                  <td className="py-3 px-4 text-muted-foreground text-xs font-mono">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <MapPin className="h-3 w-3 text-cyan-400" />
                      <span>{app.location}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-medium">
                        {app.remoteType}
                      </span>
                    </div>
                  </td>

                  {/* Salary Range */}
                  <td className="py-3 px-4 text-muted-foreground font-mono tabular-nums">
                    {app.salaryText}
                  </td>

                  {/* Actions */}
                  <td className="py-3 px-4 text-right">
                    <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                      {app.postingUrl && (
                        <a
                          href={app.postingUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Open Original Job Posting"
                          className="p-1.5 rounded hover:bg-slate-800 text-muted-foreground hover:text-cyan-400 transition-colors"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                      {app.resumeUrl && (
                        <a
                          href={app.resumeUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="View Tailored Resume (PDF)"
                          className="p-1.5 rounded hover:bg-slate-800 text-muted-foreground hover:text-blue-400 transition-colors"
                        >
                          <FileText className="h-3.5 w-3.5" />
                        </a>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setActiveApplication(app)}
                        className="h-7 text-xs font-mono text-muted-foreground hover:text-cyan-400 ml-1"
                      >
                        Details →
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile Card Switcher (<768px) Touch-Friendly Tactical Cards */}
      <div className="md:hidden space-y-3">
        {paginatedApplications.length === 0 ? (
          <div className="orbital-card p-8 rounded-xl text-center text-muted-foreground text-xs font-mono">
            No matching applications found.
          </div>
        ) : (
          paginatedApplications.map((app) => (
            <div
              key={app.id}
              onClick={() => setActiveApplication(app)}
              className="orbital-card p-4 rounded-xl space-y-3 cursor-pointer select-none active:scale-[0.99] transition-transform"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1 flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <h4 className="font-bold text-sm text-foreground">{app.company}</h4>
                    <span className="text-[10px] font-mono text-muted-foreground">#{app.id}</span>
                    {isAutoCreatedApplication(app) && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-mono font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20 inline-flex items-center gap-0.5">
                        <Sparkles className="h-2.5 w-2.5" />
                        Auto
                      </span>
                    )}
                  </div>
                  {/* 2-line smart wrap on mobile */}
                  <p className="text-xs text-muted-foreground line-clamp-2 leading-snug">{app.title}</p>
                </div>

                <div className="text-right space-y-0.5 shrink-0">
                  <StatusBadge status={app.normalizedStatus} size="sm" />
                  {isAutoCreatedApplication(app) && app.rawStatus && (
                    <span className="text-[9px] text-muted-foreground block font-mono">
                      Auto: {app.rawStatus}
                    </span>
                  )}
                </div>
              </div>

              {/* Match Score & Metadata Row */}
              <div className="grid grid-cols-2 gap-2 text-xs font-mono text-muted-foreground pt-2 border-t border-border/50">
                <div>
                  <span className="text-[10px] uppercase block">Applied:</span>
                  <span className="font-semibold text-foreground tabular-nums">{formatDate(app.appliedDate)}</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase block">Fit Score:</span>
                  <span className="font-semibold text-cyan-400 tabular-nums">
                    {app.score ? `${app.score}/100` : "—"}
                  </span>
                </div>
                <div className="col-span-2 flex items-center gap-1 text-[11px] truncate">
                  <MapPin className="h-3 w-3 text-cyan-400 shrink-0" />
                  <span className="text-foreground truncate">{app.location}</span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 ml-1">
                    {app.remoteType}
                  </span>
                </div>
              </div>

              {/* Bottom Quick Links */}
              <div className="flex items-center justify-between pt-2 border-t border-border/50 text-xs font-mono" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-2">
                  {app.postingUrl && (
                    <a
                      href={app.postingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-cyan-400 hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Posting
                    </a>
                  )}
                  {app.resumeUrl && (
                    <a
                      href={app.resumeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-blue-400 hover:underline"
                    >
                      <FileText className="h-3 w-3" />
                      Resume
                    </a>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setActiveApplication(app)}
                  className="h-6 text-[11px] font-mono text-muted-foreground hover:text-cyan-400"
                >
                  View Dossier →
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Pagination Controls */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs font-mono text-muted-foreground pt-2">
        <div className="flex items-center gap-2">
          <span>Show:</span>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setCurrentPage(1);
            }}
            className="h-8 px-2 rounded-lg border border-border/80 bg-slate-900 text-foreground text-xs font-mono"
          >
            <option value={10}>10 per page</option>
            <option value={25}>25 per page</option>
            <option value={50}>50 per page</option>
          </select>
          <span className="tabular-nums">
            Page {currentPage} of {totalPages}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="h-8 px-3 text-xs font-mono border-border/80 bg-slate-900/50"
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage >= totalPages}
            className="h-8 px-3 text-xs font-mono border-border/80 bg-slate-900/50"
          >
            Next
          </Button>
        </div>
      </div>

      {/* Slide-out Application Detail Drawer */}
      <ApplicationDrawer
        application={activeApplication}
        onClose={() => setActiveApplication(null)}
      />
    </div>
  );
}
