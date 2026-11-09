import React, { Suspense } from "react";
import { fetchApplications } from "@/lib/data-service";
import { ApplicationsTable } from "@/components/applications/applications-table";
import { Briefcase } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ApplicationsPage() {
  const applications = await fetchApplications();

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

      {/* Main Table with Suspense Boundary for useSearchParams */}
      <Suspense fallback={<div className="h-96 flex items-center justify-center text-xs text-muted-foreground">Loading applications table...</div>}>
        <ApplicationsTable initialApplications={applications} />
      </Suspense>
    </div>
  );
}
