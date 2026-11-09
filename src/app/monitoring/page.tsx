import React from "react";
import { fetchMonitoringStats } from "@/lib/data-service";
import { MonitoringView } from "@/components/monitoring/monitoring-view";

export const dynamic = "force-dynamic";

export default async function MonitoringPage() {
  const result = await fetchMonitoringStats();

  return (
    <MonitoringView
      initialStats={result.data}
      fetchStatus={result.status}
      errorMessage={result.error}
    />
  );
}
