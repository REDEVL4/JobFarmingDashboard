import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedOwner } from "@/lib/supabase/server";

// Simple in-memory rate limiting tracker (per server process instance)
const lastRequestTimestamps = new Map<string, number>();
const RATE_LIMIT_WINDOW_MS = 5_000; // 5 seconds between manual dry-run triggers

export async function POST(req: NextRequest) {
  try {
    // 1. Origin & CSRF Protection
    const secFetchSite = req.headers.get("sec-fetch-site");
    if (secFetchSite && secFetchSite !== "same-origin" && secFetchSite !== "same-site") {
      return NextResponse.json(
        { error: "Forbidden: Cross-site request rejected (CSRF protection)." },
        { status: 403 }
      );
    }

    const origin = req.headers.get("origin");
    const host = req.headers.get("host");
    if (origin && host) {
      const originHost = origin.replace(/^https?:\/\//i, "").split(":")[0];
      const reqHost = host.split(":")[0];
      if (originHost !== reqHost && originHost !== "localhost") {
        return NextResponse.json(
          { error: "Forbidden: Origin host mismatch." },
          { status: 403 }
        );
      }
    }

    // 2. Owner-only authentication barrier
    const auth = await getAuthenticatedOwner();
    if (!auth.success) {
      if (auth.reason === "unauthenticated") {
        return NextResponse.json(
          { error: "Authentication required: Sign in as the designated owner to trigger dry runs." },
          { status: 401 }
        );
      }
      return NextResponse.json(
        { error: "Forbidden: Only the verified owner UUID can trigger Gmail monitoring dry runs." },
        { status: 403 }
      );
    }

    // 3. Rate limiting per owner
    const now = Date.now();
    const lastTime = lastRequestTimestamps.get(auth.user.id) || 0;
    if (now - lastTime < RATE_LIMIT_WINDOW_MS) {
      const waitSec = Math.ceil((RATE_LIMIT_WINDOW_MS - (now - lastTime)) / 1000);
      return NextResponse.json(
        { error: `Too many requests. Please wait ${waitSec}s before triggering another dry run.` },
        { status: 429 }
      );
    }
    lastRequestTimestamps.set(auth.user.id, now);

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const gapReconciliation = Boolean(body.gap_reconciliation);

    // 4. Dedicated Server-to-Server Authentication
    // STRICT POLICY: Use ONLY JF_MONITOR_INVOKE_TOKEN. Never fall back to service role key.
    const monitorToken = process.env.JF_MONITOR_INVOKE_TOKEN;
    if (!monitorToken) {
      return NextResponse.json(
        {
          error: "Edge Function invocation unavailable: JF_MONITOR_INVOKE_TOKEN is not configured on the server.",
          detail: "Configure JF_MONITOR_INVOKE_TOKEN in your environment variables to authorize communication with the Supabase Edge Function.",
          status: "unconfigured",
        },
        { status: 503 }
      );
    }

    // 5. Invoke Edge Function (Strictly dry_run: true)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://mldtysploensrrulchdl.supabase.co";
    const functionUrl = `${supabaseUrl}/functions/v1/gmail-status-sync`;

    try {
      const edgeRes = await fetch(functionUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-jf-monitor-token": monitorToken,
        },
        body: JSON.stringify({
          dry_run: true, // Always enforce dry_run: true from test trigger
          gap_reconciliation: gapReconciliation,
        }),
        signal: AbortSignal.timeout(30_000),
      });

      const edgeData = await edgeRes.json().catch(() => ({}));

      if (!edgeRes.ok) {
        return NextResponse.json(
          {
            error: `Edge Function returned status ${edgeRes.status}`,
            detail: edgeData?.error || edgeData,
            status: "edge_function_error",
          },
          { status: edgeRes.status >= 500 ? 502 : edgeRes.status }
        );
      }

      return NextResponse.json({
        source: "edge_function",
        status: edgeRes.status,
        result: edgeData,
      });
    } catch (edgeErr: any) {
      // Honest error reporting: do not fabricate successful responses when function is offline
      return NextResponse.json(
        {
          error: "Edge Function is currently unreachable",
          detail: edgeErr?.message || "Failed to establish connection to Supabase Edge Function.",
          functionUrl,
          status: "edge_function_unreachable",
        },
        { status: 502 }
      );
    }
  } catch (err: any) {
    return NextResponse.json(
      { error: `Internal dry run trigger error: ${err?.message || "Unknown error"}` },
      { status: 500 }
    );
  }
}
