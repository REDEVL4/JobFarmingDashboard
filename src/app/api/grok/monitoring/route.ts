import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * Isolated Read-Only Grok Monitoring API.
 * 
 * SECURITY GUARANTEES:
 * 1. Independent authentication via GROK_MONITORING_READ_KEY.
 * 2. Does NOT use or rely on jf-grok-owner-mcp.
 * 3. Read-only GET method ONLY. Rejects any mutation attempts.
 * 4. Zero write access to applications or outreach records.
 */

export async function GET(req: NextRequest) {
  // 1. Verify independent bearer authentication
  const expectedKey = process.env.GROK_MONITORING_READ_KEY;
  if (!expectedKey) {
    return NextResponse.json(
      {
        error: "Grok monitoring interface is currently disabled: GROK_MONITORING_READ_KEY is unconfigured.",
        status: "unconfigured",
      },
      { status: 503 }
    );
  }

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: "Unauthorized: Missing or malformed Bearer token." },
      { status: 401 }
    );
  }

  const token = authHeader.slice(7).trim();
  if (token !== expectedKey) {
    return NextResponse.json(
      { error: "Forbidden: Invalid Grok read token." },
      { status: 403 }
    );
  }

  try {
    // 2. Fetch read-only telemetry from public schema
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://mldtysploensrrulchdl.supabase.co";
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

    const client = createClient(supabaseUrl, anonKey, {
      db: { schema: "public" },
      auth: { persistSession: false },
    });

    const [syncRes, reviewRes] = await Promise.all([
      client
        .from("jf_recruitment_health")
        .select("started_at, completed_at, verification_results, created_count, updated_count, skipped_count")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      client
        .from("jf_recruitment_review")
        .select("id, mailbox, reason_code, proposed_stage, evidence_summary, created_at")
        .eq("state", "open")
        .limit(50),
    ]);

    const latestSync = syncRes.data;
    const reviewItems = reviewRes.data || [];

    return NextResponse.json({
      service: "job_farming_gmail_monitoring",
      mode: "read_only",
      timestamp: new Date().toISOString(),
      summary: {
        connection_status: latestSync ? "active" : "standby",
        scheduler_cron: "49 * * * *",
        last_sync_completed_at: latestSync?.completed_at || null,
        dry_run_mode_enforced: true,
        open_review_queue_count: reviewItems.length,
      },
      review_queue: reviewItems.map((item) => ({
        id: item.id,
        reason_code: item.reason_code,
        proposed_stage: item.proposed_stage,
        evidence_summary: item.evidence_summary,
        created_at: item.created_at,
      })),
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: `Failed to retrieve monitoring summary: ${err?.message || "Internal error"}` },
      { status: 500 }
    );
  }
}

export async function POST() {
  return NextResponse.json(
    { error: "Method Not Allowed. Grok interface is strictly read-only." },
    { status: 405 }
  );
}

export async function PUT() {
  return NextResponse.json(
    { error: "Method Not Allowed. Grok interface is strictly read-only." },
    { status: 405 }
  );
}

export async function DELETE() {
  return NextResponse.json(
    { error: "Method Not Allowed. Grok interface is strictly read-only." },
    { status: 405 }
  );
}

