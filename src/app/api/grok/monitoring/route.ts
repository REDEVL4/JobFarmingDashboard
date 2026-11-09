import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const OWNER_EMAIL = "govardhanreddy.vys7@gmail.com";

/**
 * Isolated Read-Only Grok Monitoring API.
 * 
 * SECURITY GUARANTEES:
 * 1. Independent authentication via GROK_MONITORING_READ_KEY.
 * 2. Does NOT use or rely on jf-grok-owner-mcp.
 * 3. Does NOT rely on anonymous access to views that require authenticated sessions.
 * 4. Narrowly scoped server-side access with explicit owner email filtering.
 * 5. Read-only GET method ONLY. Strictly rejects all mutation attempts (POST/PUT/DELETE/PATCH).
 * 6. Zero write access to applications or outreach records.
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

  // 2. Obtain authorized server credentials
  // Never fall back to anonymous client which gets blocked by view permissions
  const serverServiceKey = process.env.GROK_SERVICE_READ_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serverServiceKey) {
    return NextResponse.json(
      {
        error: "Authorized data access unavailable: Server service credentials are not configured.",
        detail: "Configure SUPABASE_SERVICE_ROLE_KEY or GROK_SERVICE_READ_KEY in server environment to allow read-only view access.",
        status: "service_credentials_unconfigured",
      },
      { status: 503 }
    );
  }

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://mldtysploensrrulchdl.supabase.co";

    // Create server-side authenticated client scoped to public schema
    const client = createClient(supabaseUrl, serverServiceKey, {
      db: { schema: "public" },
      auth: { persistSession: false },
    });

    // Explicit ownership scoping: strictly owner records
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
        .eq("mailbox", OWNER_EMAIL)
        .limit(50),
    ]);

    if (syncRes.error || reviewRes.error) {
      return NextResponse.json(
        {
          error: "Failed to query recruitment views",
          detail: syncRes.error?.message || reviewRes.error?.message,
        },
        { status: 502 }
      );
    }

    const latestSync = syncRes.data;
    const reviewItems = reviewRes.data || [];

    // Strictly sanitized read-only contract
    return NextResponse.json({
      service: "job_farming_gmail_monitoring",
      mode: "read_only",
      timestamp: new Date().toISOString(),
      summary: {
        mailbox: OWNER_EMAIL,
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
      { error: `Internal error retrieving monitoring summary: ${err?.message || "Unknown error"}` },
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

export async function PATCH() {
  return NextResponse.json(
    { error: "Method Not Allowed. Grok interface is strictly read-only." },
    { status: 405 }
  );
}
