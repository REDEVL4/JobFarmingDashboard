import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedOwner } from "@/lib/supabase/server";
import { resolveOutreachProposal } from "@/lib/data-service";

export async function POST(req: NextRequest) {
  try {
    // 1. Strict Same-Origin & CSRF Protection
    const secFetchSite = req.headers.get("sec-fetch-site");
    if (secFetchSite && secFetchSite !== "same-origin") {
      return NextResponse.json(
        { error: "Forbidden: Cross-site request rejected (CSRF protection)." },
        { status: 403 }
      );
    }

    const origin = req.headers.get("origin");
    if (origin) {
      const requestUrl = new URL(req.url);
      if (origin !== requestUrl.origin) {
        return NextResponse.json(
          { error: "Forbidden: Cross-origin request rejected." },
          { status: 403 }
        );
      }
    }

    // 2. Owner-only authentication barrier
    const auth = await getAuthenticatedOwner();
    if (!auth.success) {
      return NextResponse.json(
        { error: auth.error || "Authentication required." },
        { status: auth.reason === "unauthenticated" ? 401 : 403 }
      );
    }

    const body = await req.json();
    const { id, action, approved_text } = body;

    if (!id || !action) {
      return NextResponse.json(
        { error: "Bad Request: id and action are required." },
        { status: 400 }
      );
    }

    if (!["approve", "reject"].includes(action)) {
      return NextResponse.json(
        { error: `Invalid action: ${action}. Must be one of 'approve', 'reject'.` },
        { status: 400 }
      );
    }

    const result = await resolveOutreachProposal(id, action, approved_text);
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true, data: result.data });
  } catch (err: any) {
    console.error("[api/outreach/proposals] Unexpected error:", err);
    return NextResponse.json(
      { error: "An unexpected error occurred while processing the outreach proposal." },
      { status: 500 }
    );
  }
}

