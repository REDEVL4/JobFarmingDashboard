import React from "react";
import { fetchOutreachStats, fetchOutreachProposals } from "@/lib/data-service";
import { OutreachClient } from "@/components/outreach/outreach-client";

export const dynamic = "force-dynamic";

export default async function OutreachPage() {
  const [statsResult, proposalsResult] = await Promise.all([
    fetchOutreachStats(),
    fetchOutreachProposals(),
  ]);

  return (
    <OutreachClient
      initialStats={statsResult.data}
      initialProposals={proposalsResult.data}
      status={statsResult.status !== "success" && statsResult.status !== "empty" ? statsResult.status : proposalsResult.status}
      error={statsResult.error || proposalsResult.error}
    />
  );
}
