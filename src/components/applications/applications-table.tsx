"use client";

import React, { useState, useMemo, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Search,
  Filter,
  Download,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Building,
  MapPin,
  Calendar,
  X,
  ExternalLink,
  SlidersHorizontal,
  Bookmark,
  Check,
} from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/utils";
import { ApplicationDrawer } from "./application-drawer";
import type { ApplicationViewItem, NormalizedStatus } from "@/types/dashboard";

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
  { name: "Default View", statuses: ["all"] as (NormalizedStatus | "all")[] },
  { name: "Interviews Active", statuses: ["interviewing"] as (NormalizedStatus | "all")[] },
  { name: "Awaiting Response", statuses: ["applied", "under_review"] as (NormalizedStatus | "all")[] },
  { name: "Action Required", statuses: ["assessment", "pending"] as (NormalizedStatus | "all")[] },
  { name: "Rejected / Closed", statuses: ["rejected", "withdrawn"] as (NormalizedStatus | "all")[] },
];

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
  ]);

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
    followUpOnly;

  return (
    <div className="space-y-5">
      {/* Saved Views Pills */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
        <span className="text-muted-foreground font-semibold flex items-center gap-1 shrink-0">
          <Bookmark className="h-3.5 w-3.5" />
          Views:
        </span>
        {SAVED_VIEWS.map((view) => {
          const isSelected =
            view.statuses.length === selectedStatuses.length &&
            view.statuses.every((s) => selectedStatuses.includes(s));
          return (
            <button
              key={view.name}
              onClick={() => {
                setSelectedStatuses(view.statuses);
                setCurrentPage(1);
              }}
              className={`px-3 py-1 rounded-full font-medium transition-colors shrink-0 border ${
                isSelected
                  ? "bg-primary text-primary-foreground border-transparent shadow-sm"
                  : "bg-card text-muted-foreground hover:bg-accent border-input hover:text-foreground"
              }`}
            >
              {view.name}
            </button>
          );
        })}
      </div>

      {/* Primary Status Tabs (Clickable Segmented Controls) */}
      <div className="border rounded-xl p-1.5 bg-card/70 backdrop-blur shadow-subtle">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {STATUS_TABS.map((tab) => {
            const isSelected = selectedStatuses.includes(tab.value);
            return (
              <button
                key={tab.value}
                onClick={() => toggleStatus(tab.value)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all shrink-0 select-none flex items-center gap-1.5 ${
                  isSelected
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {isSelected && tab.value !== "all" && <Check className="h-3 w-3" />}
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Filter and Search Toolbar */}
      <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
        {/* Search Input */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
            placeholder="Search by company, role title, or notes..."
            className="pl-9 text-xs h-9"
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
            className="h-9 px-3 rounded-lg border border-input bg-background text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
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
            className="h-9 text-xs gap-1"
          >
            <span>Recruiter Contacted</span>
          </Button>

          <Button
            variant={followUpOnly ? "default" : "outline"}
            size="sm"
            onClick={() => setFollowUpOnly(!followUpOnly)}
            className="h-9 text-xs gap-1"
          >
            <span>Action Required</span>
          </Button>

          {/* Clear Filters */}
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={resetFilters}
              className="h-9 text-xs gap-1 text-rose-600 dark:text-rose-400 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/30"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Clear</span>
            </Button>
          )}

          {/* CSV Export */}
          <Button
            variant="outline"
            size="sm"
            onClick={exportToCsv}
            className="h-9 text-xs gap-1.5 ml-auto"
            title="Export filtered records to CSV"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export CSV</span>
          </Button>
        </div>
      </div>

      {/* Active Filter Indicators */}
      {hasActiveFilters && (
        <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground pt-1">
          <span className="font-semibold text-foreground">Active Filters:</span>
          {!selectedStatuses.includes("all") &&
            selectedStatuses.map((s) => (
              <span
                key={s}
                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-brand-500/10 text-brand-600 dark:text-brand-400 border border-brand-500/20 font-medium"
              >
                Status: {s}
                <button onClick={() => toggleStatus(s)}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          {searchQuery && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-muted text-foreground border font-medium">
              Query: &quot;{searchQuery}&quot;
              <button onClick={() => setSearchQuery("")}>
                <X className="h-3 w-3" />
              </button>
            </span>
          )}
          {remoteFilter !== "all" && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-muted text-foreground border font-medium">
              Workplace: {remoteFilter}
              <button onClick={() => setRemoteFilter("all")}>
                <X className="h-3 w-3" />
              </button>
            </span>
          )}
          <span className="ml-auto font-medium">
            Showing {sortedApplications.length} of {initialApplications.length} records
          </span>
        </div>
      )}

      {/* Desktop Data Table */}
      <div className="border rounded-xl bg-card overflow-hidden shadow-subtle hidden md:block">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b bg-muted/40 text-muted-foreground font-semibold">
              <th
                onClick={() => handleSort("company")}
                className="py-3 px-4 cursor-pointer hover:text-foreground transition-colors"
              >
                <div className="flex items-center gap-1.5">
                  <span>Company & Position</span>
                  <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground/60" />
                </div>
              </th>
              <th
                onClick={() => handleSort("normalizedStatus")}
                className="py-3 px-4 cursor-pointer hover:text-foreground transition-colors"
              >
                <div className="flex items-center gap-1.5">
                  <span>Status</span>
                  <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground/60" />
                </div>
              </th>
              <th
                onClick={() => handleSort("score")}
                className="py-3 px-4 cursor-pointer hover:text-foreground transition-colors"
              >
                <div className="flex items-center gap-1.5">
                  <span>Fit Score</span>
                  <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground/60" />
                </div>
              </th>
              <th
                onClick={() => handleSort("appliedDate")}
                className="py-3 px-4 cursor-pointer hover:text-foreground transition-colors"
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
          <tbody className="divide-y divide-border">
            {paginatedApplications.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-muted-foreground">
                  <div className="max-w-xs mx-auto space-y-2">
                    <p className="font-semibold text-foreground">No applications match your filters</p>
                    <p className="text-[11px]">Try adjusting your search query, status filters, or clear all filters.</p>
                    <Button variant="outline" size="sm" onClick={resetFilters} className="mt-2 text-xs">
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
                  className="hover:bg-muted/40 transition-colors cursor-pointer group select-none"
                >
                  <td className="py-3.5 px-4">
                    <div className="space-y-0.5">
                      <div className="font-semibold text-foreground flex items-center gap-2 group-hover:text-primary transition-colors">
                        <span>{app.company}</span>
                        <span className="text-[10px] font-mono text-muted-foreground">#{app.id}</span>
                      </div>
                      <div className="text-muted-foreground truncate max-w-sm">{app.title}</div>
                    </div>
                  </td>
                  <td className="py-3.5 px-4">
                    <StatusBadge status={app.normalizedStatus} />
                  </td>
                  <td className="py-3.5 px-4">
                    {app.score ? (
                      <span className="font-semibold text-foreground">
                        {app.score} <span className="text-muted-foreground font-normal">/ 5</span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-3.5 px-4 text-muted-foreground font-mono">
                    {formatDate(app.appliedDate)}
                  </td>
                  <td className="py-3.5 px-4 text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <MapPin className="h-3 w-3 text-muted-foreground/70" />
                      <span>{app.location}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted font-medium ml-1">
                        {app.remoteType}
                      </span>
                    </div>
                  </td>
                  <td className="py-3.5 px-4 text-muted-foreground font-mono">
                    {app.salaryText}
                  </td>
                  <td className="py-3.5 px-4 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveApplication(app);
                      }}
                      className="h-7 text-xs text-muted-foreground hover:text-foreground"
                    >
                      Details →
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile Card View */}
      <div className="md:hidden space-y-3">
        {paginatedApplications.length === 0 ? (
          <div className="p-8 border rounded-xl text-center text-muted-foreground text-xs bg-card">
            No matching applications found.
          </div>
        ) : (
          paginatedApplications.map((app) => (
            <div
              key={app.id}
              onClick={() => setActiveApplication(app)}
              className="p-4 rounded-xl border bg-card shadow-subtle space-y-3 cursor-pointer"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h4 className="font-bold text-sm text-foreground">{app.company}</h4>
                  <p className="text-xs text-muted-foreground">{app.title}</p>
                </div>
                <StatusBadge status={app.normalizedStatus} size="sm" />
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground pt-1 border-t">
                <div>
                  <span>Applied: </span>
                  <span className="font-semibold text-foreground">{formatDate(app.appliedDate)}</span>
                </div>
                <div>
                  <span>Score: </span>
                  <span className="font-semibold text-foreground">{app.score ? `${app.score}/5` : "—"}</span>
                </div>
                <div className="col-span-2 truncate">
                  <span>Location: </span>
                  <span className="text-foreground">{app.location} ({app.remoteType})</span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Pagination Controls */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground pt-2">
        <div className="flex items-center gap-2">
          <span>Show:</span>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setCurrentPage(1);
            }}
            className="h-8 px-2 rounded border bg-background text-foreground text-xs"
          >
            <option value={10}>10 per page</option>
            <option value={25}>25 per page</option>
            <option value={50}>50 per page</option>
          </select>
          <span>
            Page {currentPage} of {totalPages}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="h-8 px-3 text-xs"
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage >= totalPages}
            className="h-8 px-3 text-xs"
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

