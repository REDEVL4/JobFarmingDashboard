import React, { Suspense } from "react";
import { fetchApplications } from "@/lib/data-service";
import { ApplicationsTable } from "@/components/applications/applications-table";
import { Briefcase, ShieldAlert } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ApplicationsPage() {
  const result = await fetchApplications();
  const applications = result.data;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Briefcase className="h-6 w-6 text-brand-500" />
            Applications Tracker
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Search, filter, and inspect {applications.length} synchronized job applications and status lifecycles.
          </p>
        </div>
      </div>

      {/* Honest Error Notice */}
      {result.status !== "success" && result.status !== "empty" && (
        <div className="p-4 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400 space-y-1.5">
          <div className="flex items-center gap-2 font-bold text-sm">
            <ShieldAlert className="h-5 w-5 shrink-0" />
            <span>
              {result.status === "unauthenticated"
                ? "Owner Authentication Required"
                : result.status === "permission_denied"
                ? "Database Query Permission Denied (RLS Boundary)"
                : "Database Connection Failure"}
            </span>
          </div>
          <p className="text-xs leading-relaxed">{result.error}</p>
        </div>
      )}

      {/* Empty Database State */}
      {result.status === "empty" && (
        <div className="p-12 text-center border rounded-xl space-y-2 bg-card">
          <p className="text-base font-semibold text-foreground">Zero Applications In Database</p>
          <p className="text-xs text-muted-foreground">The job_applications table is currently empty.</p>
        </div>
      )}

      {/* Main Table with Suspense Boundary for useSearchParams */}
      {result.status === "success" && (
        <Suspense fallback={<div className="h-96 flex items-center justify-center text-xs text-muted-foreground">Loading applications table...</div>}>
          <ApplicationsTable initialApplications={applications} />
        </Suspense>
      )}
    </div>
  );
}
