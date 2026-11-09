import React from "react";
import { fetchOutreachStats } from "@/lib/data-service";
import { OutreachClient } from "@/components/outreach/outreach-client";

export const dynamic = "force-dynamic";

export default async function OutreachPage() {
  const result = await fetchOutreachStats();

  return (
    <OutreachClient
      initialStats={result.data}
      status={result.status}
      error={result.error}
    />
  );
}
